import app from './monitoring-entry.js';
import { sessionTokenFromCookie, verifySession } from './auth.js';
import { resolveCanonicalMemberId } from './member-repository.js';

const clean=(value,max=500)=>String(value??'').trim().slice(0,max);
let schemaReadyPromise=null;

function authTokenFromRequest(request){
  const authorization=clean(request.headers.get('authorization'),4096);
  if(/^Bearer\s+/i.test(authorization)) return authorization.replace(/^Bearer\s+/i,'').trim();
  return sessionTokenFromCookie(request.headers.get('cookie')||'');
}

async function optionalUserId(env,request){
  try{
    const token=authTokenFromRequest(request);
    if(!token)return '';
    const claims=await verifySession(token,env.SESSION_SIGNING_SECRET);
    if(!claims?.sub)return '';
    return await resolveCanonicalMemberId(env.DB,claims.sub);
  }catch{return '';}
}

async function ensureSchema(db){
  if(!schemaReadyPromise){
    schemaReadyPromise=db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS usage_events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        platform_user_id TEXT,
        event_type TEXT NOT NULL,
        action TEXT NOT NULL DEFAULT '',
        label TEXT NOT NULL DEFAULT '',
        path TEXT NOT NULL DEFAULT '',
        target TEXT NOT NULL DEFAULT '',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        user_agent TEXT NOT NULL DEFAULT '',
        country TEXT NOT NULL DEFAULT '',
        cf_ray TEXT NOT NULL DEFAULT '',
        client_time TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_usage_events_created_at ON usage_events(created_at DESC)'),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_usage_events_user ON usage_events(platform_user_id, created_at DESC)'),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_usage_events_session ON usage_events(session_id, created_at DESC)'),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_usage_events_type ON usage_events(event_type, created_at DESC)'),
    ]).catch((error)=>{schemaReadyPromise=null;throw error;});
  }
  return schemaReadyPromise;
}

function eventId(){return `srv_${Date.now().toString(36)}_${crypto.randomUUID().replaceAll('-','').slice(0,16)}`;}

function monitorSessionId(request,userId=''){
  const fromClient=clean(request.headers.get('x-tdea-monitor-session'),120);
  if(fromClient)return fromClient;
  if(userId)return `user_${userId}`;
  const ray=clean(request.headers.get('cf-ray'),100).split('-')[0];
  return ray?`ray_${ray}`:`server_${crypto.randomUUID().slice(0,12)}`;
}

function descriptor(url,method){
  const path=url.pathname;
  if(path==='/v1/telemetry/event'||path==='/v1/admin/monitoring'||path.startsWith('/v1/admin/'))return null;

  const register=path.match(/^\/v1\/course-sessions\/([^/]+)\/register$/);
  if(register&&method==='POST')return {kind:'activity_register',flow:'activity_registration',sessionId:decodeURIComponent(register[1]),logSuccess:true};

  if(method==='GET'&&(/course|activity|registration/i.test(path)))return {kind:'activity_view',flow:'activity_registration',sessionId:'',logSuccess:true};
  if(/\/v1\/(auth|session|member|profile|registration)/i.test(path))return {kind:'member_registration',flow:'member_registration',sessionId:'',logSuccess:method!=='GET'||path==='/v1/session'};
  if(path==='/v1/daily-checkin'||path==='/v1/daily-ad/check-in')return {kind:'daily_checkin',flow:'daily_checkin',sessionId:'',logSuccess:method==='POST'};
  if(/card|contact|business-crm/i.test(path))return {kind:'card',flow:'card',sessionId:'',logSuccess:method!=='GET'};
  if(['POST','PUT','PATCH','DELETE'].includes(method))return {kind:'mutation',flow:'',sessionId:'',logSuccess:true};
  return {kind:'generic',flow:'',sessionId:'',logSuccess:false};
}

async function activityTitle(env,sessionId){
  if(!sessionId)return '';
  try{
    const row=await env.DB.prepare('SELECT title FROM course_sessions WHERE id=? LIMIT 1').bind(sessionId).first();
    return clean(row?.title,160);
  }catch{return '';}
}

