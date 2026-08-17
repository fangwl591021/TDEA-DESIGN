import { newId } from './member-repository.js';
import { sha256 } from './auth.js';
import { memberMatchFromVersions } from './member-match-ranking.js';
import { aiCardCrmFromVersions } from './ai-card-crm.js';

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const FIELD_LIMITS = { displayName:120, englishName:120, companyName:180, jobTitle:120, department:120, mobile:40, companyPhone:40, email:320, websiteUrl:2048, lineUrl:2048, address:300, serviceDescription:1600, note:1000 };
const CRM_PROFILE_LIMITS = { birthday:10, gender:20, family:800, occupation:800, recreation:800, money:800, health:800, dream:800 };
const text = (value, max = 1000) => String(value || '').trim().slice(0, max);
const CARD_VERSIONS = ['standard', 'full', 'square'];
const VERSION_LAYOUT = { standard:'landscape', full:'portrait', square:'square' };
const DEFAULT_CHAT_ALT_TEXT = '您收到一張數位名片';
const normaliseTextAlign = (value) => ['left', 'center', 'right'].includes(String(value || '')) ? String(value) : 'left';
export const INDUSTRY_OPTIONS = [
  '健康醫療','美容美業','餐飲食品','零售電商','直銷／社群電商',
  '金融保險','房地產居家','工商專業服務','教育培訓','科技資訊',
  '行銷設計媒體','製造批發貿易','旅遊交通服務','社團協會公益','其他行業',
];
const INDUSTRY_PENDING = '待分類';
const INDUSTRY_SET = new Set(INDUSTRY_OPTIONS);

function normaliseButtons(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 4).map((item, index) => {
    const label = text(item?.label, 24);
    const type = ['url','phone','email','line','map'].includes(item?.type) ? item.type : 'url';
    let target = text(item?.value, 2048);
    if (!label || !target) return null;
    if (type === 'phone') target = `tel:${target.replace(/^tel:/i, '').replace(/[\s()-]/g, '')}`;
    if (type === 'email') target = `mailto:${target.replace(/^mailto:/i, '')}`;
    if (type === 'map' && !/^https?:\/\//i.test(target)) target = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(target)}`;
    if (['url','line'].includes(type) && !/^https?:\/\//i.test(target)) return null;
    return { label, type, value:target, color:/^#[0-9a-f]{6}$/i.test(String(item?.color || '')) ? String(item.color) : '#B96072', order:index + 1, enabled:item?.enabled !== false };
  }).filter(Boolean);
}
function defaultButtons(row = {}) {
  const phone = text(row.mobile || row.company_phone, 40).replace(/[\s()-]/g, '');
  const line = text(row.line_url, 2048);
  const address = text(row.address, 300);
  return normaliseButtons([
    { label:'撥打電話', type:phone ? 'phone' : 'url', value:phone || 'https://www.google.com/', color:'#B96072' },
    { label:'加入 LINE 好友', type:line ? 'line' : 'url', value:line || 'https://www.google.com/', color:'#B96072' },
    { label:'店家地址', type:address ? 'map' : 'url', value:address || 'https://www.google.com/', color:'#8D6A54' },
  ]);
}
function parseVersions(row = {}) {
  let source = {}; try { source = JSON.parse(row.versions_json || '{}'); } catch {}
  const defaults = defaultButtons(row);
  return Object.fromEntries(CARD_VERSIONS.map((id) => {
    const value = source?.[id] || {};
    return [id, { coverUrl:text(value.coverUrl, 2048), title:text(value.title, 120), description:text(value.description, 1600), serviceTextAlign:normaliseTextAlign(value.serviceTextAlign), descriptionTextAlign:normaliseTextAlign(value.descriptionTextAlign), buttons:normaliseButtons(value.buttons).length ? normaliseButtons(value.buttons) : defaults, buttonDefaultsSeeded:value.buttonDefaultsSeeded === true, layout:VERSION_LAYOUT[id] }];
  }));
}
function normaliseVersions(value, row = {}) {
  const source = rawVersions(row);
  const normalized = parseVersions({ ...row, versions_json:JSON.stringify(value && typeof value === 'object' ? value : {}) });
  if (source._crmInsights) normalized._crmInsights = source._crmInsights;
  if (source._industry) normalized._industry = source._industry;
  if (source._memberMatch) normalized._memberMatch = source._memberMatch;
  if (source._aiCrm) normalized._aiCrm = source._aiCrm;
  if (source._crmProfile) normalized._crmProfile = source._crmProfile;
  return normalized;
}
export const normalizePhone = (value) => text(value, 60).replace(/[^0-9+]/g, '').replace(/^\+8860?/, '0');
export const normalizeEmail = (value) => text(value, 320).toLowerCase();
export const normalizeNameCompany = (name, company) => `${text(name, 120)}|${text(company, 180)}`.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');

function cleanCard(input = {}) {
  const card = {};
  for (const [key, limit] of Object.entries(FIELD_LIMITS)) card[key] = text(input[key], limit);
  if (!card.displayName) throw new Error('請確認名片姓名');
  card.normalizedMobile = normalizePhone(card.mobile);
  card.normalizedEmail = normalizeEmail(card.email);
  card.normalizedNameCompany = normalizeNameCompany(card.displayName, card.companyName);
  return card;
}

function rawVersions(row = {}) {
  try { return JSON.parse(row.versions_json || '{}') || {}; } catch { return {}; }
}
export function normaliseCrmProfile(value = {}) {
  const profile=Object.fromEntries(Object.entries(CRM_PROFILE_LIMITS).map(([key,limit])=>[key,text(value?.[key],limit)]));
  if(!['','male','female','other'].includes(profile.gender))profile.gender='';
  if(profile.birthday){
    const parsed=new Date(`${profile.birthday}T00:00:00Z`);
    const today=new Date().toISOString().slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(profile.birthday) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0,10)!==profile.birthday || profile.birthday>today)profile.birthday='';
  }
  return profile;
}
function crmProfileMeta(row = {}) {
  return normaliseCrmProfile(rawVersions(row)._crmProfile || {});
}
function insightMeta(row = {}) {
  const value = rawVersions(row)._crmInsights || {};
  return {
    status:['queued','processing','ready','failed'].includes(value.status) ? value.status : '',
    cards:value.cards && typeof value.cards === 'object' ? value.cards : {},
    updatedAt:text(value.updatedAt, 80),
    error:text(value.error, 180),
    analysisVersion:text(value.analysisVersion, 40),
  };
}
export function normaliseIndustryClassification(value = {}) {
  const requestedPrimary = INDUSTRY_SET.has(value.primary) ? value.primary : INDUSTRY_PENDING;
  const requestedSecondary = Array.isArray(value.secondary)
    ? [...new Set(value.secondary.filter((item)=>INDUSTRY_SET.has(item)))]
    : [];
  const primary = value.source === 'manual' && requestedPrimary === INDUSTRY_PENDING && requestedSecondary.length
    ? requestedSecondary[0]
    : requestedPrimary;
  const secondary = requestedSecondary.filter((item)=>item !== primary).slice(0,2);
  const confidence = Math.max(0,Math.min(1,Number(value.confidence) || 0));
  const uncertain = value.source !== 'manual' && (primary === INDUSTRY_PENDING || confidence < 0.6);
  return {
    primary:uncertain ? INDUSTRY_PENDING : primary,
    secondary:uncertain ? [] : secondary,
    source:value.source === 'manual' ? 'manual' : uncertain ? 'pending' : 'ai',
    confidence,
    classifiedAt:text(value.classifiedAt,80),
    manualLocked:value.source === 'manual' || value.manualLocked === true,
  };
}
function industryMeta(row = {}) {
  return normaliseIndustryClassification(rawVersions(row)._industry || {});
}
function withIndustryMeta(row, value, preserveManual = true) {
  const source=rawVersions(row);
  const existing=industryMeta(row);
  source._industry=preserveManual && existing.manualLocked
    ? existing
    : normaliseIndustryClassification(value);
  return JSON.stringify(source);
}
function industryFromOcr(result = {}) {
  return normaliseIndustryClassification({
    primary:result.primaryIndustry,
    secondary:result.secondaryIndustries,
    confidence:result.industryConfidence,
    source:'ai',
    classifiedAt:new Date().toISOString(),
  });
}
function rowToCard(row) {
  if (!row) return null;
  const versions = parseVersions(row);
  const selectedVersion = CARD_VERSIONS.includes(row.selected_version) ? row.selected_version : 'standard';
  const selected = versions[selectedVersion];
  return { id:row.id, sourceType:row.source_type, sourcePersonalCardId:row.source_personal_card_id || '', displayName:row.display_name, englishName:row.english_name, companyName:row.company_name, jobTitle:row.job_title, department:row.department, mobile:row.mobile, companyPhone:row.company_phone, email:row.email, websiteUrl:row.website_url, lineUrl:row.line_url, address:row.address, serviceDescription:row.service_description, note:row.note, crmProfile:crmProfileMeta(row), chatAltText:row.chat_alt_text || DEFAULT_CHAT_ALT_TEXT, selectedVersion, versions, coverUrl:selected.coverUrl, buttons:selected.buttons, hasImage:Boolean(row.front_r2_key), aiInsights:insightMeta(row), aiCrm:aiCardCrmFromVersions(row.versions_json), industry:industryMeta(row), memberMatch:memberMatchFromVersions(row.versions_json), createdAt:row.created_at, updatedAt:row.updated_at };
}

