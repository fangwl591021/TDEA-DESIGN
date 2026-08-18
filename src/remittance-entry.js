import app from './profile-phone-entry.js';
import { sessionTokenFromCookie, verifySession } from './auth.js';
import { resolveCanonicalMemberId } from './member-repository.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const clean=(v,n=160)=>String(v??'').trim().slice(0,n);

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

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    try{
      if(request.method==='GET'&&url.pathname==='/v1/course-remittance') return await getRemittance(env,request,url);
      if(request.method==='POST'&&url.pathname==='/v1/course-remittance') return await saveRemittance(env,request);
    }catch(error){
      return json({success:false,error:error?.message||'匯款資料處理失敗'},400);
    }
    return app.fetch(request,env,ctx);
  },
  scheduled(controller,env,ctx){return app.scheduled?.(controller,env,ctx);},
};
