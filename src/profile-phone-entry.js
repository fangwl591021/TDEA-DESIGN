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

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
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