async function findDuplicate(db, ownerId, card, excludedId = '') {
  const clauses = [];
  const bindings = [ownerId];
  if (card.normalizedMobile) { clauses.push('normalized_mobile = ?'); bindings.push(card.normalizedMobile); }
  if (card.normalizedEmail) { clauses.push('normalized_email = ?'); bindings.push(card.normalizedEmail); }
  if (card.normalizedNameCompany) { clauses.push('normalized_name_company = ?'); bindings.push(card.normalizedNameCompany); }
  if (!clauses.length) return null;
  let sql = `SELECT * FROM contact_cards WHERE scanner_user_id = ? AND status = 'active' AND (${clauses.join(' OR ')})`;
  if (excludedId) { sql += ' AND id != ?'; bindings.push(excludedId); }
  return db.prepare(`${sql} ORDER BY updated_at DESC LIMIT 1`).bind(...bindings).first();
}

function bytesToBase64(buffer) {
  const bytes = new Uint8Array(buffer); let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const OCR_SCHEMA = { type:'object', additionalProperties:false, required:['isBusinessCard','confidence','language','primaryIndustry','secondaryIndustries','industryConfidence',...Object.keys(FIELD_LIMITS)], properties:{ isBusinessCard:{type:'boolean'}, confidence:{type:'number'}, language:{type:'string'}, primaryIndustry:{type:'string',enum:[INDUSTRY_PENDING,...INDUSTRY_OPTIONS]}, secondaryIndustries:{type:'array',maxItems:2,items:{type:'string',enum:INDUSTRY_OPTIONS}}, industryConfidence:{type:'number'}, ...Object.fromEntries(Object.keys(FIELD_LIMITS).map((key)=>[key,{type:'string'}])) } };
export const OCR_VERIFICATION_VERSION = 'visual-web-v2';
const OCR_VERIFICATION_SCHEMA = {
  ...OCR_SCHEMA,
  required:[...OCR_SCHEMA.required,'verificationVersion','verificationConfidence','verificationNotes','verificationSources'],
  properties:{
    ...OCR_SCHEMA.properties,
    verificationVersion:{type:'string',enum:[OCR_VERIFICATION_VERSION]},
    verificationConfidence:{type:'number',minimum:0,maximum:1},
    verificationNotes:{type:'string'},
    verificationSources:{type:'array',maxItems:10,items:{type:'object',additionalProperties:false,required:['label','url','matchedFields'],properties:{label:{type:'string'},url:{type:'string'},matchedFields:{type:'array',maxItems:6,items:{type:'string'}}}}},
  },
};
const CONTENT_EXPANSION_SCHEMA = { type:'object', additionalProperties:false, required:['items'], properties:{ items:{ type:'array', minItems:3, maxItems:5, items:{ type:'string' } } } };
const CRM_INSIGHT_KEYS = ['personality','interests','wealth','health','career'];
const CRM_INSIGHT_ANALYSIS_VERSION = 'line-fate-industry-v2';
const CRM_INSIGHT_SOURCE_KEYS = ['displayName','companyName','jobTitle','department','serviceDescription','note','address'];
const CRM_INSIGHTS_SCHEMA = {
  type:'object',
  additionalProperties:false,
  required:[...CRM_INSIGHT_KEYS,'primaryIndustry','secondaryIndustries','industryConfidence'],
  properties:{
    ...Object.fromEntries(CRM_INSIGHT_KEYS.map((key)=>[key,{type:'string'}])),
    primaryIndustry:{type:'string',enum:INDUSTRY_OPTIONS},
    secondaryIndustries:{type:'array',maxItems:2,items:{type:'string',enum:INDUSTRY_OPTIONS}},
    industryConfidence:{type:'number',minimum:0.6,maximum:1},
  },
};

const CONTACT_VERIFICATION_FIELDS = {
  displayName:'姓名',companyName:'公司',jobTitle:'職稱',department:'部門',mobile:'手機',companyPhone:'公司電話',email:'Email',websiteUrl:'網站',lineUrl:'LINE 連結',address:'地址',
};
const CONTACT_DATA_VERIFICATION_SCHEMA = {
  type:'object',additionalProperties:false,required:['passed','checks','summary'],properties:{
    passed:{type:'boolean'},
    checks:{type:'array',items:{type:'object',additionalProperties:false,required:['field','status','reason','evidence'],properties:{
      field:{type:'string',enum:Object.keys(CONTACT_VERIFICATION_FIELDS)},status:{type:'string',enum:['verified','invalid','unverifiable']},reason:{type:'string'},evidence:{type:'string'},
    }}},
    summary:{type:'string'},
  },
};

async function callAiResponses(provider, body) {
  if (!provider) throw new Error('名片 AI 辨識服務尚未連線');
  const internal = typeof provider !== 'string';
  const timeoutMs = body?.text?.format?.name === 'business_card' ? 70000 : 50000;
  let timer;
  try {
    const request = internal
      ? provider.fetch('https://mlm.internal/api/internal/ai/responses', {
        method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({request:body}),
      })
      : fetch('https://api.openai.com/v1/responses', {
        method:'POST', headers:{authorization:`Bearer ${provider}`,'content-type':'application/json'}, body:JSON.stringify(body),
      });
    const timeout = new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('AI 回應逾時，系統將自動重試')),timeoutMs);});
    const response = await Promise.race([request,timeout]);
    const result = await response.json().catch(()=>({}));
    if (!response.ok) throw new Error(result?.error?.message || result?.error || 'MLM AI 服務暫時無法使用');
    return result;
  } finally {
    if(timer)clearTimeout(timer);
  }
}

function outputText(result = {}) {
  return result.output_text || result.output?.flatMap((item)=>item.content || []).find((item)=>item.type === 'output_text')?.text || '';
}
export function parseStructuredAiOutput(value, friendlyMessage = 'AI 回傳格式不完整，系統將自動重試') {
  const raw = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first < 0 || last < first) {
    const error = new Error(friendlyMessage);
    error.code = 'ai_incomplete_json';
    throw error;
  }
  try {
    return JSON.parse(raw.slice(first, last + 1));
  } catch {
    const error = new Error(friendlyMessage);
    error.code = 'ai_invalid_json';
    throw error;
  }
}