function labels(desc,status,title=''){
  const ok=status>=200&&status<400;
  const suffix=title?`：${title}`:'';
  if(desc.kind==='activity_register')return ok?`【後端確認】活動報名成功${suffix}`:`【後端警示】活動報名失敗${suffix}｜HTTP ${status}`;
  if(desc.kind==='activity_view')return ok?'【後端確認】進入活動／報名流程':`【後端警示】活動資料讀取失敗｜HTTP ${status}`;
  if(desc.kind==='member_registration')return ok?'【後端確認】會員註冊／登入流程成功':`【後端警示】會員註冊／登入失敗｜HTTP ${status}`;
  if(desc.kind==='daily_checkin')return ok?'【後端確認】每日簽到 API 成功':`【後端警示】每日簽到 API 失敗｜HTTP ${status}`;
  if(desc.kind==='card')return ok?'【後端確認】名片／CRM 操作成功':`【後端警示】名片／CRM 操作失敗｜HTTP ${status}`;
  return ok?'【後端確認】操作成功':`【後端警示】操作失敗｜HTTP ${status}`;
}

async function writeEvent(env,request,url,method,desc,status,durationMs,errorText=''){
  await ensureSchema(env.DB);
  const userId=await optionalUserId(env,request);
  const sessionId=monitorSessionId(request,userId);
  const title=desc.kind==='activity_register'?await activityTitle(env,desc.sessionId):'';
  const ok=status>=200&&status<400;
  const eventType=ok?'api_result':'api_error';
  const action=desc.kind==='activity_register'?`server.activity.register.${desc.sessionId}`:`server.${method.toLowerCase()}.${url.pathname}`;
  const metadata={source:'server',flow:desc.flow,status,durationMs,method,route:url.pathname,sessionId:desc.sessionId||'',error:errorText||''};
  await env.DB.prepare(`INSERT INTO usage_events
    (id,session_id,platform_user_id,event_type,action,label,path,target,metadata_json,user_agent,country,cf_ray,client_time)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(
      eventId(),sessionId,userId||null,eventType,clean(action,160),clean(labels(desc,status,title),240),clean(url.pathname+url.search,500),'server',JSON.stringify(metadata).slice(0,5000),
      clean(request.headers.get('user-agent'),700),clean(request.cf?.country||'',20),clean(request.headers.get('cf-ray'),100),new Date().toISOString(),
    ).run();
  if(durationMs>=5000){
    await env.DB.prepare(`INSERT INTO usage_events
      (id,session_id,platform_user_id,event_type,action,label,path,target,metadata_json,user_agent,country,cf_ray,client_time)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(
        eventId(),sessionId,userId||null,'performance_warning',clean(action,160),clean(`【後端警示】回應過慢｜${durationMs}ms`,240),clean(url.pathname+url.search,500),'server',JSON.stringify(metadata).slice(0,5000),
        clean(request.headers.get('user-agent'),700),clean(request.cf?.country||'',20),clean(request.headers.get('cf-ray'),100),new Date().toISOString(),
      ).run();
  }
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    const method=request.method.toUpperCase();
    const desc=url.pathname.startsWith('/v1/')?descriptor(url,method):null;
    const started=Date.now();
    try{
      const response=await app.fetch(request,env,ctx);
      if(desc&&(!response.ok||desc.logSuccess)){
        const task=writeEvent(env,request,url,method,desc,response.status,Date.now()-started).catch(()=>{});
        if(ctx?.waitUntil)ctx.waitUntil(task);else await task;
      }
      return response;
    }catch(error){
      if(desc){
        const task=writeEvent(env,request,url,method,desc,599,Date.now()-started,clean(error?.message,300)).catch(()=>{});
        if(ctx?.waitUntil)ctx.waitUntil(task);else await task;
      }
      throw error;
    }
  },
  scheduled(controller,env,ctx){return app.scheduled?.(controller,env,ctx);},
};
