import app from './cross-app-identity-entry.js';
import { sessionTokenFromCookie, verifySession } from './auth.js';
import { resolveCanonicalMemberId } from './member-repository.js';

const clean=(value,max=500)=>String(value??'').trim().slice(0,max);
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});

function authTokenFromRequest(request){
  const authorization=clean(request.headers.get('authorization'),4096);
  if(/^Bearer\s+/i.test(authorization))return authorization.replace(/^Bearer\s+/i,'').trim();
  return sessionTokenFromCookie(request.headers.get('cookie')||'');
}

async function requireMember(env,request){
  try{
    const token=authTokenFromRequest(request);
    if(!token)return '';
    const claims=await verifySession(token,env.SESSION_SIGNING_SECRET);
    if(!claims?.sub)return '';
    return await resolveCanonicalMemberId(env.DB,claims.sub);
  }catch{return '';}
}

function withTimeout(promise,ms,label){
  let timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`${label} timeout`)),ms);});
  return Promise.race([promise,timeout]).finally(()=>clearTimeout(timer));
}

async function readSource(env,path,label){
  if(!env.TDEA_WORKER||typeof env.TDEA_WORKER.fetch!=='function')throw new Error('TDEA service binding unavailable');
  const response=await withTimeout(env.TDEA_WORKER.fetch(`https://tdea.internal${path}`,{headers:{accept:'application/json'}}),2200,label);
  if(!response?.ok)throw new Error(`${label} HTTP ${response?.status||0}`);
  const text=await withTimeout(response.text(),1200,`${label} body`);
  if(text.length>2_000_000)throw new Error(`${label} payload too large`);
  return JSON.parse(text||'{}');
}

function safeUrl(value){
  const raw=clean(value,1200);
  if(!raw)return '';
  try{
    const url=new URL(raw);
    return ['http:','https:'].includes(url.protocol)?url.toString():'';
  }catch{return '';}
}

function activitiesFrom(payload){
  return (Array.isArray(payload?.data?.activities)?payload.data.activities:[])
    .filter((activity)=>clean(activity?.status,20)==='上架')
    .map((activity)=>({
      id:clean(activity?.id,160),
      title:clean(activity?.name,180),
      description:clean(activity?.detailText||activity?.description,900),
      courseTime:clean(activity?.courseTime,120),
      deadline:clean(activity?.deadline,120),
      capacity:Math.max(0,Number(activity?.capacity)||0),
      imageUrl:safeUrl(activity?.posterUrl||activity?.imageUrl||activity?.formSettings?.posterUrl),
      registrationUrl:safeUrl(activity?.nativeFormUrl||activity?.formUrl||activity?.formSettings?.nativeFormUrl),
    }))
    .filter((activity)=>activity.id&&activity.title)
    .slice(0,24);
}

function adsFrom(payload){
  const marquee=payload?.data||{};
  return (Array.isArray(marquee?.imageItems)?marquee.imageItems:[])
    .filter((item)=>item?.enabled!==false)
    .map((item)=>({
      id:clean(item?.id,160),
      title:clean(item?.title||marquee?.title||'TDEA 廣告贈點',120),
      imageUrl:safeUrl(item?.imageUrl),
      points:Math.max(1,Number(item?.points)||1),
    }))
    .filter((item)=>item.id&&item.imageUrl)
    .slice(0,20);
}

async function resilientShowcase(env,request){
  const memberId=await requireMember(env,request);
  if(!memberId)return json({success:false,error:'Unauthorized'},401);

  const [manager,marquee]=await Promise.allSettled([
    readSource(env,'/api/manager-data','manager-data'),
    readSource(env,'/api/marquee','marquee'),
  ]);

  const managerPayload=manager.status==='fulfilled'?manager.value:{};
  const marqueePayload=marquee.status==='fulfilled'?marquee.value:{};
  const activities=activitiesFrom(managerPayload);
  const ads=adsFrom(marqueePayload);
  const adLiffUrl=marquee.status==='fulfilled'?safeUrl(marqueePayload?.liffUrl):'';

  if(manager.status==='rejected'&&marquee.status==='rejected'){
    console.error('TDEA showcase sources failed',{manager:String(manager.reason),marquee:String(marquee.reason)});
    return json({success:false,error:'TDEA 內容暫時無法載入'},502);
  }

  if(manager.status==='rejected')console.warn('TDEA showcase manager degraded',{error:String(manager.reason)});
  if(marquee.status==='rejected')console.warn('TDEA showcase marquee degraded',{error:String(marquee.reason)});

  return json({
    success:true,
    activities,
    ads,
    adLiffUrl,
    degraded:manager.status==='rejected'||marquee.status==='rejected',
    sources:{manager:manager.status,marquee:marquee.status},
  });
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(request.method==='GET'&&url.pathname==='/v1/tdea-showcase'){
      return resilientShowcase(env,request);
    }
    return app.fetch(request,env,ctx);
  },
  scheduled(controller,env,ctx){return app.scheduled?.(controller,env,ctx);},
};