async function callAiJsonWithRetry(provider, body, friendlyMessage) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const request = attempt ? { ...body, max_output_tokens:Math.max(Number(body.max_output_tokens) || 0, 1400) } : body;
    const result = await callAiResponses(provider, request);
    const outputText = result.output_text || result.output?.flatMap((item)=>item.content || []).find((item)=>item.type === 'output_text')?.text;
    try {
      return parseStructuredAiOutput(outputText, friendlyMessage);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function contactVerificationFacts(card = {}) {
  return Object.fromEntries(Object.keys(CONTACT_VERIFICATION_FIELDS).map((key)=>[key,text(card[key],FIELD_LIMITS[key] || 320)]).filter(([,value])=>value));
}
function contactFormatErrors(card = {}) {
  const errors=[];
  const phoneValid=(value)=>!value || /^\+?[0-9][0-9\s().-]{6,24}$/.test(value);
  if(!phoneValid(card.mobile))errors.push({field:'mobile',reason:'手機格式不完整'});
  if(!phoneValid(card.companyPhone))errors.push({field:'companyPhone',reason:'公司電話格式不完整'});
  if(card.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(card.email))errors.push({field:'email',reason:'Email 格式不正確'});
  for(const field of ['websiteUrl','lineUrl']){
    if(!card[field])continue;
    try{const url=new URL(card[field]);if(!['http:','https:'].includes(url.protocol) || !url.hostname)throw new Error('invalid')}catch{errors.push({field,reason:'必須是有效的 HTTP 或 HTTPS 網址'})}
  }
  if(card.address && card.address.replace(/\s/g,'').length<5)errors.push({field:'address',reason:'地址資訊過短，無法查核'});
  return errors;
}
function throwContactVerificationError(failures = [], fallback = '名片資料二次查核未通過') {
  const error=new Error(failures.length ? `二次查核未通過：${failures.slice(0,6).map((item)=>`${CONTACT_VERIFICATION_FIELDS[item.field] || item.field}：${text(item.reason,120)}`).join('；')}` : fallback);
  error.code='contact_verification_failed';error.verificationErrors=failures;throw error;
}
export async function verifyContactCardData(db,userId,id,payload,provider,model) {
  const row=await db.prepare(`SELECT cc.*,cie.ocr_json FROM contact_cards cc LEFT JOIN card_import_events cie ON cie.id=cc.source_event_id WHERE cc.id=? AND cc.scanner_user_id=? AND cc.status='active'`).bind(id,userId).first();
  if(!row)throw new Error('找不到收藏名片');
  const card=cleanCard({...rowToCard(row),...payload});
  const formatErrors=contactFormatErrors(card);if(formatErrors.length)throwContactVerificationError(formatErrors);
  if(!provider)return {passed:false,advisory:true,checks:[],summary:'AI 查核服務暫時無法使用；人工修正仍可儲存，系統稍後再補強。',verificationErrors:[],verifiedAt:new Date().toISOString()};
  const facts=contactVerificationFacts(card);let ocr={};try{ocr=JSON.parse(row.ocr_json || '{}')}catch{}
  const ocrEvidence=Object.fromEntries(Object.keys(CONTACT_VERIFICATION_FIELDS).map((key)=>[key,text(ocr[key],FIELD_LIMITS[key] || 320)]).filter(([,value])=>value));
  let result;
  try{
    result=await callAiJsonWithRetry(provider,{
      model:model || 'gpt-5.6-terra',reasoning:{effort:'low'},max_output_tokens:1600,tools:[{type:'web_search'}],
      input:[{role:'user',content:`你是商務名片資料查核助手。使用者準備儲存的人工修正資料是目前主資料，原始名片 OCR 只作為歷史參考，不得因兩者不同而判定人工修正錯誤。逐欄查核公開聯絡資料並搜尋公開網路資料。\n\n待查核資料：${JSON.stringify(facts)}\n原始名片 OCR 證據：${JSON.stringify(ocrEvidence)}\n\n規則：\n1. 每個待查核欄位都必須回傳一次 checks，不可遺漏或重複。\n2. status 只能是 verified、invalid、unverifiable。人工修正與 OCR 不同不構成 invalid；有可靠公開來源支持才可 verified，暫時找不到公開來源則為 unverifiable。\n3. 地址必須是可辨識的完整地址，且與公司、網站、原始名片或可靠公開來源一致；無法確認就 unverifiable。\n4. 電話、Email、網站、LINE 連結須同時檢查格式與其和姓名／公司的一致性。\n5. 不可猜測、補造或因看起來合理就通過。evidence 簡述 OCR 或公開來源依據；無證據時留空。\n6. 只要一欄 invalid、unverifiable、缺少查核或沒有證據，passed=false。只回傳 JSON。`}],
      text:{format:{type:'json_schema',name:'contact_data_verification',strict:true,schema:CONTACT_DATA_VERIFICATION_SCHEMA}},
    },'名片資料二次查核回傳不完整，資料未儲存');
  }catch(error){return {passed:false,advisory:true,checks:[],summary:'AI 查核暫時未完成；人工修正仍可儲存，系統稍後再補強。',verificationErrors:[],verifiedAt:new Date().toISOString()}}
  const checks=new Map((Array.isArray(result.checks)?result.checks:[]).map((item)=>[item.field,item]));
  const failures=Object.keys(facts).map((field)=>checks.get(field) || {field,status:'unverifiable',reason:'查核結果缺少此欄位',evidence:''}).filter((item)=>item.status!=='verified' || !text(item.evidence,300));
  if(!result.passed || failures.length)return {passed:false,advisory:true,checks:[...checks.values()],summary:text(result.summary || 'AI 查核尚有待確認項目；人工修正已作為主資料。',300),verificationErrors:failures,verifiedAt:new Date().toISOString()};
  return {passed:true,advisory:false,checks:[...checks.values()],summary:text(result.summary,300),verificationErrors:[],verifiedAt:new Date().toISOString()};
}

function businessCardImages(images) {
  return images.map((image)=>({type:'input_image',image_url:`data:${image.type};base64,${bytesToBase64(image.bytes)}`,detail:'high'}));
}
export function businessCardVerificationPrompt(firstPass = {}) {
  return `你是繁體中文商務名片查證員。這是第一次 OCR 結果：${JSON.stringify(firstPass)}

請重新逐字查看名片原圖，特別核對姓名與公司名稱中外形相近的中文字；再使用公開網路交叉查證。
查證順序：
1. 以姓名＋公司／事務所／職稱精確搜尋。
2. 分別以電話原字串、純數字電話、完整地址、Email 精確搜尋。
3. 公司與統編優先查經濟部商工登記公示資料（findbiz.nat.gov.tw、gcis.nat.gov.tw、data.gcis.nat.gov.tw）或其他政府資料。
4. 律師、醫師等專業人士另查主管機關、公會或政府名冊；Google Map、官網與社群只能當輔助來源。
5. 只有原圖可清楚辨識，或至少一個強識別資料（電話、Email、完整地址、統編）相符，或兩個獨立公開來源同時支持時，才可修正姓名或公司名稱。
6. 統編只能採用政府登記或官方網站可確認的資料；找不到就留空，不得猜測。
7. 所有名片欄位都要回傳；無法確認時保留第一次 OCR。verificationSources 記錄實際採用網址及相符欄位，verificationNotes 說明是否修正與理由。`;
}
async function recognizeWithOpenAI(apiKey, model, images) {
  const firstContent = [{ type:'input_text', text:`辨識這張商務名片。只擷取畫面中可確認的文字，不猜測；無法確認的欄位填空字串。若不是名片，isBusinessCard=false。繁體中文內容保留原文。note 僅放無法歸類但有價值的名片文字。
並依公司、職稱、部門與服務說明做一次行業分類：主行業只能選 1 個，次行業最多 2 個且不可與主行業相同。可選行業為：${INDUSTRY_OPTIONS.join('、')}。無法可靠判斷時 primaryIndustry 填「待分類」、secondaryIndustries 填空陣列；industryConfidence 填 0 到 1。` },...businessCardImages(images)];
  const firstResult = await callAiResponses(apiKey, { model:model || 'gpt-5.6-terra', reasoning:{effort:'low'}, max_output_tokens:1800, input:[{role:'user',content:firstContent}], text:{format:{type:'json_schema',name:'business_card',strict:true,schema:OCR_SCHEMA}} });
  const firstPassText=outputText(firstResult);
  if(!firstPassText)throw new Error('AI 未回傳第一次名片辨識結果');
  return JSON.parse(firstPassText);
}

// Keep web verification out of the initial OCR fast path.
async function recognizeVerifiedWithOpenAI(apiKey, model, images) {
  const firstPass=await recognizeWithOpenAI(apiKey,model,images);
  if(!firstPass.isBusinessCard)return {...firstPass,verificationVersion:OCR_VERIFICATION_VERSION,verificationConfidence:0,verificationNotes:'第一次辨識判定不是名片',verificationSources:[]};
  const verificationContent=[{type:'input_text',text:businessCardVerificationPrompt(firstPass)},...businessCardImages(images)];
  const verifiedResult=await callAiResponses(apiKey,{
    model:model || 'gpt-5.6-terra',reasoning:{effort:'medium'},tools:[{type:'web_search'}],max_output_tokens:2600,
    input:[{role:'user',content:verificationContent}],
    text:{format:{type:'json_schema',name:'verified_business_card',strict:true,schema:OCR_VERIFICATION_SCHEMA}},
  });
  const verifiedText=outputText(verifiedResult);
  if(!verifiedText)throw new Error('AI 未回傳名片二次查證結果');
  return JSON.parse(verifiedText);
}

// 使用 Responses 的 web_search 工具，只把 OCR／人工校正過的公開欄位送去查找。
// 回傳候選文案而非直接寫入，最後仍由使用者選取後才保存至數位名片。
export async function expandContactContent(db, userId, id, apiKey, model) {
  if (!apiKey) throw new Error('MLM AI 服務尚未連線');
  const row = await db.prepare("SELECT * FROM contact_cards WHERE id=? AND scanner_user_id=? AND status='active'").bind(id, userId).first();
  if (!row) throw new Error('找不到收藏名片');
  const card = rowToCard(row);
  const facts = {
    name: card.displayName,
    company: card.companyName,
    title: card.jobTitle,
    department: card.department,
    website: card.websiteUrl,
    line: card.lineUrl,
    address: card.address,
    existingDescription: card.serviceDescription,
  };
  const result = await callAiResponses(apiKey, {
      model:model || 'gpt-5.6-terra',
      reasoning:{ effort:'low' },
      tools:[{ type:'web_search' }],
      input:[{ role:'user', content:`你是繁體中文商務名片文案助手。請根據下列名片已確認欄位搜尋公開網路資料，再產出 3 至 5 條可放在數位名片「內容區」的候選文字。\n\n已確認資料：${JSON.stringify(facts)}\n\n規則：\n1. 每條 35 到 90 個繁體中文字，語氣專業、客觀、可直接顯示。\n2. 只能描述可由名片資料或搜尋結果合理支持的服務、定位或特色；不確定時保持保守，不捏造獎項、年資、價格、合作或保證。\n3. 不要寫電話、地址、網址、LINE ID、emoji、標題或條列符號。\n4. 不得包含醫療、投資、法律等結果保證。\n5. 只回傳 JSON。` }],
      text:{ format:{ type:'json_schema', name:'business_card_content_suggestions', strict:true, schema:CONTENT_EXPANSION_SCHEMA } },
  });
  const outputText = result.output_text || result.output?.flatMap((item)=>item.content || []).find((item)=>item.type === 'output_text')?.text;
  if (!outputText) throw new Error('AI 未回傳內容建議');
  const parsed = JSON.parse(outputText);
  const items = Array.isArray(parsed.items) ? parsed.items.map((item)=>text(item, 200)).filter(Boolean).slice(0,5) : [];
  if (items.length < 3) throw new Error('AI 未產生足夠的內容建議');
  return { items };
}


async function generateCrmInsights(apiKey, model, card) {
  const crmProfile=normaliseCrmProfile(card.crmProfile || {});
  const facts = {
    name:card.displayName,
    mobile:text(card.mobile || card.companyPhone,40).replace(/[^0-9+]/g,''),
    birthday:crmProfile.birthday,
    gender:crmProfile.gender,
    company:card.companyName,
    title:card.jobTitle,
    department:card.department,
    serviceDescription:card.serviceDescription,
    formhd:{family:crmProfile.family,occupation:crmProfile.occupation,recreation:crmProfile.recreation,money:crmProfile.money,health:crmProfile.health,dream:crmProfile.dream},
  };
  const result = await callAiResponses(apiKey, {
      model:model || 'gpt-5.6-terra', reasoning:{effort:'low'}, max_output_tokens:900,
      input:[{ role:'user', content:`你是一位專業的商務 AI 心理與命理分析專家。請完全依照 LINE- 專案五大標籤規則分析這張掃描名片。\n\n姓名：${facts.name || '未知'}\n手機：${facts.mobile || '未知'}\n生日：${facts.birthday || '未知'}\n性別：${facts.gender || '未知'}\nFORMHD 暖身線索：${JSON.stringify(facts.formhd)}\n公司：${facts.company || '未知'}\n職稱：${facts.title || '未知'}\n部門：${facts.department || '未知'}\n服務說明：${facts.serviceDescription || '未知'}\n\n分析規則：\n1. 姓名字形判斷行動／思考型，發音判斷外向／內斂，結構判斷主導／依附。\n2. 手機數字頻率依 1領導、2協調、3表達、4穩定、5自由、6責任、7分析、8成就、9理想分析；尾數判斷快攻／慢養，奇偶比判斷衝動／保守。\n3. 有生日時融合八字、紫微斗數、生命靈數與東西方星座；未提供生日就以現有欄位分析，不虛構命盤。\n4. 五項必須融合 VAK 感官偏好、分析／數據／直覺決策模式，以及積極／保守與風險偏好。\n5. personality、interests、wealth、health、career 每項以 20 至 40 個繁體中文字，同時描述具體特徵與商務應對建議。\n6. wealth 不宣稱實際收入或資產；health 不診斷疾病；不得捏造個資或經歷。\n7. 同時依公司、職稱、部門與服務說明完成業種分類。primaryIndustry 必須從以下選項選最接近的一項，不可回傳待分類：${INDUSTRY_OPTIONS.join('、')}。secondaryIndustries 最多兩項且不得與主業種重複；資料不足時主業種選「其他行業」。只回傳 JSON。` }],
      text:{format:{type:'json_schema',name:'crm_five_insights',strict:true,schema:CRM_INSIGHTS_SCHEMA}},
  });
  const outputText=result.output_text || result.output?.flatMap((item)=>item.content || []).find((item)=>item.type==='output_text')?.text;
  if(!outputText)throw new Error('AI 未回傳五大標籤');
  const parsed=JSON.parse(outputText);
  return {
    cards:Object.fromEntries(CRM_INSIGHT_KEYS.map((key)=>[key,text(parsed[key],220)])),
    industry:normaliseIndustryClassification({
      primary:parsed.primaryIndustry,
      secondary:parsed.secondaryIndustries,
      confidence:parsed.industryConfidence,
      source:'ai',
      classifiedAt:new Date().toISOString(),
    }),
  };
}
function withInsightMeta(row, patch) {
  const source=rawVersions(row);
  source._crmInsights={...insightMeta(row),...patch,updatedAt:new Date().toISOString()};
  return JSON.stringify(source);
}
export async function submitImportInBackground(db, bucket, userId, eventId, apiKey, model) {
  if(!apiKey)throw new Error('MLM AI 服務尚未連線');
  const event=await db.prepare('SELECT * FROM card_import_events WHERE id=? AND scanner_user_id=?').bind(eventId,userId).first();
  if(!event)throw new Error('找不到這次名片掃描');
  if(event.contact_card_id) {
    const card=await db.prepare('SELECT * FROM contact_cards WHERE id=? AND scanner_user_id=?').bind(event.contact_card_id,userId).first();
    return {card:rowToCard(card),existing:true};
  }
  const id=newId('contact');
  const placeholderVersions=JSON.stringify({_crmInsights:{status:'queued',cards:{},updatedAt:new Date().toISOString(),error:''}});
  await db.prepare(`INSERT INTO contact_cards (id,scanner_user_id,source_event_id,display_name,front_r2_key,front_content_type,versions_json)
    VALUES (?,?,?,?,?,?,?)`).bind(id,userId,eventId,'名片 AI 分析中',event.front_r2_key,event.front_content_type,placeholderVersions).run();
  await db.prepare("UPDATE card_import_events SET status='received', contact_card_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(id,eventId).run();
  const card=await db.prepare('SELECT * FROM contact_cards WHERE id=?').bind(id).first();
  return {card:rowToCard(card),existing:false};
}
export async function processImportInBackground(db, bucket, userId, eventId, apiKey, model) {
  const event=await db.prepare('SELECT * FROM card_import_events WHERE id=? AND scanner_user_id=?').bind(eventId,userId).first();
  if(!event?.contact_card_id)return;
  const contact=await db.prepare('SELECT * FROM contact_cards WHERE id=? AND scanner_user_id=?').bind(event.contact_card_id,userId).first();
  if(!contact)return;
  await db.batch([
    db.prepare("UPDATE card_import_events SET status='processing', updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(eventId),
    db.prepare("UPDATE contact_cards SET versions_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(withInsightMeta(contact,{status:'processing',error:''}),contact.id),
  ]);
  try {
    const images=[];
    for(const key of [event.front_r2_key,event.back_r2_key].filter(Boolean)) { const object=await bucket.get(key); if(object)images.push({type:object.httpMetadata?.contentType || event.front_content_type || 'image/webp',bytes:await object.arrayBuffer()}); }
    const result=await recognizeWithOpenAI(apiKey,model,images);
    if(!result.isBusinessCard)throw new Error('這張圖片看起來不是名片，請重新拍攝');
    const card=cleanCard(result);
    const duplicate=await findDuplicate(db,userId,card,contact.id);
    if(duplicate){
      await Promise.all([event.front_r2_key,event.back_r2_key].filter(Boolean).map((key)=>bucket.delete(key)));
      await db.batch([
        db.prepare("UPDATE contact_cards SET status='archived',front_r2_key='',updated_at=CURRENT_TIMESTAMP WHERE id=? AND scanner_user_id=?").bind(contact.id,userId),
        db.prepare("UPDATE card_import_events SET status='updated',contact_card_id=?,front_r2_key='',back_r2_key='',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(duplicate.id,eventId),
      ]);
      await updateCardImportFingerprint(db,eventId,'duplicate');
      return {created:false,duplicate:true,card:rowToCard(duplicate)};
    }
    const values=[card.displayName,card.englishName,card.companyName,card.jobTitle,card.department,card.mobile,card.companyPhone,card.email,card.websiteUrl,card.lineUrl,card.address,card.serviceDescription,card.note,card.normalizedMobile,card.normalizedEmail,card.normalizedNameCompany];
    await db.batch([
      db.prepare('UPDATE contact_cards SET display_name=?,english_name=?,company_name=?,job_title=?,department=?,mobile=?,company_phone=?,email=?,website_url=?,line_url=?,address=?,service_description=?,note=?,normalized_mobile=?,normalized_email=?,normalized_name_company=?,versions_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND scanner_user_id=?').bind(...values,withIndustryMeta({...contact,versions_json:withInsightMeta(contact,{status:'queued',cards:{},error:''})},industryFromOcr(result)),contact.id,userId),
      db.prepare("UPDATE card_import_events SET status='created',ocr_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(JSON.stringify(result),eventId),
    ]);
  } catch(error) {
    await db.batch([
      db.prepare("UPDATE card_import_events SET status='failed',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(eventId),
      db.prepare("UPDATE contact_cards SET display_name=?,versions_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind('名片辨識未完成',withInsightMeta(contact,{status:'failed',error:error.message || 'OCR 辨識失敗'}),contact.id),
    ]);
    await updateCardImportFingerprint(db,eventId,'failed');
    console.error('Background card OCR failed',error);
    return {created:false,failed:true};
  }
  // 第一階段到此完成：OCR 寫入、收藏成立並回傳。五大標籤由呼叫端
  // 另行排入背景工作，不得阻擋收藏、防重判定或名片贈點。
  await updateCardImportFingerprint(db,eventId,'completed');
  const saved=await db.prepare('SELECT * FROM contact_cards WHERE id=? AND scanner_user_id=?').bind(contact.id,userId).first();
  return {created:true,duplicate:false,card:rowToCard(saved)};
}
const CARD_DB_FIELDS={displayName:'display_name',englishName:'english_name',companyName:'company_name',jobTitle:'job_title',department:'department',mobile:'mobile',companyPhone:'company_phone',email:'email',websiteUrl:'website_url',lineUrl:'line_url',address:'address',serviceDescription:'service_description',note:'note'};
export function mergeVerifiedCard(row, original = {}, verified = {}) {
  const merged={};
  for(const [key,limit] of Object.entries(FIELD_LIMITS)){
    const current=text(row[CARD_DB_FIELDS[key]],limit);
    const first=text(original[key],limit);
    const checked=text(verified[key],limit);
    merged[key]=(!current || current===first) ? (checked || current) : current;
  }
  return cleanCard(merged);
}
export async function reverifyContactFromSource(db,bucket,userId,id,apiKey,model) {
  if(!apiKey)throw new Error('MLM AI 服務尚未連線');
  const row=await db.prepare(`SELECT cc.*,cie.front_r2_key import_front_key,cie.back_r2_key import_back_key,cie.front_content_type import_content_type,cie.ocr_json import_ocr_json
    FROM contact_cards cc JOIN card_import_events cie ON cie.id=cc.source_event_id
    WHERE cc.id=? AND cc.scanner_user_id=? AND cc.status='active' AND cie.front_r2_key!=''`).bind(id,userId).first();
  if(!row)throw new Error('這張名片沒有可供重新辨識的原始圖片');
  await db.prepare("UPDATE card_import_events SET ocr_json=json_set(CASE WHEN json_valid(ocr_json) THEN ocr_json ELSE '{}' END,'$._verificationStatus','processing'),updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(row.source_event_id).run();
  try{
    const images=[];
    for(const key of [row.import_front_key,row.import_back_key].filter(Boolean)){
      const object=await bucket.get(key);
      if(object)images.push({type:object.httpMetadata?.contentType || row.import_content_type || 'image/webp',bytes:await object.arrayBuffer()});
    }
    if(!images.length)throw new Error('找不到原始名片圖片');
    let original={};try{original=JSON.parse(row.import_ocr_json || '{}');}catch{}
    const verified=await recognizeVerifiedWithOpenAI(apiKey,model,images);
    if(!verified.isBusinessCard)throw new Error('二次查證無法確認這是商務名片');
    const card=mergeVerifiedCard(row,original,verified);
    const values=[card.displayName,card.englishName,card.companyName,card.jobTitle,card.department,card.mobile,card.companyPhone,card.email,card.websiteUrl,card.lineUrl,card.address,card.serviceDescription,card.note,card.normalizedMobile,card.normalizedEmail,card.normalizedNameCompany];
    const versions=rawVersions(row);
    versions._crmInsights={...insightMeta(row),status:'queued',cards:{},error:'',updatedAt:new Date().toISOString()};
    versions._aiCrm={...(versions._aiCrm || {}),status:'queued',analysisVersion:'',error:'',updatedAt:new Date().toISOString()};
    await db.batch([
      db.prepare('UPDATE contact_cards SET display_name=?,english_name=?,company_name=?,job_title=?,department=?,mobile=?,company_phone=?,email=?,website_url=?,line_url=?,address=?,service_description=?,note=?,normalized_mobile=?,normalized_email=?,normalized_name_company=?,versions_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND scanner_user_id=?').bind(...values,JSON.stringify(versions),id,userId),
      db.prepare("UPDATE card_import_events SET status='created',ocr_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(JSON.stringify(verified),row.source_event_id),
    ]);
    return rowToCard(await db.prepare('SELECT * FROM contact_cards WHERE id=? AND scanner_user_id=?').bind(id,userId).first());
  }catch(error){
    await db.prepare("UPDATE card_import_events SET status='created',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(row.source_event_id).run();
    throw error;
  }
}
export async function queueContactCardReverification(db,userId,id) {
  const row=await db.prepare(`SELECT cc.id FROM contact_cards cc JOIN card_import_events cie ON cie.id=cc.source_event_id
    WHERE cc.id=? AND cc.scanner_user_id=? AND cc.status='active' AND cie.front_r2_key!=''`).bind(id,userId).first();
  if(!row)return false;
  await db.prepare("UPDATE card_import_events SET ocr_json=json_set(CASE WHEN json_valid(ocr_json) THEN ocr_json ELSE '{}' END,'$._verificationStatus','queued'),updated_at=CURRENT_TIMESTAMP WHERE contact_card_id=?").bind(id).run();
  return true;
}
export async function queueMemberCardVerificationBackfill(db,userId,limit=1) {
  const capped=Math.max(1,Math.min(Number(limit)||1,3));
  const result=await db.prepare(`SELECT cc.id,cc.scanner_user_id
    FROM contact_cards cc JOIN card_import_events cie ON cie.id=cc.source_event_id
    WHERE cc.scanner_user_id=? AND cc.status='active' AND cie.front_r2_key!=''
      AND COALESCE(json_extract(cie.ocr_json,'$.verificationVersion'),'')!=?
      AND COALESCE(json_extract(CASE WHEN json_valid(cie.ocr_json) THEN cie.ocr_json ELSE '{}' END,'$._verificationStatus'),'') NOT IN ('queued','processing')
    ORDER BY cie.updated_at ASC LIMIT ?`).bind(userId,OCR_VERIFICATION_VERSION,capped).all();
  const rows=result.results || [];
  if(rows.length)await db.batch(rows.map((row)=>db.prepare("UPDATE card_import_events SET ocr_json=json_set(CASE WHEN json_valid(ocr_json) THEN ocr_json ELSE '{}' END,'$._verificationStatus','queued'),updated_at=CURRENT_TIMESTAMP WHERE contact_card_id=?").bind(row.id)));
  return rows.map((row)=>({id:row.id,userId:row.scanner_user_id}));
}
export async function queueLegacyFailedImportRetries(db, limit = 3) {
  const cappedLimit=Math.max(1,Math.min(Number(limit) || 3,10));
  const result=await db.prepare(`SELECT cie.id event_id,cie.scanner_user_id
    FROM card_import_events cie
    JOIN contact_cards cc ON cc.id=cie.contact_card_id
    WHERE cie.status='failed' AND cie.front_r2_key!='' AND cc.status='active'
      AND (
        cc.display_name IN ('名片分析未完成','名片辨識未完成')
        OR COALESCE(json_extract(cc.versions_json, '$._crmInsights.error'),'') LIKE '%API 金鑰%'
      )
    ORDER BY cie.updated_at ASC LIMIT ?`).bind(cappedLimit).all();
  return (result.results || []).map((row)=>({eventId:row.event_id,userId:row.scanner_user_id}));
}


export async function queueContactCrmInsights(db, userId, id, force = false) {
  const row=await db.prepare(`SELECT cc.* FROM contact_cards cc LEFT JOIN card_import_events cie ON cie.id=cc.source_event_id WHERE cc.id=? AND cc.scanner_user_id=? AND cc.status='active' AND cc.display_name NOT IN ('名片 AI 分析中','名片辨識未完成','名片分析未完成') AND (COALESCE(cc.source_event_id,'')='' OR cie.status IN ('created','updated'))`).bind(id,userId).first();
  if(!row || (!force && ['queued','processing'].includes(insightMeta(row).status)))return false;
  await db.prepare("UPDATE contact_cards SET versions_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND scanner_user_id=? AND status='active'").bind(withInsightMeta(row,{status:'queued',cards:{},error:''}),id,userId).run();
  return true;
}
export async function processContactInsightsInBackground(db, userId, id, apiKey, model) {
  const row=await db.prepare(`SELECT cc.* FROM contact_cards cc LEFT JOIN card_import_events cie ON cie.id=cc.source_event_id WHERE cc.id=? AND cc.scanner_user_id=? AND cc.status='active' AND cc.display_name NOT IN ('名片 AI 分析中','名片辨識未完成','名片分析未完成') AND (COALESCE(cc.source_event_id,'')='' OR cie.status IN ('created','updated'))`).bind(id,userId).first();
  if(!row)return;
  await db.prepare("UPDATE contact_cards SET versions_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(withInsightMeta(row,{status:'processing',error:''}),id).run();
  try {
    const card=rowToCard(row);
    const analysis=await generateCrmInsights(apiKey,model,card);
    const versionsJson=withIndustryMeta(
      {...row,versions_json:withInsightMeta(row,{status:'ready',cards:analysis.cards,error:'',analysisVersion:CRM_INSIGHT_ANALYSIS_VERSION})},
      analysis.industry,
    );
    await db.prepare("UPDATE contact_cards SET versions_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(versionsJson,id).run();
  } catch(error) {
    await db.prepare("UPDATE contact_cards SET versions_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(withInsightMeta(row,{status:'failed',error:error.message || '分析失敗'}),id).run();
    console.error('Background CRM insight analysis failed',error);
  }
}


export async function queueMemberStaleCardAnalysis(db, userId, staleMinutes = 3) {
  const minutes=Math.max(2,Math.min(Number(staleMinutes)||3,30));
  const threshold=`-${minutes} minutes`;
  const imports=await db.prepare(`SELECT cie.id event_id,cie.scanner_user_id
    FROM card_import_events cie
    JOIN contact_cards cc ON cc.id=cie.contact_card_id
    WHERE cie.scanner_user_id=? AND cie.status IN ('received','processing')
      AND cie.updated_at <= datetime('now',?) AND cc.status='active'
    ORDER BY cie.updated_at ASC LIMIT 2`).bind(userId,threshold).all();
  const importTasks=imports.results || [];
  if(importTasks.length)await db.batch(importTasks.map((task)=>db.prepare(
    "UPDATE card_import_events SET status='received',updated_at=CURRENT_TIMESTAMP WHERE id=? AND scanner_user_id=?"
  ).bind(task.event_id,userId)));
  const insights=await db.prepare(`SELECT cc.id,cc.scanner_user_id,cc.source_event_id event_id
    FROM contact_cards cc
    LEFT JOIN card_import_events cie ON cie.id=cc.source_event_id
    WHERE cc.scanner_user_id=? AND cc.status='active'
      AND COALESCE(json_extract(cc.versions_json,'$._crmInsights.status'),'') IN ('queued','processing')
      AND cc.updated_at <= datetime('now',?)
      AND (cie.id IS NULL OR cie.status NOT IN ('received','processing'))
    ORDER BY cc.updated_at ASC LIMIT 3`).bind(userId,threshold).all();
  const insightTasks=insights.results || [];
  if(insightTasks.length){
    const statements=insightTasks.map((task)=>db.prepare(
      "UPDATE contact_cards SET versions_json=json_set(COALESCE(NULLIF(versions_json,''),'{}'),'$._crmInsights.status','queued','$._crmInsights.error',''),updated_at=CURRENT_TIMESTAMP WHERE id=? AND scanner_user_id=?"
    ).bind(task.id,userId));
    for(const task of insightTasks){
      if(task.event_id)statements.push(db.prepare(
        "UPDATE card_import_fingerprints SET status='completed',updated_at=CURRENT_TIMESTAMP WHERE event_id=?"
      ).bind(task.event_id));
    }
    await db.batch(statements);
  }
  return {
    imports:importTasks.map((task)=>({eventId:task.event_id,userId:task.scanner_user_id})),
    insights:insightTasks.map((task)=>({id:task.id,userId:task.scanner_user_id,eventId:task.event_id || ''})),
  };
}

export async function queueSystemCrmInsightBackfill(db, limit = 6) {
  const cappedLimit=Math.max(1,Math.min(Number(limit) || 6,20));
  const result=await db.prepare(`SELECT cc.* FROM contact_cards cc LEFT JOIN card_import_events cie ON cie.id=cc.source_event_id
    WHERE cc.status='active' AND cc.display_name NOT IN ('名片 AI 分析中','名片辨識未完成','名片分析未完成')
      AND (COALESCE(cc.source_event_id,'')='' OR cie.status IN ('created','updated')) AND (
      COALESCE(json_extract(versions_json, '$._crmInsights.status'),'') NOT IN ('ready','queued','processing')
      OR (json_extract(versions_json, '$._crmInsights.status')='ready' AND COALESCE(json_extract(versions_json, '$._crmInsights.analysisVersion'),'')!=?)
      OR (json_extract(versions_json, '$._crmInsights.status')='queued' AND updated_at <= datetime('now','-5 minutes'))
      OR (json_extract(versions_json, '$._crmInsights.status')='processing' AND updated_at <= datetime('now','-5 minutes'))
      OR COALESCE(json_extract(versions_json, '$._industry.primary'),'待分類')='待分類'
    ) ORDER BY updated_at ASC LIMIT ?`).bind(CRM_INSIGHT_ANALYSIS_VERSION,cappedLimit).all();
  const candidates=result.results || [];
  if(!candidates.length)return {queued:0,tasks:[]};
  await db.batch(candidates.map((row)=>db.prepare("UPDATE contact_cards SET versions_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND scanner_user_id=?").bind(withInsightMeta(row,{status:'queued',error:''}),row.id,row.scanner_user_id)));
  return {queued:candidates.length,tasks:candidates.map((row)=>({id:row.id,userId:row.scanner_user_id}))};
}

async function ensureCardImportFingerprintTable(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS card_import_fingerprints (
      user_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      event_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, fingerprint)
    )
  `).run();
}
async function cardImportFingerprint(buffers, namespace='') {
  const parts=namespace ? [new TextEncoder().encode(namespace).buffer,...buffers] : buffers;
  const total=parts.reduce((sum,buffer)=>sum+4+buffer.byteLength,0);
  const joined=new Uint8Array(total);
  const view=new DataView(joined.buffer);
  let offset=0;
  for(const buffer of parts){
    view.setUint32(offset,buffer.byteLength);offset+=4;
    joined.set(new Uint8Array(buffer),offset);offset+=buffer.byteLength;
  }
  const digest=await crypto.subtle.digest('SHA-256',joined);
  return Array.from(new Uint8Array(digest),(byte)=>byte.toString(16).padStart(2,'0')).join('');
}
async function updateCardImportFingerprint(db,eventId,status) {
  await ensureCardImportFingerprintTable(db);
  await db.prepare('UPDATE card_import_fingerprints SET status=?,updated_at=CURRENT_TIMESTAMP WHERE event_id=?').bind(status,eventId).run();
}

export async function createImport(db, bucket, userId, form, options = {}) {
  const files = ['front','back'].map((key)=>form.get(key)).filter((file)=>file instanceof File && file.size);
  if (!files.length || files.length > 2) throw new Error('請選擇名片正面，最多可加一張背面');
  for (const file of files) {
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) throw new Error('名片圖片僅支援 JPEG、PNG 或 WebP');
    if (file.size > MAX_IMAGE_BYTES) throw new Error('單張圖片須小於 2MB');
  }
  const count = await db.prepare("SELECT COUNT(*) count FROM card_import_events WHERE scanner_user_id = ? AND created_at >= datetime('now','-1 day')").bind(userId).first();
  if (Number(count?.count || 0) >= 20) throw new Error('今日名片辨識已達 20 次，請明日再試');
  const buffers=await Promise.all(files.map((file)=>file.arrayBuffer()));
  const purpose=options.purpose === 'personal' ? 'personal' : 'collection';
  const fingerprint=await cardImportFingerprint(buffers,purpose === 'personal' ? 'personal-card' : '');
  await ensureCardImportFingerprintTable(db);
  const previous=await db.prepare('SELECT status,created_at FROM card_import_fingerprints WHERE user_id=? AND fingerprint=? LIMIT 1').bind(userId,fingerprint).first();
  if(previous && previous.status!=='failed' && (previous.status!=='pending' || Date.parse(previous.created_at)>Date.now()-2*60*60*1000)){
    const error=new Error('這張名片圖片已上傳過，不能重複收藏或領點');error.code='duplicate_upload';throw error;
  }
  if(previous)await db.prepare('DELETE FROM card_import_fingerprints WHERE user_id=? AND fingerprint=?').bind(userId,fingerprint).run();
  const id = newId('card_import');
  const keys = files.map((_, index)=>`${purpose === 'personal' ? 'personal-card-imports' : 'card-collections'}/${userId}/${id}/${index ? 'back' : 'front'}.webp`);
  await db.prepare("INSERT INTO card_import_fingerprints (user_id,fingerprint,event_id,status) VALUES (?,?,?,'pending')").bind(userId,fingerprint,id).run();
  try {
    await Promise.all(files.map((file,index)=>bucket.put(keys[index],buffers[index],{httpMetadata:{contentType:file.type}})));
    await db.prepare('INSERT INTO card_import_events (id, scanner_user_id, front_r2_key, back_r2_key, front_content_type) VALUES (?, ?, ?, ?, ?)').bind(id,userId,keys[0],keys[1] || '',files[0].type).run();
    return { id, imageCount:files.length };
  } catch(error) {
    await Promise.all(keys.map((key)=>bucket.delete(key).catch(()=>null)));
    await db.prepare('DELETE FROM card_import_fingerprints WHERE user_id=? AND fingerprint=?').bind(userId,fingerprint).run().catch(()=>null);
    throw error;
  }
}

export async function recognizeImport(db, bucket, userId, eventId, apiKey, model) {
  if (!apiKey) throw new Error('MLM AI 服務尚未連線');
  const event = await db.prepare('SELECT * FROM card_import_events WHERE id = ? AND scanner_user_id = ?').bind(eventId,userId).first();
  if (!event) throw new Error('找不到這次名片掃描');
  await db.prepare("UPDATE card_import_events SET status='processing', updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(eventId).run();
  try {
    const images = [];
    for (const key of [event.front_r2_key,event.back_r2_key].filter(Boolean)) { const object=await bucket.get(key); if(object) images.push({type:object.httpMetadata?.contentType || event.front_content_type || 'image/webp',bytes:await object.arrayBuffer()}); }
    const result = await recognizeWithOpenAI(apiKey, model, images);
    const status = result.isBusinessCard ? 'review_ready' : 'rejected';
    await db.prepare('UPDATE card_import_events SET status=?, ocr_json=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(status,JSON.stringify(result),eventId).run();
    if (!result.isBusinessCard) throw new Error('這張圖片看起來不是名片，請重新拍攝');
    return { eventId, card:cleanCard(result), confidence:Number(result.confidence || 0), language:text(result.language,40) };
  } catch (error) {
    await db.prepare("UPDATE card_import_events SET status=CASE WHEN status='rejected' THEN status ELSE 'failed' END, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(eventId).run();
    // 辨識失敗不保留無用途的原始照片；使用者重新拍攝即可，避免 R2 累積孤兒檔案。
    await Promise.all([event.front_r2_key,event.back_r2_key].filter(Boolean).map((key)=>bucket.delete(key)));
    await db.prepare("UPDATE card_import_events SET front_r2_key='', back_r2_key='' WHERE id=?").bind(eventId).run();
    await updateCardImportFingerprint(db,eventId,'failed');
    throw error;
  }
}

export async function confirmImport(db, bucket, userId, eventId, payload = {}) {
  const event = await db.prepare('SELECT * FROM card_import_events WHERE id = ? AND scanner_user_id = ?').bind(eventId,userId).first();
  if (!event || event.status !== 'review_ready') throw new Error('名片辨識結果已失效，請重新掃描');
  const card = cleanCard(payload.card || payload);
  const self = await db.prepare('SELECT pc.id FROM platform_users pu LEFT JOIN member_profiles mp ON mp.platform_user_id=pu.id LEFT JOIN personal_cards pc ON pc.platform_user_id=pu.id WHERE pu.id=? AND ((? != \'\' AND (REPLACE(COALESCE(mp.phone,\'\'),\' \',\'\')=? OR REPLACE(COALESCE(pc.mobile,\'\'),\' \',\'\')=?)) OR (? != \'\' AND LOWER(COALESCE(pc.email,\'\'))=?)) LIMIT 1').bind(userId,card.normalizedMobile,card.normalizedMobile,card.normalizedMobile,card.normalizedEmail,card.normalizedEmail).first();
  if (self?.id) {
    await Promise.all([event.front_r2_key,event.back_r2_key].filter(Boolean).map((key)=>bucket.delete(key)));
    await db.prepare("UPDATE card_import_events SET status='rejected',front_r2_key='',back_r2_key='',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(eventId).run();
    await updateCardImportFingerprint(db,eventId,'rejected');
    const error=new Error('這是你自己的名片，請回「我的名片」編輯'); error.code='self_card'; throw error;
  }
  const duplicate = await findDuplicate(db,userId,card);
  if (duplicate && payload.duplicateAction !== 'update') { const error=new Error('收藏名單已有相同名片'); error.code='duplicate_contact'; error.duplicate=rowToCard(duplicate); throw error; }
  const id = duplicate?.id || newId('contact');
  const sourceKey = event.front_r2_key;
  const values=[card.displayName,card.englishName,card.companyName,card.jobTitle,card.department,card.mobile,card.companyPhone,card.email,card.websiteUrl,card.lineUrl,card.address,card.serviceDescription,card.note,card.normalizedMobile,card.normalizedEmail,card.normalizedNameCompany];
  let ocrResult={};
  try { ocrResult=JSON.parse(event.ocr_json || '{}'); } catch {}
  const queuedVersions=withIndustryMeta(
    {...(duplicate || {}),versions_json:withInsightMeta(duplicate || {},{status:'queued',cards:{},error:''})},
    industryFromOcr(ocrResult),
  );
  if (duplicate) await db.prepare('UPDATE contact_cards SET display_name=?,english_name=?,company_name=?,job_title=?,department=?,mobile=?,company_phone=?,email=?,website_url=?,line_url=?,address=?,service_description=?,note=?,normalized_mobile=?,normalized_email=?,normalized_name_company=?,versions_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND scanner_user_id=?').bind(...values,queuedVersions,id,userId).run();
  else await db.prepare('INSERT INTO contact_cards (id,scanner_user_id,source_event_id,display_name,english_name,company_name,job_title,department,mobile,company_phone,email,website_url,line_url,address,service_description,note,normalized_mobile,normalized_email,normalized_name_company,front_r2_key,front_content_type,versions_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,userId,eventId,...values,sourceKey,event.front_content_type,queuedVersions).run();
  if (event.back_r2_key) await bucket.delete(event.back_r2_key);
  if (duplicate && sourceKey) await bucket.delete(sourceKey);
  await db.prepare('UPDATE card_import_events SET status=?, contact_card_id=?, back_r2_key=\'\', updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(duplicate?'updated':'created',id,eventId).run();
  await updateCardImportFingerprint(db,eventId,duplicate?'duplicate':'completed');
  return { card:rowToCard(await db.prepare('SELECT * FROM contact_cards WHERE id=?').bind(id).first()), updated:Boolean(duplicate) };
}

export async function listContacts(db,userId,search='',industry='') {
  const q=`%${text(search,100).replace(/[\\%_]/g,'\\$&')}%`;
  const selectedIndustry=industry === INDUSTRY_PENDING || INDUSTRY_SET.has(industry) ? industry : '';
  const clauses=["scanner_user_id=?","status='active'"];
  const bindings=[userId];
  if(search){
    clauses.push("(display_name LIKE ? ESCAPE '\\' OR company_name LIKE ? ESCAPE '\\' OR mobile LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\')");
    bindings.push(q,q,q,q);
  }
  if(selectedIndustry === INDUSTRY_PENDING){
    clauses.push("COALESCE(json_extract(versions_json,'$._industry.primary'),'待分類')='待分類'");
  } else if(selectedIndustry){
    clauses.push("(json_extract(versions_json,'$._industry.primary')=? OR EXISTS (SELECT 1 FROM json_each(COALESCE(json_extract(versions_json,'$._industry.secondary'),'[]')) WHERE value=?))");
    bindings.push(selectedIndustry,selectedIndustry);
  }
  const result=await db.prepare(`SELECT * FROM contact_cards WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC LIMIT 100`).bind(...bindings).all();
  return (result.results || []).map(rowToCard);
}

export async function updateContact(db,userId,id,payload) {
  const existing=await db.prepare("SELECT * FROM contact_cards WHERE id=? AND scanner_user_id=? AND status='active'").bind(id,userId).first(); if(!existing) throw new Error('找不到收藏名片');
  const card=cleanCard({...rowToCard(existing),...payload}); const duplicate=await findDuplicate(db,userId,card,id); if(duplicate) throw new Error('收藏名單已有相同名片');
  const selectedVersion = CARD_VERSIONS.includes(payload.selectedVersion) ? payload.selectedVersion : (existing.selected_version || 'standard');
  const versions = normaliseVersions(payload.versions, existing);
  const existingCard=rowToCard(existing);
  const existingCrmProfile=crmProfileMeta(existing);
  const crmProfile=normaliseCrmProfile(payload.crmProfile ?? existingCrmProfile);
  versions._crmProfile=crmProfile;
  const insightInputChanged=CRM_INSIGHT_SOURCE_KEYS.some((key)=>text(existingCard[key],FIELD_LIMITS[key] || 1000) !== text(card[key],FIELD_LIMITS[key] || 1000))
    || JSON.stringify(existingCrmProfile)!==JSON.stringify(crmProfile);
  if(insightInputChanged){
    versions._crmInsights={status:'queued',cards:{},updatedAt:new Date().toISOString(),error:''};
    versions._aiCrm={...(versions._aiCrm || {}),status:'queued',analysisVersion:'',updatedAt:new Date().toISOString(),error:''};
    if(versions._memberMatch)versions._memberMatch={...versions._memberMatch,status:'pending',rank:0,updatedAt:new Date().toISOString()};
  }
  if(payload.industry && typeof payload.industry === 'object'){
    versions._industry=normaliseIndustryClassification({
      primary:payload.industry.primary,
      secondary:payload.industry.secondary,
      confidence:1,
      source:'manual',
      classifiedAt:new Date().toISOString(),
    });
  }
  const chatAltText = text(payload.chatAltText || existing.chat_alt_text || DEFAULT_CHAT_ALT_TEXT, 300);
  await db.prepare('UPDATE contact_cards SET display_name=?,english_name=?,company_name=?,job_title=?,department=?,mobile=?,company_phone=?,email=?,website_url=?,line_url=?,address=?,service_description=?,note=?,normalized_mobile=?,normalized_email=?,normalized_name_company=?,selected_version=?,versions_json=?,chat_alt_text=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND scanner_user_id=?').bind(card.displayName,card.englishName,card.companyName,card.jobTitle,card.department,card.mobile,card.companyPhone,card.email,card.websiteUrl,card.lineUrl,card.address,card.serviceDescription,card.note,card.normalizedMobile,card.normalizedEmail,card.normalizedNameCompany,selectedVersion,JSON.stringify(versions),chatAltText,id,userId).run();
  return rowToCard(await db.prepare('SELECT * FROM contact_cards WHERE id=?').bind(id).first());
}

export async function deleteContact(db,bucket,userId,id) { const row=await db.prepare("SELECT front_r2_key FROM contact_cards WHERE id=? AND scanner_user_id=? AND status='active'").bind(id,userId).first(); if(!row) throw new Error('找不到收藏名片'); if(row.front_r2_key) await bucket.delete(row.front_r2_key); await db.prepare("UPDATE contact_cards SET status='archived',front_r2_key='',updated_at=CURRENT_TIMESTAMP WHERE id=? AND scanner_user_id=?").bind(id,userId).run(); }

export async function serveContactImage(db,bucket,request,userId,id) { const row=await db.prepare("SELECT front_r2_key,front_content_type FROM contact_cards WHERE id=? AND scanner_user_id=? AND status='active'").bind(id,userId).first(); if(!row?.front_r2_key)return new Response('Not found',{status:404}); const object=await bucket.get(row.front_r2_key); if(!object)return new Response('Not found',{status:404}); return new Response(request.method==='HEAD'?null:object.body,{headers:{'content-type':object.httpMetadata?.contentType||row.front_content_type||'image/webp','cache-control':'private, max-age=300','x-content-type-options':'nosniff'}}); }

export async function collectPublicCard(db,userId,personalCardId) {
  const source=await db.prepare("SELECT * FROM personal_cards WHERE id=? AND status='published'").bind(personalCardId).first(); if(!source)throw new Error('名片不存在或尚未公開'); if(source.platform_user_id===userId){const error=new Error('這是你自己的名片');error.code='self_card';throw error;}
  const existing=await db.prepare("SELECT * FROM contact_cards WHERE scanner_user_id=? AND source_personal_card_id=? AND status='active'").bind(userId,personalCardId).first(); if(existing)return {card:rowToCard(existing),duplicate:true};
  const card=cleanCard({displayName:source.display_name,englishName:source.english_name,companyName:source.company_name,jobTitle:source.job_title,department:source.department,mobile:source.mobile,companyPhone:source.company_phone,email:source.email,websiteUrl:source.website_url,lineUrl:source.line_url,address:source.address,serviceDescription:source.service_description});
  const duplicate=await findDuplicate(db,userId,card); if(duplicate)return {card:rowToCard(duplicate),duplicate:true};
  const id=newId('contact'); const versionsJson=withInsightMeta({},{status:'queued',cards:{},error:''}); await db.prepare('INSERT INTO contact_cards (id,scanner_user_id,source_type,source_personal_card_id,bound_user_id,display_name,english_name,company_name,job_title,department,mobile,company_phone,email,website_url,line_url,address,service_description,normalized_mobile,normalized_email,normalized_name_company,versions_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,userId,'public_card',personalCardId,source.platform_user_id,card.displayName,card.englishName,card.companyName,card.jobTitle,card.department,card.mobile,card.companyPhone,card.email,card.websiteUrl,card.lineUrl,card.address,card.serviceDescription,card.normalizedMobile,card.normalizedEmail,card.normalizedNameCompany,versionsJson).run(); return {card:rowToCard(await db.prepare('SELECT * FROM contact_cards WHERE id=?').bind(id).first()),duplicate:false};
}

function randomShareToken() {
  const bytes=crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
}

export async function createContactShare(db,userId,contactId,origin) {
  const card=await db.prepare("SELECT id,display_name FROM contact_cards WHERE id=? AND scanner_user_id=? AND status='active'").bind(contactId,userId).first();
  if(!card)throw new Error('找不到收藏名片');
  const token=randomShareToken();
  await db.batch([
    db.prepare("UPDATE contact_card_shares SET status='revoked',revoked_at=CURRENT_TIMESTAMP WHERE contact_card_id=? AND owner_user_id=? AND status='active'").bind(contactId,userId),
    db.prepare("INSERT INTO contact_card_shares (id,contact_card_id,owner_user_id,token_hash) VALUES (?,?,?,?)").bind(newId('contact_share'),contactId,userId,await sha256(token)),
  ]);
  return { url:`${origin}/d/${token}`, displayName:card.display_name };
}

export async function revokeContactShare(db,userId,contactId) {
  const result=await db.prepare("UPDATE contact_card_shares SET status='revoked',revoked_at=CURRENT_TIMESTAMP WHERE contact_card_id=? AND owner_user_id=? AND status='active'").bind(contactId,userId).run();
  return { revoked:Number(result.meta?.changes || 0)>0 };
}

async function sharedContactRow(db,rawToken) {
  const token=String(rawToken||'').trim();
  if(!/^[a-f0-9]{48}$/i.test(token))return null;
  return db.prepare(`SELECT cc.* FROM contact_card_shares ccs JOIN contact_cards cc ON cc.id=ccs.contact_card_id
    WHERE ccs.token_hash=? AND ccs.status='active' AND cc.status='active' LIMIT 1`).bind(await sha256(token)).first();
}

export async function getSharedContact(db,rawToken) {
  const row=await sharedContactRow(db,rawToken);
  if(!row)return null;
  // 僅以明確 allowlist 輸出；私人備註、收藏者、來源、內部 ID 與時間均不公開。
  const versions = parseVersions(row); const selectedVersion = CARD_VERSIONS.includes(row.selected_version) ? row.selected_version : 'standard'; const selected = versions[selectedVersion];
  return { displayName:row.display_name,englishName:row.english_name,companyName:row.company_name,jobTitle:row.job_title,department:row.department,mobile:row.mobile,companyPhone:row.company_phone,email:row.email,websiteUrl:row.website_url,lineUrl:row.line_url,address:row.address,serviceDescription:row.service_description,chatAltText:row.chat_alt_text || DEFAULT_CHAT_ALT_TEXT,selectedVersion,versions,coverUrl:selected.coverUrl,buttons:selected.buttons,hasImage:Boolean(row.front_r2_key) };
}

export async function serveSharedContactImage(db,bucket,request,rawToken) {
  const row=await sharedContactRow(db,rawToken);
  if(!row?.front_r2_key)return new Response('Not found',{status:404});
  const object=await bucket.get(row.front_r2_key);if(!object)return new Response('Not found',{status:404});
  return new Response(request.method==='HEAD'?null:object.body,{headers:{'content-type':object.httpMetadata?.contentType||row.front_content_type||'image/webp','cache-control':'public, max-age=300','x-content-type-options':'nosniff'}});
}
