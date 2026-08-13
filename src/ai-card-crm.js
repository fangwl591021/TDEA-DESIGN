import { ensureContactFirstTask } from "./personal-calendar.js";

export const AI_CARD_CRM_VERSION = "company-enrichment-v2";

const text = (value, max = 1000) => String(value || "").trim().slice(0, max);
const safeUrl = (value) => {
  const candidate = text(value, 2048);
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
};
const list = (value, limit, mapper) => Array.isArray(value) ? value.slice(0, limit).map(mapper).filter(Boolean) : [];

const COMPANY_KEYS = ["website","googleMap","facebook","instagram","youtube","linkedin","description","logoUrl","address","phone","email","taxId"];
const AI_CARD_CRM_SCHEMA = {
  type:"object",
  additionalProperties:false,
  required:["company","news","awards","knowledgeCard","firstTask","sources"],
  properties:{
    company:{
      type:"object",
      additionalProperties:false,
      required:COMPANY_KEYS,
      properties:Object.fromEntries(COMPANY_KEYS.map((key)=>[key,{type:"string"}])),
    },
    news:{type:"array",maxItems:5,items:{type:"object",additionalProperties:false,required:["title","summary","url"],properties:{title:{type:"string"},summary:{type:"string"},url:{type:"string"}}}},
    awards:{type:"array",maxItems:5,items:{type:"object",additionalProperties:false,required:["title","year","url"],properties:{title:{type:"string"},year:{type:"string"},url:{type:"string"}}}},
    knowledgeCard:{type:"object",additionalProperties:false,required:["summary","services","contactAngles"],properties:{summary:{type:"string"},services:{type:"array",maxItems:8,items:{type:"string"}},contactAngles:{type:"array",maxItems:5,items:{type:"string"}}}},
    firstTask:{type:"object",additionalProperties:false,required:["title","description","dueInDays"],properties:{title:{type:"string"},description:{type:"string"},dueInDays:{type:"integer",minimum:1,maximum:30}}},
    sources:{type:"array",maxItems:12,items:{type:"object",additionalProperties:false,required:["label","url"],properties:{label:{type:"string"},url:{type:"string"}}}},
  },
};

export function normaliseAiCardCrm(value = {}) {
  const company = Object.fromEntries(COMPANY_KEYS.map((key)=>[
    key,
    ["website","googleMap","facebook","instagram","youtube","linkedin","logoUrl"].includes(key)
      ? safeUrl(value.company?.[key])
      : text(value.company?.[key], key === "description" ? 1200 : 320),
  ]));
  return {
    status:["queued","processing","ready","failed"].includes(value.status) ? value.status : "",
    analysisVersion:text(value.analysisVersion, 60),
    company,
    news:list(value.news,5,(item)=>{
      const title=text(item?.title,180); const url=safeUrl(item?.url);
      return title ? {title,summary:text(item?.summary,500),url} : null;
    }),
    awards:list(value.awards,5,(item)=>{
      const title=text(item?.title,180); const url=safeUrl(item?.url);
      return title ? {title,year:text(item?.year,20),url} : null;
    }),
    knowledgeCard:{
      summary:text(value.knowledgeCard?.summary,1200),
      services:list(value.knowledgeCard?.services,8,(item)=>text(item,160)).filter(Boolean),
      contactAngles:list(value.knowledgeCard?.contactAngles,5,(item)=>text(item,240)).filter(Boolean),
    },
    firstTask:{
      title:text(value.firstTask?.title,100),
      description:text(value.firstTask?.description,1200),
      dueInDays:Math.max(1,Math.min(30,Number(value.firstTask?.dueInDays) || 3)),
      eventId:text(value.firstTask?.eventId,120),
    },
    sources:list(value.sources,12,(item)=>{
      const url=safeUrl(item?.url);
      return url ? {label:text(item?.label,120) || url,url} : null;
    }),
    updatedAt:text(value.updatedAt,80),
    error:text(value.error,240),
  };
}

