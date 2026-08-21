import app from './remittance-entry.js';
import { sessionTokenFromCookie, verifySession } from './auth.js';
import { resolveCanonicalMemberId } from './member-repository.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const clean=(value,max=240)=>String(value??'').trim().slice(0,max);
const allowedEventTypes=new Set(['session_start','page_view','click','form_submit','api_result','api_error','performance_warning','js_error','unhandled_rejection']);
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
const parseMetadata=(row)=>{try{return JSON.parse(row?.metadata_json||'{}')||{};}catch{return {};}};
const eventTime=(value)=>{const date=Date.parse(`${String(value||'').replace(' ','T')}Z`);return Number.isFinite(date)?date:0;};
const flowLabel=(flow)=>flow==='member_registration'?'會員註冊':flow==='activity_registration'?'活動報名':flow==='daily_checkin'?'每日簽到':flow==='card'?'名片功能':'一般操作';
const issueUser=(row)=>({
  userId:row.platform_user_id||'',
  displayName:row.display_name||'',
  memberNumber:row.member_number||'',
  sessionId:row.session_id||'',
});

function buildAlerts(issueRows=[],repeatRows=[]){
  const alerts=[];
  const keys=new Set();
  const push=(alert)=>{
    const key=alert.key||`${alert.severity}:${alert.sessionId}:${alert.title}:${alert.action}`;
    if(keys.has(key))return;
    keys.add(key);
    alerts.push({...alert,key});
  };

  for(const row of issueRows){
    const meta=parseMetadata(row);
    const flow=clean(meta.flow,60);
    const status=Number(meta.status||0);
    const durationMs=Number(meta.durationMs||0);
    const user=issueUser(row);
    const criticalFlow=['member_registration','activity_registration'].includes(flow);
    if(['api_error','js_error','unhandled_rejection'].includes(row.event_type)){
      const severity=(criticalFlow||status>=500||row.event_type!=='api_error')?'critical':'warning';
      push({
        severity,
        category:flowLabel(flow),
        title:criticalFlow?`${flowLabel(flow)}失敗`:row.event_type==='api_error'?'API 操作失敗':'前端程式錯誤',
        message:`${row.action||'操作'}｜${row.label||'發生錯誤'}${durationMs?`｜${durationMs}ms`:''}`,
        action:row.action||'',
        path:row.path||'',
        createdAt:row.created_at,
        ...user,
        metadata:meta,
      });
    }else if(row.event_type==='performance_warning'){
      push({
        severity:criticalFlow?'critical':'warning',
        category:flowLabel(flow),
        title:criticalFlow?`${flowLabel(flow)}回應過慢`:'系統回應過慢',
        message:`${row.action||'API'}｜${durationMs||0}ms`,
        action:row.action||'',path:row.path||'',createdAt:row.created_at,...user,metadata:meta,
      });
    }
  }

  for(const row of repeatRows){
    const flow=clean(row.flow,60);
    const count=Number(row.count||0);
    push({
      severity:['member_registration','activity_registration'].includes(flow)&&count>=3?'critical':'warning',
      category:flowLabel(flow),
      title:['member_registration','activity_registration'].includes(flow)?`${flowLabel(flow)}重複操作`:'疑似操作卡住',
      message:`同一操作在 10 分鐘內重複 ${count} 次：${row.label||row.action||'未命名操作'}`,
      action:row.action||'',createdAt:row.latest_at,...issueUser(row),metadata:{count,flow},
    });
  }

  const now=Date.now();
  const groups=new Map();
  for(const row of issueRows){
    const meta=parseMetadata(row);
    const flow=clean(meta.flow,60);
    if(!['member_registration','activity_registration'].includes(flow))continue;
    const key=`${row.session_id}:${flow}`;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push({...row,_meta:meta,_time:eventTime(row.created_at)});
  }
  for(const rows of groups.values()){
    rows.sort((a,b)=>a._time-b._time);
    const attempts=rows.filter((row)=>['click','form_submit'].includes(row.event_type));
    if(!attempts.length)continue;
    const attempt=attempts[attempts.length-1];
    if(now-attempt._time<60000||now-attempt._time>15*60*1000)continue;
    const flow=attempt._meta.flow;
    const success=rows.some((row)=>row._time>=attempt._time&&row.event_type==='api_result'&&Number(row._meta.status||0)>=200&&Number(row._meta.status||0)<400);
    const failed=rows.some((row)=>row._time>=attempt._time&&row.event_type==='api_error');
    if(success||failed)continue;
    push({
      severity:'warning',
      category:flowLabel(flow),
      title:`${flowLabel(flow)}可能卡住`,
      message:`使用者已開始${flowLabel(flow)}，超過 1 分鐘尚未看到成功或失敗結果。`,
      action:attempt.action||attempt.label||'',path:attempt.path||'',createdAt:attempt.created_at,...issueUser(attempt),metadata:{flow},
    });
  }

  return alerts.sort((a,b)=>{
    const weight=(value)=>value==='critical'?2:1;
    return weight(b.severity)-weight(a.severity)||eventTime(b.createdAt)-eventTime(a.createdAt);
  }).slice(0,100);
}

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
  const [events,summary,topActions,activeNow,issueEvents,repeatClicks]=await Promise.all([
    env.DB.prepare(`SELECT ue.id,ue.session_id,ue.platform_user_id,ue.event_type,ue.action,ue.label,ue.path,ue.target,ue.metadata_json,ue.user_agent,ue.country,ue.cf_ray,ue.client_time,ue.created_at,
      mp.display_name,mp.member_number
      FROM usage_events ue LEFT JOIN member_profiles mp ON mp.platform_user_id=ue.platform_user_id
      WHERE ${whereSql} ORDER BY ue.created_at DESC LIMIT ?`).bind(...values,limit).all(),
    env.DB.prepare(`SELECT
      COUNT(*) AS total_events,
      SUM(CASE WHEN event_type='page_view' THEN 1 ELSE 0 END) AS page_views,
      SUM(CASE WHEN event_type IN ('click','form_submit') THEN 1 ELSE 0 END) AS clicks,
      SUM(CASE WHEN event_type IN ('api_error','js_error','unhandled_rejection') THEN 1 ELSE 0 END) AS errors,
      COUNT(DISTINCT CASE WHEN platform_user_id IS NOT NULL AND platform_user_id!='' THEN platform_user_id ELSE session_id END) AS visitors
      FROM usage_events WHERE created_at >= datetime('now', ?)`).bind(modifier).first(),
    env.DB.prepare(`SELECT action,label,COUNT(*) AS count FROM usage_events
      WHERE created_at >= datetime('now', ?) AND event_type IN ('click','form_submit')
      GROUP BY action,label ORDER BY count DESC LIMIT 10`).bind(modifier).all(),
    env.DB.prepare(`SELECT COUNT(DISTINCT CASE WHEN platform_user_id IS NOT NULL AND platform_user_id!='' THEN platform_user_id ELSE session_id END) AS count
      FROM usage_events WHERE created_at >= datetime('now','-10 minutes')`).first(),
    env.DB.prepare(`SELECT ue.*,mp.display_name,mp.member_number
      FROM usage_events ue LEFT JOIN member_profiles mp ON mp.platform_user_id=ue.platform_user_id
      WHERE ue.created_at >= datetime('now','-60 minutes')
        AND ue.event_type IN ('click','form_submit','api_result','api_error','performance_warning','js_error','unhandled_rejection')
      ORDER BY ue.created_at DESC LIMIT 800`).all(),
    env.DB.prepare(`SELECT ue.session_id,ue.platform_user_id,ue.action,ue.label,MAX(ue.created_at) AS latest_at,COUNT(*) AS count,
      MAX(json_extract(ue.metadata_json,'$.flow')) AS flow,mp.display_name,mp.member_number
      FROM usage_events ue LEFT JOIN member_profiles mp ON mp.platform_user_id=ue.platform_user_id
      WHERE ue.created_at >= datetime('now','-10 minutes') AND ue.event_type IN ('click','form_submit') AND ue.action!=''
      GROUP BY ue.session_id,ue.platform_user_id,ue.action,ue.label,mp.display_name,mp.member_number
      HAVING COUNT(*) >= 3 ORDER BY count DESC LIMIT 50`).all(),
  ]);
  const alerts=buildAlerts(issueEvents.results||[],repeatClicks.results||[]);
  const affected=new Set(alerts.map((item)=>item.userId||item.sessionId).filter(Boolean));
  const criticalAlerts=alerts.filter((item)=>item.severity==='critical').length;
  const warningAlerts=alerts.filter((item)=>item.severity==='warning').length;
  return json({
    success:true,
    hours,
    health:{criticalAlerts,warningAlerts,affectedUsers:affected.size,status:criticalAlerts?'critical':warningAlerts?'warning':'healthy'},
    alerts,
    summary:{
      visitors:Number(summary?.visitors||0),
      pageViews:Number(summary?.page_views||0),
      clicks:Number(summary?.clicks||0),
      errors:Number(summary?.errors||0),
      totalEvents:Number(summary?.total_events||0),
      activeNow:Number(activeNow?.count||0),
    },
    topActions:(topActions.results||[]).map((row)=>({action:row.action||'',label:row.label||'',count:Number(row.count||0)})),
    events:(events.results||[]).map((row)=>({...row,metadata:parseMetadata(row)})),
  });
}

async function adminHtmlWithMonitoring(env,request,ctx){
  const response=await app.fetch(request,env,ctx);
  const contentType=response.headers.get('content-type')||'';
  if(!response.ok||!contentType.includes('text/html'))return response;
  const html=await response.text();
  if(html.includes('/admin-monitor.js'))return new Response(html,{status:response.status,headers:response.headers});
  const scripts='<script src="/usage-monitor.js?v=20260821-2" defer></script><script src="/admin-monitor.js?v=20260821-2" defer></script>';
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
