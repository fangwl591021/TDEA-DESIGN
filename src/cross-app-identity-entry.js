import app from './server-monitor-entry.js';

const clean=(value,max=500)=>String(value??'').trim().slice(0,max);

function eventId(){
  return `xapp_${Date.now().toString(36)}_${crypto.randomUUID().replaceAll('-','').slice(0,16)}`;
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

async function inferUserId(db,sessionId){
  if(!sessionId)return '';
  const row=await db.prepare(`SELECT platform_user_id FROM usage_events
    WHERE session_id=? AND platform_user_id IS NOT NULL AND platform_user_id!=''
    ORDER BY created_at DESC LIMIT 1`).bind(sessionId).first().catch(()=>null);
  return clean(row?.platform_user_id,240);
}

async function recordCrossAppTelemetry(env,request,body,userId){
  const sessionId=clean(body.sessionId,120);
  const eventType=clean(body.eventType,50);
  if(!sessionId||!eventType)return null;
  const metadata=body.metadata&&typeof body.metadata==='object'&&!Array.isArray(body.metadata)?body.metadata:{};
  const source=clean(metadata.source,80);
  if(source!=='tdeawork')return null;

  const resolvedUserId=userId||await inferUserId(env.DB,sessionId);
  if(!resolvedUserId)return null;

  await env.DB.batch([
    env.DB.prepare(`UPDATE usage_events SET platform_user_id=?
      WHERE session_id=? AND (platform_user_id IS NULL OR platform_user_id='')
        AND created_at>=datetime('now','-2 hours')`).bind(resolvedUserId,sessionId),
    env.DB.prepare(`INSERT INTO usage_events
      (id,session_id,platform_user_id,event_type,action,label,path,target,metadata_json,user_agent,country,cf_ray,client_time)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
        eventId(),sessionId,resolvedUserId,eventType,
        clean(body.action,160),clean(body.label,240),clean(body.path,500),clean(body.target,240),safeMetadata(metadata),
        clean(request.headers.get('user-agent'),700),clean(request.cf?.country||'',20),clean(request.headers.get('cf-ray'),100),clean(body.clientTime,80),
      ),
  ]);
  return new Response(null,{status:204});
}

function timeoutResponse(label){
  return new Response(JSON.stringify({success:false,message:`${label} timeout`}),{
    status:504,
    headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'},
  });
}

function withDeadline(promise,ms,label){
  let timer;
  const timeout=new Promise((resolve)=>{
    timer=setTimeout(()=>resolve(timeoutResponse(label)),ms);
  });
  return Promise.race([promise,timeout]).finally(()=>clearTimeout(timer));
}

function showcaseEnv(env){
  const binding=env?.TDEA_WORKER;
  if(!binding||typeof binding.fetch!=='function')return env;

  const fastBinding={
    fetch(input,init){
      let url;
      try{
        url=new URL(input instanceof Request?input.url:String(input));
      }catch{
        return binding.fetch(input,init);
      }

      // Showcase only needs activity records. /api/manager-data also merges roster/AIWE
      // data, which is much heavier and can make the entire showcase wait indefinitely.
      if(url.pathname==='/api/manager-data')url.pathname='/api/activities';

      let outbound;
      if(input instanceof Request){
        outbound=new Request(url.toString(),input);
        outbound=binding.fetch(outbound,init);
      }else{
        outbound=binding.fetch(url.toString(),init);
      }

      if(url.pathname==='/api/activities'||url.pathname==='/api/marquee'){
        return withDeadline(outbound,4500,url.pathname);
      }
      return outbound;
    },
  };

  return new Proxy(env,{
    get(target,prop,receiver){
      if(prop==='TDEA_WORKER')return fastBinding;
      return Reflect.get(target,prop,receiver);
    },
  });
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(request.method==='POST'&&url.pathname==='/v1/telemetry/event'){
      const hasUserAuth=Boolean(clean(request.headers.get('authorization'),4096)||clean(request.headers.get('cookie'),4096));
      if(!hasUserAuth){
        const clone=request.clone();
        const body=await clone.json().catch(()=>null);
        if(body){
          const handled=await recordCrossAppTelemetry(env,request,body,'').catch(()=>null);
          if(handled)return handled;
        }
      }
    }

    if(request.method==='GET'&&url.pathname==='/v1/tdea-showcase'){
      return app.fetch(request,showcaseEnv(env),ctx);
    }

    return app.fetch(request,env,ctx);
  },
  scheduled(controller,env,ctx){return app.scheduled?.(controller,env,ctx);},
};