export function aiCardCrmFromVersions(versionsJson = "{}") {
  try {
    const versions = JSON.parse(versionsJson || "{}") || {};
    return normaliseAiCardCrm(versions._aiCrm || {});
  } catch {
    return normaliseAiCardCrm();
  }
}

async function callAiResponses(provider, body) {
  if (!provider) throw new Error("MLM AI 服務尚未連線");
  const request = typeof provider !== "string"
    ? provider.fetch("https://mlm.internal/api/internal/ai/responses", {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({request:body})})
    : fetch("https://api.openai.com/v1/responses", {method:"POST",headers:{authorization:`Bearer ${provider}`,"content-type":"application/json"},body:JSON.stringify(body)});
  let timer;
  try {
    const timeout = new Promise((_, reject) => { timer=setTimeout(()=>reject(new Error("AI CRM 補全逾時，系統將自動重試")),70000); });
    const response = await Promise.race([request,timeout]);
    const result = await response.json().catch(()=>({}));
    if (!response.ok) throw new Error(result?.error?.message || result?.error || "AI CRM 補全服務暫時無法使用");
    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function generateAiCardCrm(provider, model, row) {
  const facts = {
    name:row.display_name || "",
    company:row.company_name || "",
    title:row.job_title || "",
    department:row.department || "",
    website:row.website_url || "",
    address:row.address || "",
    phone:row.company_phone || row.mobile || "",
    email:row.email || "",
    serviceDescription:row.service_description || "",
  };
  const result = await callAiResponses(provider, {
    model:model || "gpt-5.6-terra",
    reasoning:{effort:"low"},
    tools:[{type:"web_search"}],
    max_output_tokens:2800,
    input:[{role:"user",content:`你是繁體中文企業資料研究員。請用已確認的商務名片資料搜尋公開網路，建立可供 CRM 使用的公司知識卡與第一個跟進任務。\n\n名片資料：${JSON.stringify(facts)}\n\n規則：\n1. 依序用「姓名＋公司／職稱」、公司全名、電話原字串與純數字、完整地址、Email／網域做精確搜尋；不得只依模糊公司名稱配對。\n2. 公司名稱與統編優先查經濟部商工登記公示資料（findbiz.nat.gov.tw、gcis.nat.gov.tw、data.gcis.nat.gov.tw）或其他政府資料；律師、醫師等專業人士另查主管機關、公會與政府名冊。\n3. 只有電話、Email、完整地址、統編等強識別資料相符，或兩個獨立公開來源同時支持時，才可採用公司資料；Google Map、官網與社群只能輔助，避免混入同名對象。\n4. company 補全官網、Google Map、Facebook、Instagram、YouTube、LinkedIn、公司介紹、Logo 圖片網址、地址、電話、Email、統編；統編只能採政府登記或官方網站，查不到或無法確認時填空字串，不得猜測。\n5. news 與 awards 只收錄可由公開來源驗證的內容，無資料回傳空陣列。\n6. knowledgeCard.summary 濃縮公司定位；services 列出主要產品服務；contactAngles 提供後續商務溝通切入點。\n7. firstTask 必須是實際可執行的首次跟進，dueInDays 為 1 到 30 天。\n8. sources 列出本次採用的公開來源網址。只回傳符合 schema 的 JSON。`}],
    text:{format:{type:"json_schema",name:"ai_business_card_crm",strict:true,schema:AI_CARD_CRM_SCHEMA}},
  });
  const outputText=result.output_text || result.output?.flatMap((item)=>item.content || []).find((item)=>item.type==="output_text")?.text;
  if(!outputText)throw new Error("AI 未回傳公司 CRM 資料");
  return normaliseAiCardCrm({...JSON.parse(outputText),status:"ready",analysisVersion:AI_CARD_CRM_VERSION,updatedAt:new Date().toISOString(),error:""});
}

async function writeMeta(db, row, value) {
  const normalized = normaliseAiCardCrm(value);
  await db.prepare(`UPDATE contact_cards
    SET versions_json=json_set(COALESCE(NULLIF(versions_json,''),'{}'),'$._aiCrm',json(?)),updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND scanner_user_id=? AND status='active'`)
    .bind(JSON.stringify(normalized),row.id,row.scanner_user_id).run();
  return normalized;
}

function needsBackfill(meta) {
  return meta.status !== "ready" || meta.analysisVersion !== AI_CARD_CRM_VERSION;
}

export async function queueContactAiCardCrm(db, userId, id, force = false) {
  const row=await db.prepare(`SELECT cc.* FROM contact_cards cc JOIN card_import_events cie ON cie.id=cc.source_event_id WHERE cc.id=? AND cc.scanner_user_id=? AND cc.status='active' AND COALESCE(cc.source_event_id,'')!='' AND cie.status IN ('created','updated') AND cc.display_name NOT IN ('名片 AI 分析中','名片辨識未完成','名片分析未完成')`).bind(id,userId).first();
  if(!row)return false;
  const current=aiCardCrmFromVersions(row.versions_json);
  if(!force && (!needsBackfill(current) || ["queued","processing"].includes(current.status)))return false;
  await writeMeta(db,row,{...current,status:"queued",error:"",updatedAt:new Date().toISOString()});
  return true;
}

export async function processContactAiCardCrm(db, userId, id, provider, model) {
  const row=await db.prepare(`SELECT cc.* FROM contact_cards cc JOIN card_import_events cie ON cie.id=cc.source_event_id WHERE cc.id=? AND cc.scanner_user_id=? AND cc.status='active' AND COALESCE(cc.source_event_id,'')!='' AND cie.status IN ('created','updated') AND cc.display_name NOT IN ('名片 AI 分析中','名片辨識未完成','名片分析未完成')`).bind(id,userId).first();
  if(!row)return null;
  const current=aiCardCrmFromVersions(row.versions_json);
  await writeMeta(db,row,{...current,status:"processing",error:"",updatedAt:new Date().toISOString()});
  try {
    const generated=await generateAiCardCrm(provider,model,row);
    const event=await ensureContactFirstTask(db,userId,id,generated.firstTask);
    return writeMeta(db,row,{...generated,firstTask:{...generated.firstTask,eventId:event.id}});
  } catch(error) {
    await writeMeta(db,row,{...current,status:"failed",error:error.message || "AI CRM 補全失敗",updatedAt:new Date().toISOString()});
    console.error("AI business-card CRM enrichment failed",error);
    return null;
  }
}

async function queueBackfillRows(db, whereSql, bindings, limit) {
  const capped=Math.max(1,Math.min(Number(limit)||2,10));
  const result=await db.prepare(`SELECT cc.* FROM contact_cards cc JOIN card_import_events cie ON cie.id=cc.source_event_id WHERE cc.status='active' AND COALESCE(cc.source_event_id,'')!='' AND cie.status IN ('created','updated') AND cc.display_name NOT IN ('名片 AI 分析中','名片辨識未完成','名片分析未完成') AND ${whereSql}
    AND (
      COALESCE(json_extract(versions_json,'$._aiCrm.status'),'') NOT IN ('ready','queued','processing')
      OR COALESCE(json_extract(versions_json,'$._aiCrm.analysisVersion'),'')!=?
      OR (json_extract(versions_json,'$._aiCrm.status') IN ('queued','processing') AND updated_at<=datetime('now','-8 minutes'))
    )
    ORDER BY updated_at ASC LIMIT ?`).bind(...bindings,AI_CARD_CRM_VERSION,capped).all();
  const rows=result.results || [];
  for(const row of rows)await writeMeta(db,row,{...aiCardCrmFromVersions(row.versions_json),status:"queued",error:"",updatedAt:new Date().toISOString()});
  return rows.map((row)=>({id:row.id,userId:row.scanner_user_id}));
}

export function queueMemberAiCardCrmBackfill(db, userId, limit = 2) {
  return queueBackfillRows(db,"scanner_user_id=?",[userId],limit);
}

export function queueSystemAiCardCrmBackfill(db, limit = 2) {
  return queueBackfillRows(db,"1=1",[],limit);
}
