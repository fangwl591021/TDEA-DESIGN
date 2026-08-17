import app from './business-crm-entry.js';

const json = (data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const clean=(v,n=160)=>String(v??'').trim().slice(0,n);
const normalizePhone=(v)=>clean(v,30).replace(/[^0-9+]/g,'').replace(/^\+8860?/,'0');

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
  if(!env.TDEA_WORKER?.fetch) return json({success:false,error:'TDEA_WORKER service binding missing'},503);
  const memberNo=clean(url.searchParams.get('memberNo'),80).toUpperCase();
  const name=clean(url.searchParams.get('name'),120);
  const response=await env.TDEA_WORKER.fetch(new Request('https://tdea-roster.internal/api/roster/live',{headers:{accept:'application/json','cache-control':'no-cache'}}));
  const roster=await response.json().catch(()=>null);
  if(!response.ok||!roster) return json({success:false,error:'service-binding live roster read failed',status:response.status},502);
  const a=Array.isArray(roster.a)?roster.a:[];
  const v=Array.isArray(roster.v)?roster.v:[];
  const normalizeName=(value)=>clean(value,160).replace(/\s+/g,'').toLowerCase();
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
