import app from './profile-phone-entry.js';
import { sessionTokenFromCookie, verifySession } from './auth.js';
import { resolveCanonicalMemberId } from './member-repository.js';
import { awardPoints, getWallet } from './points.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const clean=(v,n=160)=>String(v??'').trim().slice(0,n);
const businessDate=()=>new Date(Date.now()+8*60*60*1000).toISOString().slice(0,10);

function authTokenFromRequest(request){
  const authorization=clean(request.headers.get('authorization'),4096);
  if(/^Bearer\s+/i.test(authorization)) return authorization.replace(/^Bearer\s+/i,'').trim();
  return sessionTokenFromCookie(request.headers.get('cookie')||'');
}

async function currentUserId(env,request){
  const claims=await verifySession(authTokenFromRequest(request),env.SESSION_SIGNING_SECRET);
  if(!claims?.sub) throw new Error('會員登入狀態已失效');
  return resolveCanonicalMemberId(env.DB,claims.sub);
}

async function ensureRemittanceColumns(db){
  const info=await db.prepare('PRAGMA table_info(course_registrations)').all();
  const names=new Set((info.results||[]).map(r=>String(r.name||'')));
  const ops=[];
  if(!names.has('last5_digits')) ops.push(db.prepare("ALTER TABLE course_registrations ADD COLUMN last5_digits TEXT NOT NULL DEFAULT ''"));
  if(!names.has('payment_status')) ops.push(db.prepare("ALTER TABLE course_registrations ADD COLUMN payment_status TEXT NOT NULL DEFAULT '未繳費'"));
  if(!names.has('remittance_updated_at')) ops.push(db.prepare('ALTER TABLE course_registrations ADD COLUMN remittance_updated_at TEXT'));
  if(ops.length) await db.batch(ops);
}

async function getRemittance(env,request,url){
  const userId=await currentUserId(env,request);
  const sessionId=clean(url.searchParams.get('sessionId'),160);
  if(!sessionId) return json({success:false,error:'缺少活動場次'},400);
  await ensureRemittanceColumns(env.DB);
  const row=await env.DB.prepare(`SELECT last5_digits,payment_status,remittance_updated_at,status FROM course_registrations WHERE course_session_id=? AND platform_user_id=? LIMIT 1`).bind(sessionId,userId).first();
  if(!row) return json({success:false,error:'查無報名紀錄'},404);
  return json({success:true,remittance:{last5Digits:row.last5_digits||'',paymentStatus:row.payment_status||'未繳費',updatedAt:row.remittance_updated_at||'',registrationStatus:row.status||''}});
}

async function saveRemittance(env,request){
  const userId=await currentUserId(env,request);
  const body=await request.json().catch(()=>({}));
  const sessionId=clean(body.sessionId,160);
  const last5=clean(body.last5Digits,5).replace(/\D/g,'');
  if(!sessionId) return json({success:false,error:'缺少活動場次'},400);
  if(last5.length<4||last5.length>5) return json({success:false,error:'請輸入正確的匯款後五碼'},400);
  await ensureRemittanceColumns(env.DB);
  const result=await env.DB.prepare(`UPDATE course_registrations SET last5_digits=?,payment_status='匯款審核中',remittance_updated_at=CURRENT_TIMESTAMP WHERE course_session_id=? AND platform_user_id=? AND status='registered'`).bind(last5,sessionId,userId).run();
  if(!result.meta?.changes) return json({success:false,error:'查無可更新的報名紀錄'},404);
  return json({success:true,remittance:{last5Digits:last5,paymentStatus:'匯款審核中'}});
}

async function directDailyCheckin(env,request){
  const userId=await currentUserId(env,request);
  const date=businessDate();
  const existing=await env.DB.prepare(`
    SELECT delta,balance_after FROM point_ledger_entries
    WHERE platform_user_id=? AND event_type='daily_ad_checkin' AND status='posted'
      AND date(created_at,'+8 hours')=?
    ORDER BY created_at DESC LIMIT 1
  `).bind(userId,date).first();
  if(existing){
    const wallet=await getWallet(env.DB,userId);
    return json({success:true,data:{alreadyChecked:true,points:Number(existing.delta||0),balance:Number(wallet.balance||0)}});
  }

  const pointResult=await awardPoints(env.DB,{
    userId,
    eventType:'daily_ad_checkin',
    eventReference:`daily:${date}`,
    idempotencyKey:`daily_checkin:${date}:${userId}`,
    metadata:{source:'direct_daily_checkin',businessDate:date},
  });
  if(pointResult.reason==='no_active_rule'){
    return json({success:false,error:'後台尚未啟用「每日簽到」點數規則'},400);
  }

  const wallet=await getWallet(env.DB,userId);
  const alreadyChecked=Boolean(pointResult.duplicate||pointResult.reason==='daily_limit_reached'||pointResult.reason==='once_only_reached');
  return json({
    success:true,
    data:{
      alreadyChecked,
      points:pointResult.awarded?Number(pointResult.entry?.delta||0):0,
      balance:Number(wallet.balance||0),
    },
    pointResult,
  });
}

async function legacyDailyAdInfo(env,request,ctx){
  const response=await app.fetch(request,env,ctx);
  if(!response.ok) return response;
  const payload=await response.clone().json().catch(()=>null);
  if(!payload||payload.campaign) return response;
  return json({
    ...payload,
    campaign:{id:'daily_direct',name:'每日簽到',requiredCreativeCount:0,rotationMode:'sequential'},
    creatives:Array.isArray(payload.creatives)?payload.creatives:[],
    qualifiedCreativeCount:Number(payload.qualifiedCreativeCount||0),
    qualifiedCreativeIds:Array.isArray(payload.qualifiedCreativeIds)?payload.qualifiedCreativeIds:[],
    checkedIn:false,
  });
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    try{
      if(request.method==='GET'&&url.pathname==='/v1/course-remittance') return await getRemittance(env,request,url);
      if(request.method==='POST'&&url.pathname==='/v1/course-remittance') return await saveRemittance(env,request);
      if(request.method==='POST'&&url.pathname==='/v1/daily-checkin') return await directDailyCheckin(env,request);
      if(request.method==='POST'&&url.pathname==='/v1/daily-ad/check-in') return await directDailyCheckin(env,request);
      if(request.method==='GET'&&url.pathname==='/v1/daily-ad') return await legacyDailyAdInfo(env,request,ctx);
    }catch(error){
      const fallback=url.pathname.includes('daily')?'每日簽到失敗':'匯款資料處理失敗';
      return json({success:false,error:error?.message||fallback},400);
    }
    return app.fetch(request,env,ctx);
  },
  scheduled(controller,env,ctx){return app.scheduled?.(controller,env,ctx);},
};
