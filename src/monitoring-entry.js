import app from './remittance-entry.js';
import { sessionTokenFromCookie, verifySession } from './auth.js';
import { resolveCanonicalMemberId } from './member-repository.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const clean=(value,max=240)=>String(value??'').trim().slice(0,max);
const allowedEventTypes=new Set(['session_start','page_view','click','api_error','js_error','unhandled_rejection']);
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

async function ensureMonitoringSchema(db){
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

function eventId(){
  return `usage_${Date.now().toString(36)}_${crypto.randomUUID().replaceAll('-','').slice(0,16)}`;
}

function safeMetadata(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return '{}';
  const safe={};
  for(const [key,raw] of Object.entries(value).slice(0,30)){
    const safeKey=clean(key,80);
    if(!safeKey)continue;
    if(typeof raw==='number'||typeof raw==='boolean'||raw===null)safe[safeKey]=raw;
    else safe[safeKey]=clean(raw,500);
  }
  return JSON.stringify(safe).slice(0,5000);
}

async function recordUsageEvent(env,request){
  await ensureMonitoringSchema(env.DB);
  const body=await request.json().catch(()=>({}));
  const eventType=clean(body.eventType,50);
  if(!allowedEventTypes.has(eventType))return json({success:false,error:'Unsupported monitoring event'},400);
  const sessionId=clean(body.sessionId,120);
  if(!sessionId)return json({success:false,error:'Missing monitoring session'},400);
  const userId=await optionalUserId(env,request);
  await env.DB.prepare(`INSERT INTO usage_events
    (id,session_id,platform_user_id,event_type,action,label,path,target,metadata_json,user_agent,country,cf_ray,client_time)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(
      eventId(),sessionId,userId||null,eventType,
      clean(body.action,160),clean(body.label,240),clean(body.path,500),clean(body.target,240),safeMetadata(body.metadata),
      clean(request.headers.get('user-agent'),700),clean(request.cf?.country||'',20),clean(request.headers.get('cf-ray'),100),clean(body.clientTime,80),
    ).run();
  return new Response(null,{status:204});
}

async function requireAdmin(env,request,ctx){
  const url=new URL(request.url);
  url.pathname='/v1/admin/overview';
  url.search='';
  const checkRequest=new Request(url.toString(),{method:'GET',headers:request.headers});
  const response=await app.fetch(checkRequest,env,ctx);
  return response.ok;
}

const clamp=(value,min,max,fallback)=>{const number=Number(value);return Number.isFinite(number)?Math.min(max,Math.max(min,Math.floor(number))):fallback;};

async function monitoringReport(env,request,ctx){
  if(!await requireAdmin(env,request,ctx))return json({success:false,error:'Unauthorized'},401);
  await ensureMonitoringSchema(env.DB);
  const url=new URL(request.url);
  const hours=clamp(url.searchParams.get('hours'),1,720,24);
  const limit=clamp(url.searchParams.get('limit'),20,500,200);
  const eventType=clean(url.searchParams.get('eventType'),50);
  const query=clean(url.searchParams.get('q'),160).toLowerCase();
  const modifier=`-${hours} hours`;
  const where=['ue.created_at >= datetime(\'now\', ?)'];
  const values=[modifier];
  if(eventType&&allowedEventTypes.has(eventType)){where.push('ue.event_type = ?');values.push(eventType);}
  if(query){
    where.push(`LOWER(COALESCE(mp.display_name,'') || ' ' || COALESCE(mp.member_number,'') || ' ' || ue.action || ' ' || ue.label || ' ' || ue.path || ' ' || ue.session_id) LIKE ?`);
    values.push(`%${query}%`);
  }
  const whereSql=where.join(' AND ');
  const [events,summary,topActions,activeNow]=await Promise.all([
    env.DB.prepare(`SELECT ue.id,ue.session_id,ue.platform_user_id,ue.event_type,ue.action,ue.label,ue.path,ue.target,ue.metadata_json,ue.user_agent,ue.country,ue.cf_ray,ue.client_time,ue.created_at,
      mp.display_name,mp.member_number
      FROM usage_events ue LEFT JOIN member_profiles mp ON mp.platform_user_id=ue.platform_user_id
      WHERE ${whereSql} ORDER BY ue.created_at DESC LIMIT ?`).bind(...values,limit).all(),
    env.DB.prepare(`SELECT
      COUNT(*) AS total_events,
      SUM(CASE WHEN event_type='page_view' THEN 1 ELSE 0 END) AS page_views,
      SUM(CASE WHEN event_type='click' THEN 1 ELSE 0 END) AS clicks,
      SUM(CASE WHEN event_type IN ('api_error','js_error','unhandled_rejection') THEN 1 ELSE 0 END) AS errors,
      COUNT(DISTINCT CASE WHEN platform_user_id IS NOT NULL AND platform_user_id!='' THEN platform_user_id ELSE session_id END) AS visitors
      FROM usage_events WHERE created_at >= datetime('now', ?)`).bind(modifier).first(),
    env.DB.prepare(`SELECT action,label,COUNT(*) AS count FROM usage_events
      WHERE created_at >= datetime('now', ?) AND event_type='click'
      GROUP BY action,label ORDER BY count DESC LIMIT 10`).bind(modifier).all(),
    env.DB.prepare(`SELECT COUNT(DISTINCT CASE WHEN platform_user_id IS NOT NULL AND platform_user_id!='' THEN platform_user_id ELSE session_id END) AS count
      FROM usage_events WHERE created_at >= datetime('now','-10 minutes')`).first(),
  ]);
  return json({
    success:true,
    hours,
    summary:{
      visitors:Number(summary?.visitors||0),
      pageViews:Number(summary?.page_views||0),
      clicks:Number(summary?.clicks||0),
      errors:Number(summary?.errors||0),
      totalEvents:Number(summary?.total_events||0),
      activeNow:Number(activeNow?.count||0),
    },
    topActions:(topActions.results||[]).map((row)=>({action:row.action||'',label:row.label||'',count:Number(row.count||0)})),
    events:(events.results||[]).map((row)=>{
      let metadata={};
      try{metadata=JSON.parse(row.metadata_json||'{}');}catch{}
      return {...row,metadata};
    }),
  });
}

async function adminHtmlWithMonitoring(env,request,ctx){
  const response=await app.fetch(request,env,ctx);
  const contentType=response.headers.get('content-type')||'';
  if(!response.ok||!contentType.includes('text/html'))return response;
  const html=await response.text();
  if(html.includes('/admin-monitor.js'))return new Response(html,{status:response.status,headers:response.headers});
  const scripts='<script src="/usage-monitor.js?v=20260821-1" defer></script><script src="/admin-monitor.js?v=20260821-1" defer></script>';
  const body=html.includes('</body>')?html.replace('</body>',`${scripts}</body>`):`${html}${scripts}`;
  const headers=new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control','no-store');
  return new Response(body,{status:response.status,headers});
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    try{
      if(request.method==='POST'&&url.pathname==='/v1/telemetry/event')return await recordUsageEvent(env,request);
      if(request.method==='GET'&&url.pathname==='/v1/admin/monitoring')return await monitoringReport(env,request,ctx);
      if(request.method==='GET'&&['/admin','/admin/','/admin/index.html','/admin.html'].includes(url.pathname))return await adminHtmlWithMonitoring(env,request,ctx);
    }catch(error){
      if(url.pathname==='/v1/telemetry/event')return new Response(null,{status:204});
      return json({success:false,error:error?.message||'監控資料讀取失敗'},500);
    }
    return app.fetch(request,env,ctx);
  },
  scheduled(controller,env,ctx){return app.scheduled?.(controller,env,ctx);},
};
