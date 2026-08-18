import app from './business-crm-entry.js';
import { sessionTokenFromCookie, verifySession } from './auth.js';
import { resolveCanonicalMemberId } from './member-repository.js';

const json = (data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const clean=(v,n=160)=>String(v??'').trim().slice(0,n);
const normalizePhone=(v)=>clean(v,30).replace(/[^0-9+]/g,'').replace(/^\+8860?/,'0');
const normalizeName=(v)=>clean(v,160).replace(/\s+/g,'').toLowerCase();

async function readLiveRoster(env){
  if(!env.TDEA_WORKER?.fetch) throw new Error('TDEA_WORKER service binding missing');
  const response=await env.TDEA_WORKER.fetch(new Request('https://tdea-roster.internal/api/roster/live',{headers:{accept:'application/json','cache-control':'no-cache'}}));
  const roster=await response.json().catch(()=>null);
  if(!response.ok||!roster||(!Array.isArray(roster.a)&&!Array.isArray(roster.v))) throw new Error('TDEA 即時名冊讀取失敗');
  return roster;
}

async function lookupLiveRosterMemberNumber(env,body){
  const memberType=clean(body?.memberType,20).toLowerCase();
  const fullName=clean(body?.fullName,120);
  if(!['association','vendor'].includes(memberType)) throw new Error('請先選擇協會會員或廠商會員');
  if(!fullName) throw new Error('請填寫姓名／公司名稱');
  const roster=await readLiveRoster(env);
  const rows=memberType==='vendor'?(Array.isArray(roster.v)?roster.v:[]):(Array.isArray(roster.a)?roster.a:[]);
  const target=normalizeName(fullName);
  const match=rows.find((row)=>{
    const candidate=memberType==='vendor'?(row?.[1]||row?.[4]||row?.[3]):row?.[2];
    return normalizeName(candidate)===target;
  });
  if(!match?.[0]) throw new Error('查無符合的會員資料，請直接輸入會員編號');
  return {
    memberType,
    memberNumber:clean(match[0],80).toUpperCase(),
    rosterName:memberType==='vendor'?clean(match?.[1]||match?.[4]||match?.[3],120):clean(match?.[2],120),
    source:'tdea_roster_live_fallback',
  };
}

function authTokenFromRequest(request){
  const authorization=clean(request.headers.get('authorization'),4096);
  if(/^Bearer\s+/i.test(authorization)) return authorization.replace(/^Bearer\s+/i,'').trim();
  return sessionTokenFromCookie(request.headers.get('cookie')||'');
}

async function currentMemberSnapshot(env,request){
  if(!env.DB||!env.SESSION_SIGNING_SECRET) throw new Error('會員同步驗證服務尚未設定');
  const claims=await verifySession(authTokenFromRequest(request),env.SESSION_SIGNING_SECRET);
  if(!claims?.sub) throw new Error('會員登入狀態已失效');
  const userId=await resolveCanonicalMemberId(env.DB,claims.sub);
  const profile=await env.DB.prepare(`
    SELECT platform_user_id, display_name, full_name, phone, email, gender, birthday,
           member_number, member_type, roster_member_number, roster_verified_name,
           roster_verified_at, roster_source
    FROM member_profiles
    WHERE platform_user_id = ?
    LIMIT 1
  `).bind(userId).first();
  if(!profile) throw new Error('找不到會員資料');
  const identity=await env.DB.prepare(`
    SELECT provider_subject
    FROM external_identities
    WHERE provider='line_login' AND verification_status='verified'
      AND (platform_user_id = ? OR platform_user_id IN (
        SELECT alias_user_id FROM member_account_aliases WHERE canonical_user_id = ?
      ))
    ORDER BY last_verified_at DESC
    LIMIT 1
  `).bind(userId,userId).first();
  const memberType=['association','vendor'].includes(clean(profile.member_type,20).toLowerCase())
    ? clean(profile.member_type,20).toLowerCase()
    : 'general';
  const memberNumber=memberType==='general'
    ? clean(profile.member_number,100).toUpperCase()
    : clean(profile.roster_member_number,100).toUpperCase();
  return {
    tdeaDesignUserId:userId,
    memberType,
    memberNumber,
    fullName:clean(profile.full_name||profile.display_name,180),
    displayName:clean(profile.display_name||profile.full_name,180),
    phone:normalizePhone(profile.phone),
    email:clean(profile.email,320),
    gender:clean(profile.gender,30),
    birthday:clean(profile.birthday,30),
    lineUserId:clean(identity?.provider_subject,256),
    loginAccess:true,
    source:'tdea-design-member-profile',
  };
}

async function syncUnifiedMemberMaster(env,request){
  if(!env.TDEA_WORKER?.fetch) throw new Error('TDEA 名冊同步服務尚未連線');
  const member=await currentMemberSnapshot(env,request);
  if(!member.memberNumber) throw new Error('會員編號尚未建立，無法同步會員主檔');
  if(!member.lineUserId) throw new Error('尚未取得 LINE UID，無法完成會員身分綁定');
  const response=await env.TDEA_WORKER.fetch(new Request('https://tdea-roster.internal/api/internal/tdea-design/member-upsert',{
    method:'POST',
    headers:{'content-type':'application/json','accept':'application/json'},
    body:JSON.stringify(member),
  }));
  const result=await response.json().catch(()=>({}));
  if(!response.ok||result?.success!==true) throw new Error(result?.message||result?.error||'統一會員主檔同步失敗');
  return {synced:true,memberType:member.memberType,memberNumber:member.memberNumber,lineUserId:member.lineUserId,created:Boolean(result.created),source:result.source||'manager/state.json'};
}

async function diagnoseRosterBinding(env,url){
  const roster=await readLiveRoster(env);
  const memberNo=clean(url.searchParams.get('memberNo'),80).toUpperCase();
  const name=clean(url.searchParams.get('name'),120);
  const a=Array.isArray(roster.a)?roster.a:[];
  const v=Array.isArray(roster.v)?roster.v:[];
  const byNo=(row)=>memberNo&&clean(row?.[0],80).toUpperCase()===memberNo;
  const byNameAssociation=(row)=>name&&normalizeName(row?.[2])===normalizeName(name);
  const byNameVendor=(row)=>name&&normalizeName(row?.[1]||row?.[4]||row?.[3])===normalizeName(name);
  const assoc=a.find(row=>byNo(row)||byNameAssociation(row));
  const vendor=v.find(row=>byNo(row)||byNameVendor(row));
  const match=assoc||vendor||null;
  return json({
    success:true,
    serviceBindingOk:true,
    liveManagerRosterMerged:Boolean(roster.liveManagerRosterMerged),
    memberNo,
    name,
    found:Boolean(match),
    type:assoc?'association':vendor?'vendor':'',
    matchedMemberNo:match?clean(match[0],80).toUpperCase():'',
    matchedName:assoc?clean(assoc?.[2],120):vendor?clean(vendor?.[1]||vendor?.[4]||vendor?.[3],120):'',
    associationCount:a.length,
    vendorCount:v.length,
  });
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(request.method==='GET'&&url.pathname==='/internal/roster-diagnose'){
      try{return await diagnoseRosterBinding(env,url);}catch(error){return json({success:false,error:error?.message||String(error)},500);}
    }
    if(request.method==='POST'&&url.pathname==='/v1/roster/member-number-lookup'){
      const downstream=await app.fetch(request.clone(),env,ctx);
      if(downstream.ok) return downstream;
      const failure=await downstream.clone().json().catch(()=>null);
      if(failure?.error!=='TDEA 即時名冊讀取失敗') return downstream;
      try{
        const body=await request.clone().json().catch(()=>({}));
        const match=await lookupLiveRosterMemberNumber(env,body);
        return json({success:true,match});
      }catch(error){
        return json({success:false,error:error?.message||'TDEA 即時名冊查詢失敗'},400);
      }
    }
    if(request.method==='PATCH'&&url.pathname==='/v1/me'){
      const response=await app.fetch(request.clone(),env,ctx);
      if(!response.ok) return response;
      const payload=await response.clone().json().catch(()=>null);
      try{
        const memberMaster=await syncUnifiedMemberMaster(env,request);
        return json(payload&&typeof payload==='object'?{...payload,memberMaster}: {success:true,memberMaster},response.status);
      }catch(error){
        console.error('Unified member master sync failed',error);
        return json({success:false,error:error?.message||'統一會員主檔同步失敗',profileSaved:true},502);
      }
    }
    return app.fetch(request,env,ctx);
  },
  scheduled(controller,env,ctx){return app.scheduled?.(controller,env,ctx);},
};
