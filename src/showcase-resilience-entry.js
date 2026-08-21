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

async function lineUserIdForMember(env,memberId){
  if(!memberId||!env.DB)return '';
  const row=await env.DB.prepare(`
    SELECT ei.provider_subject AS line_user_id
    FROM external_identities ei
    LEFT JOIN member_account_aliases maa ON maa.alias_user_id=ei.platform_user_id
    WHERE ei.provider='line_login'
      AND ei.verification_status='verified'
      AND COALESCE(maa.canonical_user_id,ei.platform_user_id)=?
    ORDER BY COALESCE(ei.last_verified_at,ei.created_at) DESC
    LIMIT 1
  `).bind(memberId).first().catch(()=>null);
  return clean(row?.line_user_id,256);
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

async function directAdReward(env,request){
  const memberId=await requireMember(env,request);
  if(!memberId)return json({success:false,error:'請先登入會員'},401);
  if(!env.TDEA_WORKER||typeof env.TDEA_WORKER.fetch!=='function')return json({success:false,error:'廣告贈點服務暫時無法使用'},503);

  const body=await request.json().catch(()=>({}));
  const imageUrl=safeUrl(body?.imageUrl);
  const imageId=clean(body?.imageId,160);
  if(!imageUrl&&!imageId)return json({success:false,error:'找不到廣告資料'},400);

  const lineUserId=await lineUserIdForMember(env,memberId);
  if(!lineUserId)return json({success:false,error:'此會員尚未完成 LINE 身分綁定'},409);

  try{
    const response=await withTimeout(env.TDEA_WORKER.fetch('https://tdea.internal/api/marquee/reward',{
      method:'POST',
      headers:{'content-type':'application/json','accept':'application/json'},
      body:JSON.stringify({lineUserId,imageUrl,imageId}),
    }),5000,'ad reward');
    const text=await withTimeout(response.text(),1600,'ad reward body');
    const payload=JSON.parse(text||'{}');
    if(!response.ok||payload?.success===false){
      return json({success:false,error:clean(payload?.message||payload?.error,240)||'廣告贈點失敗'},response.status||502);
    }

    const adjustment=payload?.result?.serviceResult?.result||payload?.serviceResult?.result||{};
    const duplicate=Boolean(adjustment?.duplicate||payload?.duplicate);
    const adjusted=typeof adjustment?.adjusted==='boolean'?adjustment.adjusted:null;
    const awarded=duplicate?false:(adjusted===null?Boolean(payload?.awarded):adjusted);
    const balanceValue=payload?.balance??payload?.result?.balance??adjustment?.entry?.balanceAfter??adjustment?.entry?.balance_after;
    const balance=Number(balanceValue);

    return json({
      success:true,
      data:{
        awarded,
        duplicate,
        points:Math.max(0,Number(payload?.points)||0),
        balance:Number.isFinite(balance)?balance:null,
        imageId:clean(payload?.imageId||imageId,160),
      },
    });
  }catch(error){
    console.error('Direct ad reward failed',{error:String(error),memberId});
    return json({success:false,error:'廣告贈點暫時無法完成，請稍後再試'},504);
  }
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(request.method==='GET'&&url.pathname==='/v1/tdea-showcase'){
      return resilientShowcase(env,request);
    }
    if(request.method==='POST'&&url.pathname==='/v1/ad-reward'){
      return directAdReward(env,request);
    }
    return app.fetch(request,env,ctx);
  },
  scheduled(controller,env,ctx){return app.scheduled?.(controller,env,ctx);},
};
