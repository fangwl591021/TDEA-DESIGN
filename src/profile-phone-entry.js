import app from './business-crm-entry.js';

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

async function syncRosterPhone(env, profile){
  const memberType=clean(profile?.memberType,20).toLowerCase();
  const memberNumber=clean(profile?.memberNumber,80).toUpperCase();
  const phone=normalizePhone(profile?.phone);
  if(!['association','vendor'].includes(memberType)) return {synced:false,skipped:true,reason:'general_member'};
  if(!memberNumber) return {synced:false,skipped:true,reason:'missing_member_number'};
  if(!/^09\d{8}$/.test(phone)) throw new Error('請輸入正確的台灣行動電話');
  if(!env.TDEA_WORKER?.fetch) throw new Error('TDEA 名冊同步服務尚未連線');
  const response=await env.TDEA_WORKER.fetch(new Request('https://tdea-roster.internal/api/roster/member-contact',{
    method:'POST',
    headers:{'content-type':'application/json','accept':'application/json'},
    body:JSON.stringify({memberType,memberNumber,phone}),
  }));
  const result=await response.json().catch(()=>({}));
  if(!response.ok||result?.success!==true) throw new Error(result?.error||'TDEA 名冊電話同步失敗');
  return {synced:true,record:result.record||null};
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
      const profile=await request.clone().json().catch(()=>({}));
      const response=await app.fetch(request,env,ctx);
      if(!response.ok) return response;
      const payload=await response.clone().json().catch(()=>null);
      try{
        const rosterContact=await syncRosterPhone(env,profile);
        return json(payload&&typeof payload==='object'?{...payload,rosterContact}: {success:true,rosterContact},response.status);
      }catch(error){
        console.error('Roster phone sync failed',error);
        return json({success:false,error:error?.message||'TDEA 名冊電話同步失敗',profileSaved:true},502);
      }
    }
    return app.fetch(request,env,ctx);
  },
  scheduled(controller,env,ctx){return app.scheduled?.(controller,env,ctx);},
};
