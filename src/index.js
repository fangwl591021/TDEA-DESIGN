import { personalCardShareLiffHtml } from "./card-share-liff.js";
import {
  createSession,
  SESSION_MAX_AGE_SECONDS,
  sessionCookie,
  sessionTokenFromCookie,
  sha256,
  verifyLineAccessToken,
  verifyLineIdToken,
  verifySession,
} from "./auth.js";
import {
  createInviteLink,
  getAdminAccess,
  getMember,
  memberLiffReferralUrl,
  newId,
  resolveCanonicalMemberId,
  resolvePhoneBirthdayMember,
  resolveLineMember,
  updateMemberProfile,
} from "./member-repository.js";
import { adjustPoints, awardPoints, getWallet } from "./points.js";
import { handleTdeaPointService } from "./tdea-point-service.js";
import { lookupTdeaRosterMemberNumber, verifyTdeaRosterMember } from "./tdea-roster.js";
import {
  cancelCalendarSession,
  checkInToSession,
  smartCheckInToActiveSession,
  listAdminCourses,
  listCalendarSessions,
  listMyCourseSessions,
  listPublicCourseSessions,
  registerForSession,
  saveCalendarSession,
} from "./courses.js";
import {
  checkInDailyAd,
  getDailyAdCampaign,
  listDailyAdCampaigns,
  recordAdViewProgress,
  startAdView,
} from "./daily-ad.js";
import { issueWalletToken, resolveWalletToken } from "./wallet-qr.js";
import { getMyCard, getPublicCard, saveMyCard } from "./cards.js";
import {
  getLineTokenStatus,
  getLineAccessToken,
  handleRichMenuAction,
  saveLineToken,
  testSavedLineToken,
} from "./rich-menu.js";
import {
  deleteMediaAsset,
  listMediaAssets,
  removeTemplateMediaReferences,
  serveMediaAsset,
  syncTemplateMediaReferences,
  uploadVideoAsset,
  uploadVideoPoster,
} from "./media-library.js";
import {
  collectPublicCard,
  confirmImport,
  createContactShare,
  createImport,
  expandContactContent,
  INDUSTRY_OPTIONS,
  listContacts,
  normalizeEmail,
  normalizeNameCompany,
  normalizePhone,
  getSharedContact,
  recognizeImport,
  submitImportInBackground,
  processImportInBackground,
  queueContactCardReverification,
  queueMemberCardVerificationBackfill,
  reverifyContactFromSource,
  queueLegacyFailedImportRetries,
  queueMemberStaleCardAnalysis,
  queueContactCrmInsights,
  processContactInsightsInBackground,
  queueSystemCrmInsightBackfill,
  revokeContactShare,
  serveContactImage,
  serveSharedContactImage,
  updateContact,
  verifyContactCardData,
} from "./card-collection.js";
import {
  processContactAiCardCrm,
  queueContactAiCardCrm,
  queueMemberAiCardCrmBackfill,
  queueSystemAiCardCrmBackfill,
} from "./ai-card-crm.js";
import {
  deleteOpenAIKey,
  getOpenAIKeyStatus,
  resolveOpenAIKey,
  saveOpenAIKey,
  testOpenAIKey,
} from "./openai-settings.js";
import {
  getMemberCrmInsight,
  processMemberCrmInsight,
  queueMemberCrmInsight,
  queueSystemMemberCrmInsightBackfill,
} from "./member-crm-insights.js";
import {
  listPersonalityAssessmentResults,
  publicPersonalityAssessments,
  savePersonalityAssessment,
} from "./personality-assessments.js";
import {
  processMemberMatchRankings,
  queueMemberMatchRankingRefresh,
} from "./member-match-ranking.js";
import { syncMlmCourses } from "./mlm-course-sync.js";
import {
  createCalendarLabel,
  deleteCalendarLabel,
  deletePersonalCalendarEvent,
  listPersonalCalendar,
  savePersonalCalendarEvent,
  updateCalendarLabel,
} from "./personal-calendar.js";
import {
  buildCalendarVoiceProposal,
  parseCalendarVoice,
} from "./calendar-voice.js";
import { buildMatchingCandidates, isSupportedMatchingQuery, matchContacts, SMART_MATCH_SCOPE_MESSAGE } from "./smart-matching.js";
import {
  actOnTask,
  createTask,
  dispatchDueTaskPushes,
  dispatchTaskPush,
  generateNextTask,
  getTaskTelegramBotToken,
  listTasks,
  saveTaskChannels,
} from "./task-engine.js";
import {
  discoverTelegramPrivateChat,
  sendTelegramTaskTest,
} from "./telegram-task-notifications.js";
import { normalizeTelegramBotToken } from "./telegram-token-crypto.js";
import {
  findCachedSmartMatch,
  listContactSmartMatchHistory,
  saveSmartMatch,
} from "./smart-match-history.js";
import {
  deleteContactAndReverseReward,
  queueAndFulfillCardCollectionReward,
  reconcileMemberCardCollectionRewards,
  retryPendingCardCollectionRewards,
} from "./card-collection-reward.js";
import {
  createBlogPost,
  deleteBlogPost,
  getPublishedBlogPost,
  listAdminBlogPosts,
  listPublishedBlogPosts,
  updateBlogPost,
} from "./blog.js";

const json = (data, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });

const POINT_RULE_EVENTS = new Set([
  'member_joined',
  'registration_completed',
  'daily_ad_checkin',
  'share_referral',
  'course_registered',
  'attendance_verified',
  'referral_attendance_reward',
  'task_completed',
  'card_collection_reward',
]);

const CANCELLED_POINT_RULE_EVENTS = [
  'member_joined',
  'referral_attendance_reward',
  'registration_completed',
];

async function ensureServicePointRules(db) {
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO point_rules
      (id,program_id,event_type,points,daily_limit,award_frequency,status,rule_version)
      VALUES ('pointrule_card_collection','program_main','card_collection_reward',10,NULL,'per_completion','active','v1')`),
    db.prepare(`INSERT OR IGNORE INTO point_rules
      (id,program_id,event_type,points,daily_limit,award_frequency,status,rule_version)
      VALUES ('pointrule_default_daily_ad_checkin','program_main','daily_ad_checkin',1,NULL,'daily','active','v1')`),
    db.prepare(`UPDATE point_rules SET status='archived',updated_at=CURRENT_TIMESTAMP
      WHERE program_id='program_main' AND event_type IN ('member_joined','referral_attendance_reward','registration_completed')
        AND status!='archived'`),
  ]);
}
function badRequest(message) {
  return json({ success: false, error: message }, 400);
}

function escapeWalletHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function walletScanResultHtml(result, status = result?.ok ? 200 : 410) {
  const accepted = result?.ok === true;
  const title = accepted ? "會員錢包已讀取" : "QR Code 已失效";
  const message = accepted
    ? "已完成會員識別。此畫面不會自動扣除點數。"
    : "請回到「有點開心」重新產生 QR Code，再掃描一次。";
  const memberName = escapeWalletHtml(result?.member?.displayName || "A’kaffit 會員");
  const balance = Number.isFinite(Number(result?.wallet?.balance))
    ? Number(result.wallet.balance).toLocaleString("zh-TW")
    : "0";
  const details = accepted
    ? `<section class="wallet"><span>會員</span><strong>${memberName}</strong><span>有點開心</span><b>${balance} 點</b></section>`
    : "";
  return new Response(`<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="referrer" content="no-referrer">
  <title>${title}｜A’kaffit</title>
  <style>
    :root{--primary:#b95121;--deep:#713015;--cream:#fff8f3;--soft:#f9e9df;--ink:#3d2920;--ok:#18794e}
    *{box-sizing:border-box}html,body{min-height:100%;margin:0}body{display:grid;place-items:center;padding:24px;padding-top:calc(24px + env(safe-area-inset-top));padding-bottom:calc(24px + env(safe-area-inset-bottom));background:var(--cream);color:var(--ink);font-family:system-ui,"Noto Sans TC",sans-serif}
    main{width:min(420px,100%);padding:28px 24px;border:1px solid #eacdbf;border-radius:24px;background:#fff;text-align:center;box-shadow:0 8px 24px #71301514}.brand{margin:0 0 22px;color:var(--primary);font:800 28px/1 Georgia,serif}.mark{display:grid;width:68px;height:68px;margin:0 auto 18px;place-items:center;border-radius:50%;background:${accepted ? "#e7f5ee" : "var(--soft)"};color:${accepted ? "var(--ok)" : "var(--primary)"};font-size:34px;font-weight:900}h1{margin:0;font-size:24px}p{margin:10px 0 0;color:#80685d;font-size:15px;line-height:1.65}.wallet{display:grid;grid-template-columns:1fr auto;gap:9px 16px;margin-top:22px;padding:18px;border-radius:16px;background:var(--soft);text-align:left}.wallet span{color:#8b6655;font-size:13px}.wallet strong,.wallet b{color:var(--deep);font-size:18px}.wallet strong,.wallet b{text-align:right}.foot{margin-top:20px;font-size:12px;color:#9a8176}
  </style>
</head>
<body><main><div class="brand">A’kaffit</div><div class="mark">${accepted ? "✓" : "!"}</div><h1>${title}</h1><p>${message}</p>${details}<p class="foot">動態 QR Code 僅在產生後 60 秒內有效</p></main></body>
</html>`, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}
function officialTallLiffHtml(env, requestUrl) {
  const liffId = String(env.OFFICIAL_LIFF_ID || "2007221311-nEOHqNxK");
  const url = new URL(requestUrl);
  let page = url.searchParams.get("page") || "";
  const liffState = url.searchParams.get("liff.state");
  if (!page && liffState) {
    try {
      page = new URL(liffState, url.origin).searchParams.get("page") || "";
    } catch {
      page = "";
    }
  }
  const officialPages = {
    home: "https://www.k-link.com.tw/",
    about: "https://www.k-link.com.tw/about-us%E8%B5%B0%E9%80%B2%E5%BA%B7%E7%AB%8B",
    news: "https://www.k-link.com.tw/news-%E6%9C%80%E6%96%B0%E6%B6%88%E6%81%AF",
    products: "https://www.k-link.com.tw/products-%E7%94%A2%E5%93%81%E7%B8%BD%E8%A6%BD",
    video: "https://www.k-link.com.tw/video%E5%BD%B1%E9%9F%B3%E5%B0%88%E5%8D%80",
  };
  const target = officialPages[page] || officialPages.home;
  return new Response(`<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <title>康立官方網站</title>
  <script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
  <style>*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#fff}iframe{display:block;width:100%;height:100%;border:0;background:#fff}.loading{position:fixed;inset:0;z-index:1;display:grid;place-items:center;background:#f7f4ed;color:#203329;font:700 16px/1.5 system-ui,"Noto Sans TC",sans-serif;pointer-events:none}.loading::before{content:"";position:absolute;width:38px;height:38px;margin-top:-58px;border:4px solid #dfe9df;border-top-color:#328c45;border-radius:50%;animation:spin .8s linear infinite}.loading.hidden{display:none}@keyframes spin{to{transform:rotate(360deg)}}</style>
</head>
<body><div id="loading" class="loading">正在開啟康立官方網站…</div><iframe id="officialSite" title="康立官方網站" allow="fullscreen" referrerpolicy="strict-origin-when-cross-origin"></iframe>
<script>
  const LIFF_ID=${JSON.stringify(liffId)};
  const TARGET=${JSON.stringify(target)};
  const frame=document.querySelector("#officialSite");
  const loading=document.querySelector("#loading");
  frame.addEventListener("load",()=>loading.classList.add("hidden"));
  (async()=>{
    try{
      await liff.init({liffId:LIFF_ID});
      frame.src=TARGET;
    }catch(error){
      console.error("Official LIFF init failed",error);
      loading.textContent="LIFF 開啟失敗，請關閉後重新嘗試。";
    }
  })();
</script></body></html>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

async function resolveCardAiProvider(env) {
  if (env.MLM_WORKER) return env.MLM_WORKER;
  return resolveOpenAIKey(env.DB, env.SESSION_SIGNING_SECRET, env.OPENAI_API_KEY);
}

function scheduleCardImportPipeline(env, ctx, userId, eventId, provider = null) {
  const task=(async()=>{
    const aiProvider=provider || await resolveCardAiProvider(env);
    if(!aiProvider)throw new Error('MLM AI 服務尚未連線');
    // 第一階段：只做 OCR、寫入收藏與防重判斷。
    const processed=await processImportInBackground(env.DB,env.MEDIA,userId,eventId,aiProvider,env.OPENAI_CARD_MODEL);
    if(processed?.created){
      // OCR 收藏成立後先贈點；五大標籤是第二階段，失敗不影響收藏與贈點。
      await queueAndFulfillCardCollectionReward(env,userId,processed.card.id);
      await processContactInsightsInBackground(env.DB,userId,processed.card.id,aiProvider,env.OPENAI_CARD_MODEL);
      await processContactAiCardCrm(env.DB,userId,processed.card.id,aiProvider,env.OPENAI_CARD_MODEL);
      if(await queueMemberMatchRankingRefresh(env.DB,userId,true,processed.card.id))await processMemberMatchRankings(env.DB,userId,aiProvider,env.OPENAI_CARD_MODEL);
    }
    return processed;
  })();
  if(ctx?.waitUntil)ctx.waitUntil(task);
  else task.catch((error)=>console.error('Background card OCR pipeline failed',error));
  return task;
}

function scheduleContactCrmInsights(env, ctx, userId, id) {
  const task=(async()=>{
    const aiProvider=await resolveCardAiProvider(env);
    if(!aiProvider)throw new Error('MLM AI 服務尚未連線');
    await processContactInsightsInBackground(env.DB,userId,id,aiProvider,env.OPENAI_CARD_MODEL);
    if(await queueMemberMatchRankingRefresh(env.DB,userId,true,id))await processMemberMatchRankings(env.DB,userId,aiProvider,env.OPENAI_CARD_MODEL);
  })();
  if(ctx?.waitUntil)ctx.waitUntil(task);
  else task.catch((error)=>console.error('Automatic CRM insight analysis failed',error));
}

function scheduleContactAiCardCrm(env,ctx,userId,id) {
  const task=(async()=>{
    const aiProvider=await resolveCardAiProvider(env);
    if(!aiProvider)throw new Error("MLM AI 服務尚未連線");
    await processContactAiCardCrm(env.DB,userId,id,aiProvider,env.OPENAI_CARD_MODEL);
  })();
  if(ctx?.waitUntil)ctx.waitUntil(task);
  else task.catch((error)=>console.error("Automatic AI business-card CRM enrichment failed",error));
  return task;
}
function scheduleContactCardReverification(env,ctx,userId,id) {
  const task=(async()=>{
    const aiProvider=await resolveCardAiProvider(env);
    if(!aiProvider)throw new Error('MLM AI 服務尚未連線');
    await reverifyContactFromSource(env.DB,env.MEDIA,userId,id,aiProvider,env.OPENAI_CARD_MODEL);
    await processContactInsightsInBackground(env.DB,userId,id,aiProvider,env.OPENAI_CARD_MODEL);
    await processContactAiCardCrm(env.DB,userId,id,aiProvider,env.OPENAI_CARD_MODEL);
    if(await queueMemberMatchRankingRefresh(env.DB,userId,true,id))await processMemberMatchRankings(env.DB,userId,aiProvider,env.OPENAI_CARD_MODEL);
  })();
  if(ctx?.waitUntil)ctx.waitUntil(task);
  else task.catch((error)=>console.error('Business-card reverification failed',error));
  return task;
}

function scheduleMemberCrmInsights(env,ctx,userId) {
  const task=(async()=>{
    const aiProvider=await resolveCardAiProvider(env);
    await processMemberCrmInsight(env.DB,userId,aiProvider,env.OPENAI_CARD_MODEL);
    if(await queueMemberMatchRankingRefresh(env.DB,userId,true))await processMemberMatchRankings(env.DB,userId,aiProvider,env.OPENAI_CARD_MODEL);
  })();
  if(ctx?.waitUntil)ctx.waitUntil(task);
  else task.catch((error)=>console.error('Automatic member CRM insight analysis failed',error));
}

function scheduleMemberMatchRanking(env,ctx,userId,alreadyQueued=false) {
  const task=(async()=>{
    const queued=alreadyQueued ? 1 : await queueMemberMatchRankingRefresh(env.DB,userId);
    if(!queued)return {processed:0,ranked:0};
    const aiProvider=await resolveCardAiProvider(env);
    if(!aiProvider)throw new Error('MLM AI 服務尚未連線');
    return processMemberMatchRankings(env.DB,userId,aiProvider,env.OPENAI_CARD_MODEL);
  })();
  if(ctx?.waitUntil)ctx.waitUntil(task);
  else task.catch((error)=>console.error('Automatic member match ranking failed',error));
  return task;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function bearerToken(request) {
  const header = request.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

async function currentMember(request, env) {
  if (!env.SESSION_SIGNING_SECRET) return null;
  const tokens = [
    bearerToken(request),
    sessionTokenFromCookie(request.headers.get("cookie") || ""),
  ].filter(Boolean);
  for (const token of new Set(tokens)) {
    const session = await verifySession(token, env.SESSION_SIGNING_SECRET);
    if (session) {
      const canonicalUserId = await resolveCanonicalMemberId(env.DB, session.sub);
      const member = await getMember(env.DB, canonicalUserId);
      if (member?.status === "active") return member;
    }
  }
  return null;
}

async function mergedAdminAccess(env, member) {
  return getAdminAccess(env.DB, member.userId, env.ADMIN_LINE_SUBJECTS);
}

async function currentAdmin(request, env) {
  const member = await currentMember(request, env);
  if (!member) return null;
  const adminAccess = await mergedAdminAccess(env,member);
  return adminAccess.canAccessAdmin ? { ...member, adminAccess } : null;
}

function randomInviteToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

function normalizeTemplateImageUrl(value) {
  return String(value || "").replace(
    "/assets/checkin-template/",
    "/v1/checkin-template/images/",
  );
}

function courseCheckinCompactLiffHtml(env, origin) {
  const liffId = String(env.CHECKIN_LIFF_ID || "");
  const apiOrigin = String(origin || "");
  return new Response(`<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>課程報到</title>
  <script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
  <style>
    :root{--ink:#2d1d22;--muted:#8f7a82;--rose:#b96072;--soft:#f9edf0;--ok:#0c9f57}
    *{box-sizing:border-box}html,body{min-height:100%;margin:0;background:#fff;color:var(--ink);font-family:"Noto Sans TC",system-ui,sans-serif}
    body{display:grid;place-items:center;padding:24px;padding-top:calc(24px + env(safe-area-inset-top));padding-bottom:calc(24px + env(safe-area-inset-bottom))}
    main{width:min(300px,100%);text-align:center}.spinner{width:34px;height:34px;margin:0 auto 18px;border:4px solid #f5dfe5;border-top-color:var(--rose);border-radius:50%;animation:spin .8s linear infinite}.mark{display:none;width:64px;height:64px;margin:0 auto 18px;border-radius:20px;background:var(--soft);color:var(--rose);place-items:center;font-size:30px;font-weight:900}.mark.show{display:grid}.success .mark{background:#e8f8ef;color:var(--ok)}h1{margin:0;font-size:22px;line-height:1.35}p{margin:10px 0 0;color:var(--muted);font-size:15px;line-height:1.65}.error h1{color:var(--rose)}@keyframes spin{to{transform:rotate(360deg)}}
  </style>
</head>
<body><main id="app"><div id="spinner" class="spinner"></div><div id="mark" class="mark">✓</div><h1 id="title">正在確認課程報到</h1><p id="message">核對會員資格、報名紀錄與報到時間…</p></main>
<script>
  const LIFF_ID=${JSON.stringify(liffId)};
  const API_ORIGIN=${JSON.stringify(apiOrigin)};
  const title=document.querySelector("#title"), message=document.querySelector("#message"), spinner=document.querySelector("#spinner"), mark=document.querySelector("#mark"), app=document.querySelector("#app");
  const show=(heading,detail,type="")=>{title.textContent=heading;message.textContent=detail||"";spinner.style.display="none";mark.classList.add("show");app.className=type;};
  const close=()=>setTimeout(()=>{try{if(liff.isInClient())liff.closeWindow();else window.close();}catch(_){window.close();}},2400);
  // LIFF OAuth 回跳時網址會帶 liff.state / code；絕不可再拿原網址登入，
  // 否則會將舊 code 重複兌換，造成 LIFF 開關循環。
  const cleanCheckinRedirect=()=>{
    const url=new URL(location.href);
    ["code","state","scope","error","error_description","liff.state","liff.referrer"].forEach((key)=>url.searchParams.delete(key));
    url.searchParams.set("smartCheckin","1");
    return url.toString();
  };
  (async()=>{
    try{
      await liff.init({liffId:LIFF_ID});
      if(!liff.isLoggedIn()){
        // 一次回跳後仍沒有登入態時停在結果頁，不再自動重導而陷入循環。
        if(sessionStorage.getItem("klinkweb_compact_checkin_login")==="1"){
          sessionStorage.removeItem("klinkweb_compact_checkin_login");
          throw new Error("LINE 登入未完成，請關閉後重新掃描報到 QR Code");
        }
        sessionStorage.setItem("klinkweb_compact_checkin_login","1");
        liff.login({redirectUri:cleanCheckinRedirect()});return;
      }
      sessionStorage.removeItem("klinkweb_compact_checkin_login");
      const profile=await liff.getProfile().catch(()=>null);
      const auth=await fetch(API_ORIGIN+"/v1/auth/line/verify",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({idToken:liff.getIDToken(),accessToken:liff.getAccessToken()||"",pictureUrl:profile?.pictureUrl||"",displayName:profile?.displayName||""})});
      const identity=await auth.json().catch(()=>({}));
      if(!auth.ok||!identity.sessionToken)throw new Error(identity.error||"LINE 身份驗證失敗");
      const checkin=await fetch(API_ORIGIN+"/v1/course-sessions/smart-check-in",{method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+identity.sessionToken},body:"{}"});
      const result=await checkin.json().catch(()=>({}));
      if(!checkin.ok)throw new Error(({no_active_session:"目前沒有可報到的活動，請確認時間。",registration_required:"尚未報名本場活動，無法報到。",session_unavailable:"此活動目前無法報到。"}[result.error])||result.error||"報到失敗");
      show(result.duplicate?"本課程已完成報到":"課程報到成功",result.duplicate?"你已完成本場簽到。":"已核對報名與報到時間，簽到點數將依規則入帳。","success");close();
    }catch(error){show("暫時無法完成報到",error.message||"請稍後再試","error");}
  })();
</script></body></html>`,{headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store"}});
}

const AKAFFIT_YOUTUBE_CHANNEL_ID = "UCQWEa3bZ4hIPD7ZuTAFw4wQ";
const AKAFFIT_YOUTUBE_CHANNEL_URL = "https://www.youtube.com/@akaffit";

async function boundedResponseText(response, maxBytes = 524288) {
  if (!response.body) return "";
  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > maxBytes) throw new Error("Upstream response is too large");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel();
        throw new Error("Upstream response is too large");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

const TDEA_SHOWCASE_MAX_BYTES = 2 * 1024 * 1024;

function tdeaShowcaseText(value, maxLength = 1200) {
  return String(value || "").trim().slice(0, maxLength);
}

function tdeaShowcaseUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return ["https:", "http:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

async function fetchTdeaShowcase(env) {
  if (!env.TDEA_WORKER || typeof env.TDEA_WORKER.fetch !== "function") throw new Error("TDEA service binding is unavailable");
  const requestOptions = { headers: { accept: "application/json" } };
  const [managerResponse, marqueeResponse] = await Promise.all([
    env.TDEA_WORKER.fetch("https://tdea.internal/api/manager-data", requestOptions),
    env.TDEA_WORKER.fetch("https://tdea.internal/api/marquee", requestOptions),
  ]);
  if (!managerResponse.ok || !marqueeResponse.ok) throw new Error("TDEA showcase source is unavailable");
  const managerPayload = JSON.parse(await boundedResponseText(managerResponse, TDEA_SHOWCASE_MAX_BYTES));
  const marqueePayload = JSON.parse(await boundedResponseText(marqueeResponse, TDEA_SHOWCASE_MAX_BYTES));
  const activities = (Array.isArray(managerPayload?.data?.activities) ? managerPayload.data.activities : [])
    .filter((activity) => tdeaShowcaseText(activity?.status, 20) === "上架")
    .map((activity) => ({ id:tdeaShowcaseText(activity?.id,160), title:tdeaShowcaseText(activity?.name,180), description:tdeaShowcaseText(activity?.detailText || activity?.description,900), courseTime:tdeaShowcaseText(activity?.courseTime,120), deadline:tdeaShowcaseText(activity?.deadline,120), capacity:Math.max(0,Number(activity?.capacity)||0), imageUrl:tdeaShowcaseUrl(activity?.posterUrl || activity?.imageUrl || activity?.formSettings?.posterUrl), registrationUrl:tdeaShowcaseUrl(activity?.nativeFormUrl || activity?.formUrl || activity?.formSettings?.nativeFormUrl) }))
    .filter((activity) => activity.id && activity.title).slice(0,24);
  const marquee = marqueePayload?.data || {};
  const ads = (Array.isArray(marquee?.imageItems) ? marquee.imageItems : [])
    .filter((item) => item?.enabled !== false)
    .map((item) => ({ id:tdeaShowcaseText(item?.id,160), title:tdeaShowcaseText(item?.title || marquee?.title || "TDEA 廣告贈點",120), imageUrl:tdeaShowcaseUrl(item?.imageUrl), points:Math.max(1,Number(item?.points)||1) }))
    .filter((item) => item.id && item.imageUrl).slice(0,20);
  return { activities, ads, adLiffUrl:tdeaShowcaseUrl(marqueePayload?.liffUrl) };
}
function decodeYoutubeXml(value = "") {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

async function akaffitYoutubeVideos() {
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${AKAFFIT_YOUTUBE_CHANNEL_ID}`;
  try {
    const upstream = await fetch(feedUrl, {
      headers: { accept: "application/atom+xml,application/xml;q=0.9" },
    });
    if (!upstream.ok) throw new Error(`YouTube feed returned ${upstream.status}`);
    const xml = await boundedResponseText(upstream);
    const videos = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].slice(0, 12).map((match) => {
      const entry = match[1];
      const videoId = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1] || "";
      const title = decodeYoutubeXml(entry.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "");
      const publishedAt = entry.match(/<published>([^<]+)<\/published>/)?.[1] || "";
      if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) return null;
      return {
        videoId,
        title,
        publishedAt,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      };
    }).filter(Boolean);
    const response = json({
      success: true,
      channel: { title: "Akaffit 咖啡", url: AKAFFIT_YOUTUBE_CHANNEL_URL },
      videos,
    });
    response.headers.set("cache-control", "public, max-age=300");
    return response;
  } catch (error) {
    console.error("Akaffit YouTube feed failed", error);
    return json({ success: false, error: "YouTube 頻道暫時無法載入" }, 502);
  }
}

const AKAFFIT_OFFICIAL_URL = "https://www.akaffit.com/";
const AKAFFIT_OFFICIAL_ASSETS = Object.freeze({
  runtime: "https://www.akaffit.com/script/script.js",
  slick: "https://www.akaffit.com/slick/slick.min.js",
  core: "https://www.akaffit.com/slick/slick.css",
  theme: "https://www.akaffit.com/slick/slick-theme.css",
  woff: "https://www.akaffit.com/slick/fonts/slick.woff",
  ttf: "https://www.akaffit.com/slick/fonts/slick.ttf",
});

async function officialAkaffitAsset(kind) {
  const target = AKAFFIT_OFFICIAL_ASSETS[kind];
  if (!target) return new Response("Not Found", { status: 404 });
  let upstream;
  try {
    upstream = await fetch(target, { headers: { accept: "*/*" } });
  } catch (error) {
    console.error("Akaffit official asset fetch failed", { kind, error });
    return new Response("Official asset unavailable", { status: 502 });
  }
  if (!upstream.ok || !upstream.body) return new Response("Official asset unavailable", { status: 502 });
  const contentTypes = {
    runtime: "application/javascript; charset=utf-8",
    slick: "application/javascript; charset=utf-8",
    core: "text/css; charset=utf-8",
    theme: "text/css; charset=utf-8",
    woff: "font/woff",
    ttf: "font/ttf",
  };
  const headers = {
    "content-type": contentTypes[kind],
    "cache-control": "public, max-age=3600",
    "access-control-allow-origin": "*",
    "x-content-type-options": "nosniff",
  };
  if (kind === "theme") {
    const css = (await boundedResponseText(upstream, 131072))
      .replaceAll("./fonts/slick.woff", "/akaffit-official-font/slick.woff")
      .replaceAll("./fonts/slick.ttf", "/akaffit-official-font/slick.ttf");
    return new Response(css, { headers });
  }
  return new Response(upstream.body, { headers });
}

function officialSiteUnavailable(message = "A’kaffit 官網暫時無法載入") {
  return new Response(`<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>A’kaffit</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f8f3ef;color:#a6451d;font:600 16px/1.6 system-ui,sans-serif}p{padding:28px;text-align:center}</style><p>${message}</p></html>`, {
    status: 502,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

async function officialAkaffitSite() {
  let upstream;
  try {
    upstream = await fetch(AKAFFIT_OFFICIAL_URL, {
      redirect: "follow",
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "AkaffitTeam/1.0 (+https://akaffit-team.fangwl591021.workers.dev/)",
      },
    });
  } catch (error) {
    console.error("Akaffit official site fetch failed", error);
    return officialSiteUnavailable();
  }
  if (!upstream.ok || !upstream.body) {
    console.error("Akaffit official site returned", upstream.status);
    return officialSiteUnavailable();
  }

  const response = new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=180",
      "referrer-policy": "strict-origin-when-cross-origin",
      "x-content-type-options": "nosniff",
    },
  });
  const hideContactStyle = "body>header,.footer_info,.floating-icon,a[href*='contact'],a[href^='tel:'],a[href^='mailto:']{display:none!important}";
  return new HTMLRewriter()
    .on("head", {
      element(element) {
        element.prepend(`<base href="${AKAFFIT_OFFICIAL_URL}" target="_blank"><style>${hideContactStyle}</style>`, { html: true });
      },
    })
    .on("meta[http-equiv]", {
      element(element) {
        if ((element.getAttribute("http-equiv") || "").toLowerCase() === "content-security-policy") element.remove();
      },
    })
    .on("script[src]", {
      element(element) {
        const src = element.getAttribute("src") || "";
        try {
          if (new URL(src, AKAFFIT_OFFICIAL_URL).pathname === "/script/script.js") {
            element.setAttribute("src", "/akaffit-official-runtime");
          } else if (new URL(src, AKAFFIT_OFFICIAL_URL).pathname === "/slick/slick.min.js") {
            element.setAttribute("src", "/akaffit-official-slick.js");
          }
        } catch { /* keep malformed upstream URL untouched */ }
      },
    })
    .on("link[href]", {
      element(element) {
        const href = element.getAttribute("href") || "";
        try {
          const pathname = new URL(href, AKAFFIT_OFFICIAL_URL).pathname;
          if (pathname === "/slick/slick.css") {
            element.setAttribute("href", "/akaffit-official-slick.css");
          } else if (pathname === "/slick/slick-theme.css") {
            element.setAttribute("href", "/akaffit-official-slick-theme.css");
          }
        } catch { /* keep malformed upstream URL untouched */ }
      },
    })
    .on("body > header", { element(element) { element.setAttribute("hidden", "").setAttribute("style", "display:none!important"); } })
    .on(".footer_info", { element(element) { element.setAttribute("hidden", "").setAttribute("style", "display:none!important"); } })
    .on(".floating-icon", { element(element) { element.setAttribute("hidden", "").setAttribute("style", "display:none!important"); } })
    .on("a", {
      element(element) {
        const href = (element.getAttribute("href") || "").trim();
        if (/^(?:mailto:|tel:)/i.test(href) || /(?:^|\/)contact(?:[/?#]|$)/i.test(href)) {
          element.setAttribute("hidden", "").setAttribute("style", "display:none!important");
          return;
        }
        element.setAttribute("target", "_blank").setAttribute("rel", "noopener noreferrer");
      },
    })
    .transform(response);
}

async function app(request, env, ctx) {
  const url = new URL(request.url);
  const tdeaPointResponse = await handleTdeaPointService(request, env);
  if (tdeaPointResponse) return tdeaPointResponse;
  let cardShareId = "";
  if (request.method === "GET" && url.pathname === "/r/card-share") {
    cardShareId = String(url.searchParams.get("shareCardId") || "").trim();
  } else if (request.method === "GET" && url.pathname === "/") {
    const liffState = url.searchParams.get("liff.state");
    if (liffState) {
      try {
        const stateUrl = new URL(liffState, url.origin);
        if (stateUrl.pathname === "/r/card-share") {
          cardShareId = String(stateUrl.searchParams.get("shareCardId") || "").trim();
        }
      } catch {
        cardShareId = "";
      }
    } else if (url.searchParams.get("share") === "1") {
      cardShareId = String(url.searchParams.get("shareCardId") || "").trim();
    }
  }
  if (cardShareId) {
    if (!env.CARD_SHARE_LIFF_ID) return new Response("尚未設定名片分享 LIFF", { status: 503 });
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(cardShareId)) return new Response("名片分享網址無效", { status: 400 });
    return personalCardShareLiffHtml({ liffId: env.CARD_SHARE_LIFF_ID, origin: url.origin, cardId: cardShareId });
  }
  if (
    (request.method === "GET" || request.method === "HEAD") &&
    url.pathname === "/admin"
  ) {
    const adminUrl = new URL("/admin/", url.origin);
    adminUrl.search = url.search;
    return Response.redirect(adminUrl.toString(), 302);
  }
  if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/official") {
    return officialTallLiffHtml(env, url.toString());
  }
  if (request.method === "GET" && url.pathname === "/akaffit-official") {
    return officialAkaffitSite();
  }
  if (request.method === "GET" && url.pathname === "/akaffit-official-runtime") {
    return officialAkaffitAsset("runtime");
  }
  if (request.method === "GET" && url.pathname === "/akaffit-official-slick.js") {
    return officialAkaffitAsset("slick");
  }
  if (request.method === "GET" && url.pathname === "/akaffit-official-slick.css") {
    return officialAkaffitAsset("core");
  }
  if (request.method === "GET" && url.pathname === "/akaffit-official-slick-theme.css") {
    return officialAkaffitAsset("theme");
  }
  if (request.method === "GET" && url.pathname === "/akaffit-official-font/slick.woff") {
    return officialAkaffitAsset("woff");
  }
  if (request.method === "GET" && url.pathname === "/akaffit-official-font/slick.ttf") {
    return officialAkaffitAsset("ttf");
  }
  if (request.method === "GET" && url.pathname === "/v1/youtube/videos") {
    return akaffitYoutubeVideos();
  }
  const walletScanPath = url.pathname.match(/^\/w\/([A-Fa-f0-9]{48})$/);
  if (request.method === "GET" && walletScanPath) {
    try {
      const result = await resolveWalletToken(env.DB, walletScanPath[1], "wallet_qr_web");
      return walletScanResultHtml(result);
    } catch (error) {
      console.error("Wallet QR web scan failed", error);
      return walletScanResultHtml({ ok: false }, 503);
    }
  }
  const publicCardPath = url.pathname.match(/^\/c\/([A-Za-z0-9_-]+)$/);
  if (request.method === "GET" && publicCardPath) {
    const landingUrl = new URL("/", url.origin);
    landingUrl.searchParams.set("publicCard", publicCardPath[1]);
    const inviteToken = String(url.searchParams.get("invite") || "").trim();
    if (inviteToken) landingUrl.searchParams.set("invite", inviteToken);
    return Response.redirect(landingUrl.toString(), 302);
  }  const sharedContactPath = url.pathname.match(/^\/d\/([A-Fa-f0-9]{48})$/);
  if (request.method === "GET" && sharedContactPath) {
    return Response.redirect(`${url.origin}/?sharedContact=${encodeURIComponent(sharedContactPath[1])}`, 302);
  }
  if (request.method === "GET" && url.pathname === "/v1/blog/posts") {
    return json({
      success: true,
      ...(await listPublishedBlogPosts(env.DB, {
        category: url.searchParams.get("category") || "",
        limit: url.searchParams.get("limit") || 12,
      })),
    });
  }
  const publicBlogMatch = url.pathname.match(/^\/v1\/blog\/posts\/([^/]+)$/);
  if (request.method === "GET" && publicBlogMatch) {
    const post = await getPublishedBlogPost(env.DB, decodeURIComponent(publicBlogMatch[1]));
    return post
      ? json({ success: true, post })
      : json({ success: false, error: "文章不存在" }, 404);
  }


  if (request.method === "GET" && (url.pathname === "/r/checkin" || url.pathname === "/r/course-checkin")) {
    // Same two-step Compact LIFF pattern as MLM:
    // QR -> LIFF -> this endpoint with liff.state -> compact verification screen.
    // LIFF 初次開啟帶 liff.state；LINE Login OAuth 回跳則帶 code/state。
    // 兩種都必須回到 Compact 頁交給 liff.init 消耗 code，不能再 redirect 回
    // liff.line.me，否則會在 LIFF 與登入頁之間無限循環。
    if (
      env.CHECKIN_LIFF_ID &&
      (url.searchParams.get("smartCheckin") === "1" ||
        url.searchParams.has("liff.state") ||
        (url.searchParams.has("code") && url.searchParams.has("state")))
    ) {
      return courseCheckinCompactLiffHtml(env, url.origin);
    }
    const liffId = env.CHECKIN_LIFF_ID || env.LIFF_ID;
    const target = liffId
      ? `https://liff.line.me/${encodeURIComponent(liffId)}?smartCheckin=1`
      : `${url.origin}/?smartCheckin=1`;
    return Response.redirect(target, 302);
  }
  const templateImage = url.pathname.match(/^\/(?:assets\/checkin-template|v1\/checkin-template\/images)\/([^/]+)$/);
  if (request.method === "GET" && templateImage) {
    const row = await env.DB.prepare("SELECT content_type, bytes FROM checkin_template_images WHERE id = ?").bind(templateImage[1]).first();
    if (!row?.bytes) return new Response("Not found", { status: 404 });
    const imageBytes = row.bytes instanceof Uint8Array
      ? row.bytes
      : new Uint8Array(row.bytes);
    return new Response(imageBytes, {
      headers: {
        "content-type": row.content_type || "application/octet-stream",
        "content-length": String(imageBytes.byteLength),
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  }
  const mediaMatch = url.pathname.match(/^\/v1\/media\/([^/]+)\/(video|poster)$/);
  if (["GET", "HEAD"].includes(request.method) && mediaMatch) {
    return serveMediaAsset(env.DB, env.MEDIA, request, decodeURIComponent(mediaMatch[1]), mediaMatch[2]);
  }
  const cardMedia = url.pathname.match(/^\/v1\/cards\/media\/([^/]+)$/);
  if (request.method === "GET" && cardMedia) {
    const row = await env.DB.prepare("SELECT content_type, bytes FROM personal_card_media WHERE id = ?").bind(cardMedia[1]).first();
    if (!row?.bytes) return new Response("Not found", { status: 404 });
    const imageBytes = row.bytes instanceof Uint8Array ? row.bytes : new Uint8Array(row.bytes);
    return new Response(imageBytes, { headers: { "content-type": row.content_type || "application/octet-stream", "content-length": String(imageBytes.byteLength), "cache-control": "public, max-age=31536000, immutable" } });
  }
  const memberLogo = url.pathname.match(/^\/v1\/member-logo\/([^/]+)$/);
  if (["GET", "HEAD"].includes(request.method) && memberLogo) {
    const userId = decodeURIComponent(memberLogo[1]);
    const row = await env.DB.prepare("SELECT logo_r2_key FROM member_profiles WHERE platform_user_id = ?").bind(userId).first();
    if (!row?.logo_r2_key || !env.MEDIA) return new Response("Not found", { status: 404 });
    const object = await env.MEDIA.get(row.logo_r2_key);
    if (!object) return new Response("Not found", { status: 404 });
    return new Response(request.method === "HEAD" ? null : object.body, {
      headers: {
        "content-type": object.httpMetadata?.contentType || "image/webp",
        "cache-control": "public, max-age=300",
        "x-content-type-options": "nosniff",
      },
    });
  }
  const contactImage = url.pathname.match(/^\/v1\/card-collection\/([^/]+)\/image$/);
  if (["GET", "HEAD"].includes(request.method) && contactImage) {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    return serveContactImage(env.DB, env.MEDIA, request, member.userId, decodeURIComponent(contactImage[1]));
  }
  const sharedContactImage = url.pathname.match(/^\/v1\/card-collection\/shared\/([A-Fa-f0-9]{48})\/image$/);
  if (["GET", "HEAD"].includes(request.method) && sharedContactImage) {
    return serveSharedContactImage(env.DB,env.MEDIA,request,sharedContactImage[1]);
  }
  const sharedContact = url.pathname.match(/^\/v1\/card-collection\/shared\/([A-Fa-f0-9]{48})$/);
  if (request.method === "GET" && sharedContact) {
    const card=await getSharedContact(env.DB,sharedContact[1]);
    return card?json({success:true,card:{...card,imageUrl:card.hasImage?`/v1/card-collection/shared/${sharedContact[1]}/image`:''}}):json({success:false,error:'分享名片不存在或已停止分享'},404);
  }
  if (request.method === "GET" && url.pathname === "/api/health") {
    return json({
      success: true,
      service: "akaffit-team-member-crm",
      version: "20260722-mlm-ai-2",
      cardAiProvider: env.MLM_WORKER ? "mlm-service" : "local-fallback",
    });
  }

  if (request.method === "GET" && url.pathname === "/api/config") {
    return json({
      success: true,
      liffId: env.LIFF_ID || "",
      cardShareLiffId: env.CARD_SHARE_LIFF_ID || env.LIFF_ID || "",
      checkinLiffId: env.CHECKIN_LIFF_ID || "",
      buildVersion: "20260722-mlm-ai-2",
      cardAiProvider: env.MLM_WORKER ? "mlm-service" : "local-fallback",
      officialAccountUrl: "https://line.me/R/ti/p/@307bxlka",
    });
  }

  if (request.method === "POST" && url.pathname === "/v1/auth/line/verify") {
    if (!env.DB || !env.LINE_LOGIN_CHANNEL_ID || !env.SESSION_SIGNING_SECRET)
      return json({ success: false, error: "Service is not configured" }, 503);
    const body = await readJson(request);
    if (!body?.idToken && !body?.accessToken)
      return badRequest("LINE token is required");
    const lineProfile = (await verifyLineIdToken(
      body.idToken,
      env.LINE_LOGIN_CHANNEL_ID,
    )) || await verifyLineAccessToken(body.accessToken);
    if (!lineProfile)
      return json({ success: false, error: "Invalid LINE ID token" }, 401);
    const result = await resolveLineMember(env.DB, {
      ...lineProfile,
      picture: String(body.pictureUrl || lineProfile.picture || ""),
      name: String(body.displayName || lineProfile.name || ""),
    }, body.inviteToken);
    if (result.referralCreated) {
      result.member = await getMember(env.DB, result.member.userId) || result.member;
    }
    if (result.member.status !== "active")
      return json({ success: false, error: "Member is unavailable" }, 403);
    if (result.created) {
      await awardPoints(env.DB, {
        userId: result.member.userId,
        eventType: "member_joined",
        eventReference: result.member.userId,
        idempotencyKey: `member_joined:${result.member.userId}`,
      });
    }
    if (result.referralCreated && result.member.systemReferrer?.userId) {
      await awardPoints(env.DB, {
        userId: result.member.systemReferrer.userId,
        eventType: "share_referral",
        eventReference: result.member.userId,
        idempotencyKey: `share_referral:${result.member.userId}`,
        metadata: { referredUserId: result.member.userId },
      });
    }
    const sessionToken = await createSession(
      result.member.userId,
      env.SESSION_SIGNING_SECRET,
    );
    return json(
      { success: true, ...result, sessionToken, expiresIn: SESSION_MAX_AGE_SECONDS },
      result.created ? 201 : 200,
      { "set-cookie": sessionCookie(sessionToken) },
    );
  }

  if (request.method === "POST" && url.pathname === "/v1/auth/phone-birthday") {
    if (!env.DB || !env.SESSION_SIGNING_SECRET)
      return json({ success: false, error: "Service is not configured" }, 503);
    try {
      const body = (await readJson(request)) || {};
      const intent = ['login','register'].includes(body.intent) ? body.intent : 'auto';
      const result = await resolvePhoneBirthdayMember(env.DB, body.phone, body.birthday, body.inviteToken, intent);
      if (result.created) {
        await awardPoints(env.DB, {
          userId: result.member.userId,
          eventType: "member_joined",
          eventReference: result.member.userId,
          idempotencyKey: `member_joined:${result.member.userId}`,
        });

      }
      if (result.referralCreated && result.member.systemReferrer?.userId) {
        await awardPoints(env.DB, {
          userId: result.member.systemReferrer.userId,
          eventType: "share_referral",
          eventReference: result.member.userId,
          idempotencyKey: `share_referral:${result.member.userId}`,
          metadata: { referredUserId: result.member.userId },
        });
      }
      const sessionToken = await createSession(result.member.userId, env.SESSION_SIGNING_SECRET);
      return json(
        { success: true, ...result, sessionToken, expiresIn: SESSION_MAX_AGE_SECONDS },
        result.created ? 201 : 200,
        { "set-cookie": sessionCookie(sessionToken) },
      );
    } catch (error) {
      return badRequest(error.message || "手機生日註冊失敗");
    }
  }
  if (request.method === "POST" && url.pathname === "/v1/auth/logout") {
    return json(
      { success: true },
      200,
      { "set-cookie": sessionCookie("", 0) },
    );
  }
  if (request.method === "GET" && url.pathname === "/v1/me") {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    const adminAccess = await mergedAdminAccess(env,member);
    const refreshedSessionToken = await createSession(member.userId, env.SESSION_SIGNING_SECRET);
    return json(
      { success: true, member: { ...member, adminAccess } },
      200,
      { "set-cookie": sessionCookie(refreshedSessionToken) },
    );
  }

  if (request.method === "GET" && url.pathname === "/v1/session") {
    const member = await currentMember(request, env);
    if (!member) return json({ success: true, member: null });
    const adminAccess = await mergedAdminAccess(env, member);
    const refreshedSessionToken = await createSession(member.userId, env.SESSION_SIGNING_SECRET);
    return json(
      { success: true, member: { ...member, adminAccess } },
      200,
      { "set-cookie": sessionCookie(refreshedSessionToken) },
    );
  }

  if (request.method === "GET" && url.pathname === "/v1/destiny-analysis") {
    const member = await currentMember(request, env);
    if (!member) return json({ success:false, error:"Unauthorized" }, 401);
    let analysis = await getMemberCrmInsight(env.DB,member.userId);
    if (!analysis.status || analysis.status === "failed") {
      await queueMemberCrmInsight(env.DB,member.userId);
      scheduleMemberCrmInsights(env,ctx,member.userId);
      analysis = { ...analysis, status:"queued", error:"" };
    }
    return json({ success:true, analysis });
  }
  if (request.method === "GET" && url.pathname === "/v1/personality-assessments") {
    const member = await currentMember(request, env);
    if (!member) return json({ success:false, error:"Unauthorized" }, 401);
    try {
      const results = await listPersonalityAssessmentResults(env.DB, member.userId);
      return json({ success:true, assessments:publicPersonalityAssessments(), results });
    } catch (error) {
      return badRequest(error.message || "性格測驗讀取失敗");
    }
  }
  if (request.method === "POST" && url.pathname === "/v1/personality-assessments") {
    const member = await currentMember(request, env);
    if (!member) return json({ success:false, error:"Unauthorized" }, 401);
    try {
      const body = await request.json();
      const result = await savePersonalityAssessment(env.DB, member.userId, body?.type, body?.answers);
      await queueMemberCrmInsight(env.DB, member.userId);
      scheduleMemberCrmInsights(env, ctx, member.userId);
      return json({ success:true, result }, 201);
    } catch (error) {
      return badRequest(error.message || "性格測驗儲存失敗");
    }
  }
  if (request.method === "POST" && url.pathname === "/v1/me/logo") {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    if (!env.MEDIA) return json({ success: false, error: "Logo 儲存空間尚未設定" }, 503);
    try {
      const form = await request.formData();
      const file = form.get("logo");
      if (!(file instanceof File)) return badRequest("請選擇 Logo 圖片");
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return badRequest("Logo 僅支援 JPEG、PNG 或 WebP");
      if (file.size > 3 * 1024 * 1024) return badRequest("Logo 圖片不可超過 3MB");
      const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
      const key = `member-logos/${member.userId}/${crypto.randomUUID()}.${extension}`;
      await env.MEDIA.put(key, file.stream(), {
        httpMetadata: { contentType: file.type },
        customMetadata: { userId: member.userId },
      });
      const old = await env.DB.prepare("SELECT logo_r2_key FROM member_profiles WHERE platform_user_id = ?").bind(member.userId).first();
      const pictureUrl = `${url.origin}/v1/member-logo/${encodeURIComponent(member.userId)}`;
      await env.DB.prepare("UPDATE member_profiles SET logo_r2_key = ?, picture_url = ?, updated_at = CURRENT_TIMESTAMP WHERE platform_user_id = ?")
        .bind(key, pictureUrl, member.userId).run();
      if (old?.logo_r2_key && old.logo_r2_key !== key) {
        const cleanup = env.MEDIA.delete(old.logo_r2_key).catch((error) => console.error("Old member logo cleanup failed", error));
        if (ctx?.waitUntil) ctx.waitUntil(cleanup); else cleanup.catch(() => null);
      }
      return json({ success: true, member: await getMember(env.DB, member.userId) }, 201);
    } catch (error) {
      return badRequest(error.message || "Logo 上傳失敗");
    }
  }

  if (request.method === "GET" && url.pathname === "/v1/cards/me") {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    return json({ success: true, card: await getMyCard(env.DB, member.userId) });
  }

  if (["POST", "PUT"].includes(request.method) && url.pathname === "/v1/cards/me") {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    try {
      const card = await saveMyCard(env.DB, member.userId, (await readJson(request)) || {}, member);
      await queueMemberCrmInsight(env.DB,member.userId);
      scheduleMemberCrmInsights(env,ctx,member.userId);
      return json({ success: true, card }, card?.createdAt ? 200 : 201);
    } catch (error) {
      return badRequest(error.message || "Unable to save card");
    }
  }

  if (request.method === "POST" && url.pathname === "/v1/cards/me/imports") {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    try {
      const imported = await createImport(env.DB, env.MEDIA, member.userId, await request.formData(), { purpose:"personal" });
      return json({ success:true, import:imported }, 201);
    } catch (error) {
      return badRequest(error.message || "個人名片圖片上傳失敗");
    }
  }

  const confirmPersonalCardImport = url.pathname.match(/^\/v1\/cards\/me\/imports\/([^/]+)\/confirm$/);
  if (request.method === "POST" && confirmPersonalCardImport) {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    let mediaId = "";
    try {
      const eventId = decodeURIComponent(confirmPersonalCardImport[1]);
      const event = await env.DB.prepare("SELECT * FROM card_import_events WHERE id=? AND scanner_user_id=?")
        .bind(eventId, member.userId).first();
      if (!event || event.status !== "review_ready") throw new Error("名片辨識結果已失效，請重新掃描");
      const front = event.front_r2_key ? await env.MEDIA.get(event.front_r2_key) : null;
      if (!front) throw new Error("找不到名片正面圖片，請重新上傳");
      const input = (await readJson(request)) || {};
      const imported = input.card && typeof input.card === "object" ? input.card : input;
      const existing = await getMyCard(env.DB, member.userId);
      mediaId = newId("card_media");
      const imageBytes = await front.arrayBuffer();
      const contentType = front.httpMetadata?.contentType || event.front_content_type || "image/webp";
      await env.DB.prepare("INSERT INTO personal_card_media (id, platform_user_id, content_type, bytes) VALUES (?, ?, ?, ?)")
        .bind(mediaId, member.userId, contentType, imageBytes).run();
      const coverUrl = url.origin + "/v1/cards/media/" + mediaId;
      const versions = structuredClone(existing?.versions || {});
      versions.standard = {
        ...(versions.standard || {}),
        coverUrl,
        title: String(imported.displayName || existing?.displayName || member.displayName || "").trim(),
        description: String(imported.serviceDescription || existing?.serviceDescription || "").trim(),
      };
      const card = await saveMyCard(env.DB, member.userId, {
        ...imported,
        coverUrl,
        selectedVersion: "standard",
        versions,
        status: "published",
      }, member);
      const insightQueue = queueMemberCrmInsight(env.DB, member.userId)
        .then(() => scheduleMemberCrmInsights(env, ctx, member.userId))
        .catch((error) => console.error("Personal card CRM insight queue failed", error));
      if (ctx?.waitUntil) ctx.waitUntil(insightQueue);
      const cleanup = Promise.allSettled([
        ...[event.front_r2_key, event.back_r2_key].filter(Boolean).map((key) => env.MEDIA.delete(key)),
        env.DB.prepare("UPDATE card_import_events SET status='personal_created',front_r2_key='',back_r2_key='',updated_at=CURRENT_TIMESTAMP WHERE id=? AND scanner_user_id=?")
          .bind(eventId, member.userId).run(),
        env.DB.prepare("UPDATE card_import_fingerprints SET status='completed',updated_at=CURRENT_TIMESTAMP WHERE event_id=? AND user_id=?")
          .bind(eventId, member.userId).run(),
      ]).then((results) => {
        results.filter((result) => result.status === "rejected").forEach((result) => console.error("Personal card import cleanup failed", result.reason));
      });
      if (ctx?.waitUntil) ctx.waitUntil(cleanup); else cleanup.catch(() => null);
      return json({ success: true, card }, 201);
    } catch (error) {
      if (mediaId) await env.DB.prepare("DELETE FROM personal_card_media WHERE id=? AND platform_user_id=?").bind(mediaId, member.userId).run().catch(() => null);
      return badRequest(error.message || "建立個人名片失敗");
    }
  }

  if (url.pathname === "/v1/tasks" && request.method === "GET") {
    const member = await currentMember(request, env);
    if (!member) return json({ success:false, error:"Unauthorized" }, 401);
    try {
      const data=await listTasks(env.DB, member.userId, { status:url.searchParams.get("status") || "", limit:url.searchParams.get("limit") || 100 });
      const lineToken=env.LINE_CHANNEL_ACCESS_TOKEN || await getLineAccessToken(env.DB,env.SESSION_SIGNING_SECRET);
      return json({ success:true, ...data, pushCapabilities:{
        lineConfigured:Boolean(lineToken),
        telegramConfigured:Boolean(data.channel?.telegramBotConfigured || env.TELEGRAM_BOT_TOKEN),
      } });
    }
    catch (error) { return json({ success:false, error:error.message || "任務中心讀取失敗" }, 400); }
  }
  if (url.pathname === "/v1/tasks" && request.method === "POST") {
    const member = await currentMember(request, env);
    if (!member) return json({ success:false, error:"Unauthorized" }, 401);
    try {
      const task = await createTask(env.DB, member.userId, (await readJson(request)) || {});
      const notify = (async () => {
        const lineToken = env.LINE_CHANNEL_ACCESS_TOKEN || await getLineAccessToken(env.DB, env.SESSION_SIGNING_SECRET);
        return dispatchTaskPush(env.DB, env, task.id, lineToken);
      })();
      if (ctx?.waitUntil) ctx.waitUntil(notify); else notify.catch((error) => console.error("Task push failed", error));
      return json({ success:true, task }, 201);
    } catch (error) { return json({ success:false, error:error.message || "任務建立失敗" }, 400); }
  }
  if (url.pathname === "/v1/tasks/channels" && request.method === "PUT") {
    const member = await currentMember(request, env);
    if (!member) return json({ success:false, error:"Unauthorized" }, 401);
    try {
      return json({ success:true, channel:await saveTaskChannels(
        env.DB,
        member.userId,
        (await readJson(request)) || {},
        env.SESSION_SIGNING_SECRET,
      ) });
    }
    catch (error) { return json({ success:false, error:error.message || "推播設定儲存失敗" }, 400); }
  }
  if (url.pathname === "/v1/tasks/channels/discover" && request.method === "POST") {
    const member = await currentMember(request, env);
    if (!member) return json({ success:false, error:"Unauthorized" }, 401);
    try {
      const body=(await readJson(request)) || {};
      const token=normalizeTelegramBotToken(body.telegramBotToken)
        || await getTaskTelegramBotToken(env.DB,member.userId,env.SESSION_SIGNING_SECRET);
      return json({ success:true, ...(await discoverTelegramPrivateChat(token)) });
    } catch (error) {
      return json({ success:false, error:error.message || "Telegram Chat ID 取得失敗" }, 400);
    }
  }
  if (url.pathname === "/v1/tasks/channels/test" && request.method === "POST") {
    const member = await currentMember(request, env);
    if (!member) return json({ success:false, error:"Unauthorized" }, 401);
    try {
      const body=(await readJson(request)) || {};
      const token=normalizeTelegramBotToken(body.telegramBotToken)
        || await getTaskTelegramBotToken(env.DB,member.userId,env.SESSION_SIGNING_SECRET);
      return json({ success:true, ...(await sendTelegramTaskTest(token,body.telegramChatId)) });
    } catch (error) {
      return json({ success:false, error:error.message || "Telegram 測試失敗" }, 400);
    }
  }
  const taskActionMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)\/action$/);
  if (taskActionMatch && request.method === "PATCH") {
    const member = await currentMember(request, env);
    if (!member) return json({ success:false, error:"Unauthorized" }, 401);
    try {
      const result = await actOnTask(env.DB, member.userId, decodeURIComponent(taskActionMatch[1]), (await readJson(request)) || {});
      if (result.needsAiNext) {
        const next = generateNextTask(env.DB, env.MLM_WORKER, member.userId, result.task.id).catch((error) => console.error("Task Engine next-step generation failed", error));
        if (ctx?.waitUntil) ctx.waitUntil(next);
      }
      return json({ success:true, ...result });
    } catch (error) { return json({ success:false, error:error.message || "任務回報失敗" }, 400); }
  }
  const taskPushMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)\/push$/);
  if (taskPushMatch && request.method === "POST") {
    const member = await currentMember(request, env);
    if (!member) return json({ success:false, error:"Unauthorized" }, 401);
    try {
      const taskId = decodeURIComponent(taskPushMatch[1]);
      const owned = await env.DB.prepare("SELECT id FROM ai_tasks WHERE id=? AND platform_user_id=?").bind(taskId, member.userId).first();
      if (!owned) return json({ success:false, error:"找不到這筆任務" }, 404);
      const lineToken = env.LINE_CHANNEL_ACCESS_TOKEN || await getLineAccessToken(env.DB, env.SESSION_SIGNING_SECRET);
      return json({ success:true, deliveries:await dispatchTaskPush(env.DB, env, taskId, lineToken) });
    } catch (error) { return json({ success:false, error:error.message || "任務推播失敗" }, 400); }
  }
  if (url.pathname === "/v1/personal-calendar" && request.method === "GET") {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    const now = new Date();
    const from = url.searchParams.get("from") || new Date(now.getFullYear(), now.getMonth() - 6, 1).toISOString();
    const to = url.searchParams.get("to") || new Date(now.getFullYear(), now.getMonth() + 18, 1).toISOString();
    try {
      return json({ success: true, ...(await listPersonalCalendar(env.DB, member.userId, { from, to })) });
    } catch (error) {
      return json({ success: false, error: error.message || "個人行事曆讀取失敗" }, 400);
    }
  }

  if (url.pathname === "/v1/personal-calendar/voice" && request.method === "POST") {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 1_600_000) return json({ success: false, error: "語音檔案過大，請縮短後再試" }, 413);
    try {
      const now = new Date();
      const context = await listPersonalCalendar(env.DB, member.userId, {
        from: new Date(now.getTime() - 86_400_000).toISOString(),
        to: new Date(now.getTime() + 86_400_000).toISOString(),
      });
      const contentType = request.headers.get("content-type") || "";
      const result = contentType.includes("application/json")
        ? await parseCalendarVoice(env.MLM_WORKER, ((await readJson(request)) || {}).transcript, context, now)
        : await (async () => {
          const form = await request.formData();
          return buildCalendarVoiceProposal(
            env.MLM_WORKER,
            form.get("audio") || form.get("file"),
            form.get("durationMs"),
            context,
            now,
          );
        })();
      return json({ success: true, ...result });
    } catch (error) {
      return json({ success: false, error: error.message || "AI 語音行程建立失敗" }, 400);
    }
  }
  if (url.pathname === "/v1/personal-calendar/events" && request.method === "POST") {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    try { return json({ success: true, event: await savePersonalCalendarEvent(env.DB, member.userId, (await readJson(request)) || {}) }); }
    catch (error) { return json({ success: false, error: error.message || "行程儲存失敗" }, 400); }
  }
  const personalEventMatch = url.pathname.match(/^\/v1\/personal-calendar\/events\/([^/]+)$/);
  if (personalEventMatch && request.method === "PATCH") {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    try { return json({ success: true, event: await savePersonalCalendarEvent(env.DB, member.userId, (await readJson(request)) || {}, decodeURIComponent(personalEventMatch[1])) }); }
    catch (error) { return json({ success: false, error: error.message || "行程更新失敗" }, 400); }
  }
  if (personalEventMatch && request.method === "DELETE") {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    try { await deletePersonalCalendarEvent(env.DB, member.userId, decodeURIComponent(personalEventMatch[1])); return json({ success: true }); }
    catch (error) { return json({ success: false, error: error.message || "行程刪除失敗" }, 400); }
  }

  if (url.pathname === "/v1/personal-calendar/labels" && request.method === "POST") {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    try { return json({ success: true, label: await createCalendarLabel(env.DB, member.userId, (await readJson(request)) || {}) }); }
    catch (error) { return json({ success: false, error: error.message || "標籤建立失敗" }, 400); }
  }
  const personalLabelMatch = url.pathname.match(/^\/v1\/personal-calendar\/labels\/([^/]+)$/);
  if (personalLabelMatch && request.method === "PATCH") {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    try { return json({ success: true, label: await updateCalendarLabel(env.DB, member.userId, decodeURIComponent(personalLabelMatch[1]), (await readJson(request)) || {}) }); }
    catch (error) { return json({ success: false, error: error.message || "標籤更新失敗" }, 400); }
  }
  if (personalLabelMatch && request.method === "DELETE") {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    try { await deleteCalendarLabel(env.DB, member.userId, decodeURIComponent(personalLabelMatch[1])); return json({ success: true }); }
    catch (error) { return json({ success: false, error: error.message || "標籤刪除失敗" }, 400); }
  }

  if (request.method === "POST" && url.pathname === "/v1/admin/calendar/upload-image") {
    const admin = await currentAdmin(request, env);
    if (!admin) return json({ success: false, error: "Administrator access required" }, 403);
    try {
      const form = await request.formData();
      const file = form.get("image");
      if (!(file instanceof File)) return badRequest("請選擇活動圖片");
      if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) return badRequest("僅支援 JPEG、PNG、WebP 或 GIF");
      // 瀏覽器端會先壓縮；保留足夠上限避免把可處理的原始檔直接擋掉。
      if (file.size > 10 * 1024 * 1024) return badRequest("圖片超過 10MB，請改用較小圖片");
      const id = newId("calendar_media");
      await env.DB.prepare("INSERT INTO personal_card_media (id, platform_user_id, content_type, bytes) VALUES (?, ?, ?, ?)")
        .bind(id, admin.userId, file.type, await file.arrayBuffer()).run();
      return json({ success: true, url: `${url.origin}/v1/cards/media/${id}`, size: file.size }, 201);
    } catch (error) { return badRequest(error.message || "活動圖片上傳失敗"); }
  }

  if (request.method === "POST" && url.pathname === "/v1/cards/me/media") {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    try {
      const form = await request.formData();
      const file = form.get("image");
      if (!(file instanceof File)) return badRequest("請選擇圖片檔案");
      if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) return badRequest("僅支援 JPEG、PNG、WebP 或 GIF");
      const id = newId("card_media");
      await env.DB.prepare("INSERT INTO personal_card_media (id, platform_user_id, content_type, bytes) VALUES (?, ?, ?, ?)").bind(id, member.userId, file.type, await file.arrayBuffer()).run();
      return json({ success: true, url: `${url.origin}/v1/cards/media/${id}`, size: file.size }, 201);
    } catch (error) { return badRequest(error.message || "圖片上傳失敗"); }
  }

  const publicCardMatch = url.pathname.match(/^\/v1\/cards\/([^/]+)\/public$/);
  if (request.method === "GET" && publicCardMatch) {
    const card = await getPublicCard(env.DB, decodeURIComponent(publicCardMatch[1]));
    return card ? json({ success: true, card }) : json({ success: false, error: "名片不存在或尚未公開" }, 404);
  }

  const collectCardMatch = url.pathname.match(/^\/v1\/cards\/([^/]+)\/collect$/);
  if (request.method === "POST" && collectCardMatch) {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "請先登入後再收藏名片" }, 401);
    try {
      const result = await collectPublicCard(env.DB, member.userId, decodeURIComponent(collectCardMatch[1]));
      if(result.card?.aiInsights?.status !== 'ready') {
        await queueContactCrmInsights(env.DB,member.userId,result.card.id);
        scheduleContactCrmInsights(env,ctx,member.userId,result.card.id);
      }
      return json({ success: true, ...result }, result.duplicate ? 200 : 201);
    } catch (error) {
      return json({ success: false, error: error.message, code: error.code || "collect_failed" }, error.code === "self_card" ? 409 : 400);
    }
  }

  if (request.method === "GET" && url.pathname === "/v1/card-collection") {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    let memberRankingStatus=await getMemberCrmInsight(env.DB,member.userId);
    const memberInsightStale=['queued','processing'].includes(memberRankingStatus.status)
      && memberRankingStatus.updatedAt
      && Date.parse(memberRankingStatus.updatedAt)<Date.now()-(memberRankingStatus.status==='queued'?5:30)*60*1000;
    if(!memberRankingStatus.status || memberRankingStatus.status==='failed'){
      await queueMemberCrmInsight(env.DB,member.userId);
      scheduleMemberCrmInsights(env,ctx,member.userId);
      memberRankingStatus={...memberRankingStatus,status:'queued'};
    } else if(memberInsightStale){
      scheduleMemberCrmInsights(env,ctx,member.userId);
      memberRankingStatus={...memberRankingStatus,status:'queued'};
    }
    // 使用者開啟收藏頁時，立即救援因 Worker 重啟或 AI 逾時留下的舊工作。
    // OCR 與五大標籤各自重跑，不再互相阻塞。
    const recovery=await queueMemberStaleCardAnalysis(env.DB,member.userId,3).catch((error)=>{
      console.error("Card analysis recovery scan failed",error);
      return {imports:[],insights:[]};
    });
    for(const task of recovery.imports || [])scheduleCardImportPipeline(env,ctx,task.userId,task.eventId);
    for(const task of recovery.insights || [])scheduleContactCrmInsights(env,ctx,task.userId,task.id);
    const verificationRecovery=await queueMemberCardVerificationBackfill(env.DB,member.userId,1).catch((error)=>{
      console.error("Business-card verification recovery scan failed",error);
      return [];
    });
    for(const task of verificationRecovery)scheduleContactCardReverification(env,ctx,task.userId,task.id);
    const verifyingIds=new Set(verificationRecovery.map((task)=>task.id));
    const aiCrmRecovery=await queueMemberAiCardCrmBackfill(env.DB,member.userId,2).catch((error)=>{
      console.error("AI business-card CRM recovery scan failed",error);
      return [];
    });
    for(const task of aiCrmRecovery){if(!verifyingIds.has(task.id))scheduleContactAiCardCrm(env,ctx,task.userId,task.id);}
    // 舊版若已完成 OCR、卻在五大標籤階段中斷，補建該張名片唯一的贈點工作。
    const rewardRecovery=reconcileMemberCardCollectionRewards(env,member.userId).catch((error)=>{
      console.error("Card reward recovery failed",error);
      return {scanned:0,completed:0};
    });
    if(ctx?.waitUntil)ctx.waitUntil(rewardRecovery);else rewardRecovery.catch(()=>null);
    const rankingQueued=await queueMemberMatchRankingRefresh(env.DB,member.userId).catch((error)=>{
      console.error("Member match ranking queue failed",error);
      return 0;
    });
    if(rankingQueued)scheduleMemberMatchRanking(env,ctx,member.userId,true);
    return json({
      success:true,
      cards:await listContacts(env.DB,member.userId,url.searchParams.get("search") || "",url.searchParams.get("industry") || ""),
      industryOptions:INDUSTRY_OPTIONS,
      rankingStatus:memberRankingStatus.status,
      recovery:{imports:(recovery.imports || []).length,insights:(recovery.insights || []).length,verification:verificationRecovery.length,aiCrm:aiCrmRecovery.length,rankings:rankingQueued},
    });
  }

  const smartMatchHistoryRoute = url.pathname.match(/^\/v1\/card-collection\/([^/]+)\/matching-history$/);
  if (request.method === "GET" && smartMatchHistoryRoute) {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    try {
      const history = await listContactSmartMatchHistory(env.DB, member.userId, decodeURIComponent(smartMatchHistoryRoute[1]));
      return json({ success: true, history });
    } catch (error) {
      return badRequest(error.message || "智能配對紀錄讀取失敗");
    }
  }

  if (request.method === "POST" && url.pathname === "/v1/card-collection/match") {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    try {
      const body = (await readJson(request)) || {};
      const query = String(body.query || "").trim();
      if (!isSupportedMatchingQuery(query)) return badRequest(SMART_MATCH_SCOPE_MESSAGE);
      const contacts = await listContacts(env.DB, member.userId, "");
      const requestKey = await sha256(JSON.stringify({
        version: 3,
        query: query.replace(/\s+/g, " ").toLocaleLowerCase("zh-TW"),
        candidates: buildMatchingCandidates(contacts),
      }));
      const cached = await findCachedSmartMatch(env.DB, member.userId, requestKey, contacts);
      if (cached) return json({ success: true, ...cached, cached: true, numberScienceUsed: false, numberScienceReports: [] });
      const aiProvider = await resolveCardAiProvider(env);
      const matches = await matchContacts({ contacts, member, query, apiKey: aiProvider, model: env.OPENAI_CARD_MODEL });
      await saveSmartMatch(env.DB, { userId: member.userId, requestKey, query, matches, numberScienceUsed: false, numberScienceReports: [] });
      return json({ success: true, matches, cached: false, numberScienceUsed: false, numberScienceReports: [] });
    } catch (error) {
      return badRequest(error.message || "智能配對失敗");
    }
  }

  if (url.pathname === "/v1/smart-product/ask") {
    return json({ success: false, error: "康立商品內容已下架" }, 410);
  }

  if (request.method === "POST" && url.pathname === "/v1/card-collection/imports") {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    try {
      return json({ success: true, import: await createImport(env.DB, env.MEDIA, member.userId, await request.formData()) }, 201);
    } catch (error) { return badRequest(error.message || "名片圖片上傳失敗"); }
  }

  const submitBackgroundImport = url.pathname.match(/^\/v1\/card-collection\/imports\/([^/]+)\/submit$/);
  if (request.method === "POST" && submitBackgroundImport) {
    const member = await currentMember(request, env);
    if (!member) return json({ success:false, error:"Unauthorized" }, 401);
    try {
      const eventId=decodeURIComponent(submitBackgroundImport[1]);
      const aiProvider=await resolveCardAiProvider(env);
      const result=await submitImportInBackground(env.DB, env.MEDIA, member.userId, eventId, aiProvider, env.OPENAI_CARD_MODEL);
      if(!result.existing){
        scheduleCardImportPipeline(env,ctx,member.userId,eventId,aiProvider);
      }
      return json({success:true,...result,analysis:result.existing?"existing":"queued",reward:result.existing?{status:"duplicate",points:0}:{status:"pending_validation",points:10}},result.existing?200:202);
    } catch(error) { return badRequest(error.message || "名片送出失敗"); }
  }

  const recognizeCardImport = url.pathname.match(/^\/v1\/card-collection\/imports\/([^/]+)\/recognize$/);
  if (request.method === "POST" && recognizeCardImport) {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    try {
      const aiProvider = await resolveCardAiProvider(env);
      const result = await recognizeImport(env.DB, env.MEDIA, member.userId, decodeURIComponent(recognizeCardImport[1]), aiProvider, env.OPENAI_CARD_MODEL);
      return json({ success: true, ...result });
    } catch (error) { return badRequest(error.message || "名片辨識失敗"); }
  }

  const confirmCardImport = url.pathname.match(/^\/v1\/card-collection\/imports\/([^/]+)\/confirm$/);
  if (request.method === "POST" && confirmCardImport) {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    try {
      const result = await confirmImport(env.DB, env.MEDIA, member.userId, decodeURIComponent(confirmCardImport[1]), (await readJson(request)) || {});
      scheduleContactCrmInsights(env,ctx,member.userId,result.card.id);
      scheduleContactAiCardCrm(env,ctx,member.userId,result.card.id);
      const reward = result.updated
        ? {status:"duplicate",points:0}
        : await queueAndFulfillCardCollectionReward(env,member.userId,result.card.id);
      return json({ success: true, ...result, reward }, result.updated ? 200 : 201);
    } catch (error) {
      return json({ success: false, error: error.message || "名片儲存失敗", code: error.code || "save_failed", duplicate: error.duplicate || null }, error.code ? 409 : 400);
    }
  }

  const contactInsightRetryMatch = url.pathname.match(/^\/v1\/card-collection\/([^/]+)\/recalculate-insights$/);
  if (request.method === "POST" && contactInsightRetryMatch) {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    try {
      const cardId = decodeURIComponent(contactInsightRetryMatch[1]);
      const aiProvider = await resolveCardAiProvider(env);
      if (!aiProvider) return json({ success: false, error: "五大標籤分析服務尚未連線" }, 503);
      await queueContactCrmInsights(env.DB, member.userId, cardId, true);
      scheduleContactCrmInsights(env, ctx, member.userId, cardId);
      return json({ success: true, status: "queued" }, 202);
    } catch (error) {
      return badRequest(error.message || "五大標籤重新分析失敗");
    }
  }

  const contactAiCrmRetryMatch = url.pathname.match(/^\/v1\/card-collection\/([^/]+)\/recalculate-ai-crm$/);
  if (request.method === "POST" && contactAiCrmRetryMatch) {
    const member = await currentMember(request, env);
    if (!member) return json({ success:false, error:"Unauthorized" }, 401);
    try {
      const cardId=decodeURIComponent(contactAiCrmRetryMatch[1]);
      const verificationQueued=await queueContactCardReverification(env.DB,member.userId,cardId);
      if(verificationQueued)scheduleContactCardReverification(env,ctx,member.userId,cardId);
      else {
        const crmQueued=await queueContactAiCardCrm(env.DB,member.userId,cardId,true);
        if(!crmQueued)return badRequest("這張名片不是掃描建立，無法執行公司資料補全");
        scheduleContactAiCardCrm(env,ctx,member.userId,cardId);
      }
      return json({success:true,status:"queued",verification:verificationQueued},202);
    } catch(error) { return badRequest(error.message || "AI CRM 重新補全失敗"); }
  }
  const contactCardMatch = url.pathname.match(/^\/v1\/card-collection\/([^/]+)$/);
  const contactContentExpandMatch = url.pathname.match(/^\/v1\/card-collection\/([^/]+)\/content-suggestions$/);
  if (request.method === "POST" && contactContentExpandMatch) {
    const member = await currentMember(request, env);
    if (!member) return json({ success:false, error:"Unauthorized" }, 401);
    try {
      const aiProvider = await resolveCardAiProvider(env);
      const result = await expandContactContent(env.DB, member.userId, decodeURIComponent(contactContentExpandMatch[1]), aiProvider, env.OPENAI_CARD_MODEL);
      return json({ success:true, ...result });
    } catch (error) { return badRequest(error.message || "AI 擴寫失敗"); }
  }
  if (request.method === "PATCH" && contactCardMatch) {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    try {
      const id=decodeURIComponent(contactCardMatch[1]);
      const payload=(await readJson(request)) || {};
      const verification=await verifyContactCardData(env.DB,member.userId,id,payload,null,env.OPENAI_CARD_MODEL);
      const card=await updateContact(env.DB,member.userId,id,payload);
      const verificationQueued=await queueContactCardReverification(env.DB,member.userId,id);
      if(verificationQueued)scheduleContactCardReverification(env,ctx,member.userId,id);
      if(card.aiInsights?.status === 'queued' && !verificationQueued)scheduleContactCrmInsights(env,ctx,member.userId,card.id);
      if(card.aiCrm?.status === 'queued' && !verificationQueued)scheduleContactAiCardCrm(env,ctx,member.userId,card.id);
      return json({success:true,card,verification});
    }
    catch(error){return json({success:false,error:error.message || "收藏名片更新失敗",code:error.code || "",verificationErrors:error.verificationErrors || []},400);}
  }
  if (request.method === "DELETE" && contactCardMatch) {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    try { const result=await deleteContactAndReverseReward(env,member.userId,decodeURIComponent(contactCardMatch[1])); return json({ success:true,...result }); }
    catch (error) { return badRequest(error.message || "收藏名片刪除失敗"); }
  }
  const contactShareMatch = url.pathname.match(/^\/v1\/card-collection\/([^/]+)\/share$/);
  if (request.method === "POST" && contactShareMatch) {
    const member=await currentMember(request,env);if(!member)return json({success:false,error:'Unauthorized'},401);
    try{return json({success:true,share:await createContactShare(env.DB,member.userId,decodeURIComponent(contactShareMatch[1]),url.origin)},201)}catch(error){return badRequest(error.message||'名片分享連結建立失敗')}
  }
  if (request.method === "DELETE" && contactShareMatch) {
    const member=await currentMember(request,env);if(!member)return json({success:false,error:'Unauthorized'},401);
    try{return json({success:true,...await revokeContactShare(env.DB,member.userId,decodeURIComponent(contactShareMatch[1]))})}catch(error){return badRequest(error.message||'停止分享失敗')}
  }

  if (request.method === "POST" && url.pathname === "/v1/roster/member-number-lookup") {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    try {
      const body = (await readJson(request)) || {};
      const match = await lookupTdeaRosterMemberNumber(env.TDEA_WORKER, env.TDEA_DESIGN_LOOKUP_SECRET, body);
      return json({ success: true, match });
    } catch (error) {
      return badRequest(error.message || "會員編號查詢失敗");
    }
  }
  if (request.method === "PATCH" && url.pathname === "/v1/me") {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    try {
      const wasCompleted = Boolean(member.profileCompletedAt);
      const profile = (await readJson(request)) || {};
      const rosterVerification = await verifyTdeaRosterMember(env.TDEA_WORKER, env.TDEA_DESIGN_LOOKUP_SECRET, profile);
      const updated = await updateMemberProfile(
        env.DB,
        member.userId,
        profile,
        rosterVerification,
      );
      await queueMemberCrmInsight(env.DB,member.userId);
      scheduleMemberCrmInsights(env,ctx,member.userId);
      if (!wasCompleted) {
        await awardPoints(env.DB, {
          userId: member.userId,
          eventType: "registration_completed",
          eventReference: member.userId,
          idempotencyKey: `registration_completed:${member.userId}`,
        });
      }
      return json({ success: true, member: updated });
    } catch (error) {
      return badRequest(error.message || "Unable to save profile");
    }
  }

  if (request.method === "GET" && url.pathname === "/v1/points/wallet") {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    const [wallet, referralResult] = await Promise.all([
      getWallet(env.DB, member.userId),
      env.DB.prepare(
        `SELECT mp.display_name, mp.member_number, rr.created_at
         FROM referral_relationships rr
         LEFT JOIN member_profiles mp ON mp.platform_user_id = rr.referred_user_id
         WHERE rr.referrer_user_id = ? AND rr.status = 'active'
         ORDER BY rr.created_at DESC
         LIMIT 100`,
      )
        .bind(member.userId)
        .all(),
    ]);
    return json({
      success: true,
      wallet,
      referrals: referralResult.results || [],
    });
  }

  if (url.pathname === "/v1/number-science/reports") {
    return json({ success: false, error: "數字科學內容已下架" }, 410);
  }

  if (request.method === "POST" && url.pathname === "/v1/points/mlm-balance") {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    const body = (await readJson(request)) || {};
    const idToken = String(body.idToken || "").trim();
    const accessToken = String(body.accessToken || "").trim();
    if (!idToken && !accessToken) return badRequest("LINE credential is required");
    try {
      const endpoint = String(env.MLM_MEMBER_POINTS_URL || "https://mlm.fangwl591021.workers.dev/api/ai-wear/member-points");
      const requestOptions = {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          idToken,
          accessToken,
          displayName: member.displayName || "",
          pictureUrl: member.pictureUrl || "",
          aiWearPointChannelKey: "oa1",
        }),
      };
      // Cloudflare may return 404 when one workers.dev Worker fetches another
      // Worker in the same account. A Service Binding is the supported internal
      // transport and also avoids a public network round trip.
      const response = env.MLM_WORKER && typeof env.MLM_WORKER.fetch === "function"
        ? await env.MLM_WORKER.fetch("https://mlm.internal/api/ai-wear/member-points", requestOptions)
        : await fetch(endpoint, requestOptions);
      const responseText = await response.text();
      let payload = {};
      try { payload = responseText ? JSON.parse(responseText) : {}; } catch { payload = {}; }
      const balance = Number(payload.data?.balance);
      if (!response.ok || payload.status !== "success" || !Number.isFinite(balance)) {
        const contentType = response.headers.get("content-type") || "unknown";
        const upstreamMessage = String(payload.message || payload.error || "").trim();
        const responseKind = responseText && !Object.keys(payload).length ? "non-json" : "json";
        const diagnostic = `MLM HTTP ${response.status} / ${responseKind} / ${contentType}`;
        console.error("MLM point upstream response invalid", {
          status: response.status,
          contentType,
          responseKind,
          payloadStatus: payload.status || "",
          hasData: Boolean(payload.data),
          dataKeys: payload.data && typeof payload.data === "object" ? Object.keys(payload.data) : [],
        });
        return json({ success: false, error: upstreamMessage ? `${upstreamMessage}（${diagnostic}）` : `康立智能 K點讀取失敗（${diagnostic}）` }, response.status === 401 ? 401 : 502);
      }
      return json({
        success: true,
        balance,
        entries: Array.isArray(payload.data?.items) ? payload.data.items : [],
        ledgerSource: payload.data?.ledgerSource || "mlm-mother-site",
        pointChannelKey: payload.data?.pointChannelKey || "oa1",
      });
    } catch (error) {
      console.error("MLM point proxy failed", error);
      return json({ success: false, error: "康立智能 K點服務暫時無法連線" }, 502);
    }
  }

  if (request.method === "POST" && url.pathname === "/v1/points/wallet/qr") {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    const body = (await readJson(request)) || {};
    try {
      const walletToken = await issueWalletToken(
        env.DB,
        member.userId,
        body.purpose || "member_identification",
      );
      return json(
        {
          success: true,
          ...walletToken,
          qrPayload: `${url.origin}/w/${walletToken.token}`,
        },
        201,
      );
    } catch (error) {
      return badRequest(error.message || "Unable to issue wallet QR");
    }
  }

  if (
    request.method === "POST" &&
    url.pathname === "/v1/wallet-scans/resolve"
  ) {
    const scannerKey = request.headers.get("x-wallet-scanner-key") || "";
    if (
      !env.WALLET_SCANNER_API_KEY ||
      scannerKey !== env.WALLET_SCANNER_API_KEY
    )
      return json({ success: false, error: "Unauthorized scanner" }, 401);
    const body = (await readJson(request)) || {};
    const result = await resolveWalletToken(
      env.DB,
      body.token,
      body.scannerLabel || "",
    );
    return result.ok
      ? json({ success: true, ...result })
      : json({ success: false, error: result.reason }, 400);
  }

  if (url.pathname.startsWith("/v1/admin/")) {
    const admin = await currentAdmin(request, env);
    if (!admin)
      return json(
        { success: false, error: "Administrator access required" },
        403,
      );
    if (url.pathname.startsWith("/v1/admin/point-rules") && !admin.adminAccess.canManagePoints) {
      return json({ success: false, error: "Point management permission required" }, 403);
    }
    if (url.pathname.startsWith("/v1/admin/rich-menu") && !admin.adminAccess.canManageRichMenu) {
      return json({ success: false, error: "圖文選單管理權限不足" }, 403);
    }
    if (url.pathname.startsWith("/v1/admin/openai-settings") && !admin.adminAccess.systemAccess) {
      return json({ success: false, error: "只有系統權限管理員可設定 API 金鑰" }, 403);
    }
    if (request.method === "GET" && url.pathname === "/v1/admin/blog/posts") {
      return json({ success: true, ...(await listAdminBlogPosts(env.DB)) });
    }
    if (request.method === "POST" && url.pathname === "/v1/admin/blog/posts") {
      try {
        const post = await createBlogPost(env.DB, admin.userId, (await readJson(request)) || {});
        return json({ success: true, post }, 201);
      } catch (error) {
        return badRequest(String(error?.message || "").includes("UNIQUE") ? "文章網址代稱已被使用" : error.message || "文章建立失敗");
      }
    }
    const adminBlogMatch = url.pathname.match(/^\/v1\/admin\/blog\/posts\/([^/]+)$/);
    if (request.method === "PATCH" && adminBlogMatch) {
      try {
        const post = await updateBlogPost(env.DB, decodeURIComponent(adminBlogMatch[1]), (await readJson(request)) || {});
        return json({ success: true, post });
      } catch (error) {
        return badRequest(String(error?.message || "").includes("UNIQUE") ? "文章網址代稱已被使用" : error.message || "文章更新失敗");
      }
    }
    if (request.method === "DELETE" && adminBlogMatch) {
      try {
        return json(await deleteBlogPost(env.DB, decodeURIComponent(adminBlogMatch[1])));
      } catch (error) {
        return badRequest(error.message || "文章刪除失敗");
      }
    }
    if (request.method === "GET" && url.pathname === "/v1/admin/openai-settings") {
      return json({ success:true, ...(await getOpenAIKeyStatus(env.DB, env.OPENAI_API_KEY)) });
    }
    if (request.method === "PUT" && url.pathname === "/v1/admin/openai-settings") {
      try {
        const result = await saveOpenAIKey(env.DB, env.SESSION_SIGNING_SECRET, admin.userId, ((await readJson(request)) || {}).apiKey);
        await env.DB.prepare("INSERT INTO audit_logs (id,actor_user_id,subject_user_id,action,metadata_json) VALUES (?,?,?,'admin.openai_key.updated','{}')").bind(newId('audit'),admin.userId,admin.userId).run();
        return json({ success:true, ...result });
      } catch(error) { return badRequest(error.message || "OpenAI API 金鑰儲存失敗"); }
    }
    if (request.method === "POST" && url.pathname === "/v1/admin/openai-settings/test") {
      try { return json({ success:true, ...(await testOpenAIKey(env.DB, env.SESSION_SIGNING_SECRET, env.OPENAI_API_KEY)) }); }
      catch(error) { return badRequest(error.message || "OpenAI 連線測試失敗"); }
    }
    if (request.method === "DELETE" && url.pathname === "/v1/admin/openai-settings") {
      await deleteOpenAIKey(env.DB);
      await env.DB.prepare("INSERT INTO audit_logs (id,actor_user_id,subject_user_id,action,metadata_json) VALUES (?,?,?,'admin.openai_key.deleted','{}')").bind(newId('audit'),admin.userId,admin.userId).run();
      return json({ success:true, ...(await getOpenAIKeyStatus(env.DB, env.OPENAI_API_KEY)) });
    }
    if (request.method === "GET" && url.pathname === "/v1/admin/media-assets") {
      try {
        return json({ success: true, assets: await listMediaAssets(env.DB, env.MEDIA, url.origin) });
      } catch (error) { return badRequest(error.message || "影片庫載入失敗"); }
    }
    if (request.method === "PUT" && url.pathname === "/v1/admin/media-assets/video") {
      try {
        return json({ success: true, asset: await uploadVideoAsset(env.DB, env.MEDIA, admin.userId, request, url.origin) }, 201);
      } catch (error) { return badRequest(error.message || "影片上傳失敗"); }
    }
    const mediaPosterMatch = url.pathname.match(/^\/v1\/admin\/media-assets\/([^/]+)\/poster$/);
    if (request.method === "PUT" && mediaPosterMatch) {
      try {
        return json({ success: true, asset: await uploadVideoPoster(env.DB, env.MEDIA, decodeURIComponent(mediaPosterMatch[1]), request, url.origin) });
      } catch (error) { return badRequest(error.message || "影片封面上傳失敗"); }
    }
    const mediaDeleteMatch = url.pathname.match(/^\/v1\/admin\/media-assets\/([^/]+)$/);
    if (request.method === "DELETE" && mediaDeleteMatch) {
      try {
        return json(await deleteMediaAsset(env.DB, env.MEDIA, decodeURIComponent(mediaDeleteMatch[1])));
      } catch (error) { return badRequest(error.message || "影片刪除失敗"); }
    }
    if (request.method === "GET" && url.pathname === "/v1/admin/rich-menu/token") {
      return json({ success: true, ...(await getLineTokenStatus(env.DB)) });
    }
    if (request.method === "PUT" && url.pathname === "/v1/admin/rich-menu/token") {
      const body = (await readJson(request)) || {};
      try {
        const result = await saveLineToken(env.DB, env.SESSION_SIGNING_SECRET, admin.userId, body.token);
        await env.DB.prepare("INSERT INTO audit_logs (id, actor_user_id, subject_user_id, action, metadata_json) VALUES (?, ?, ?, 'admin.line_token.updated', ?)")
          .bind(newId("audit"), admin.userId, admin.userId, JSON.stringify({ bot: result.bot?.basicId || "" })).run();
        return json({ success: true, ...result });
      } catch (error) {
        return badRequest(error.message || "LINE Token 儲存失敗");
      }
    }
    if (request.method === "POST" && url.pathname === "/v1/admin/rich-menu/token/test") {
      try {
        return json({ success: true, bot: await testSavedLineToken(env.DB, env.SESSION_SIGNING_SECRET) });
      } catch (error) {
        return badRequest(error.message || "LINE Token 驗證失敗");
      }
    }
    if (request.method === "POST" && url.pathname === "/v1/admin/rich-menu/action") {
      const body = (await readJson(request)) || {};
      try {
        const data = await handleRichMenuAction(env.DB, env.SESSION_SIGNING_SECRET, admin.userId, body.action, body.payload || {});
        if (body.action === "DEPLOY_RICH_MENU") {
          await env.DB.prepare("INSERT INTO audit_logs (id, actor_user_id, subject_user_id, action, metadata_json) VALUES (?, ?, ?, 'admin.rich_menu.deployed', ?)")
            .bind(newId("audit"), admin.userId, admin.userId, JSON.stringify({ richMenuId: data.richMenuId || "" })).run();
        }
        return json({ status: "success", data });
      } catch (error) {
        return json({ status: "error", message: error.message || "圖文選單操作失敗" }, 400);
      }
    }
    if (request.method === "GET" && url.pathname === "/v1/admin/overview") {
      const [members, courses, campaigns, points, checkins] =
        await env.DB.batch([
          env.DB.prepare(
            "SELECT COUNT(*) AS count FROM platform_users WHERE status = 'active'",
          ),
          env.DB.prepare(
            "SELECT COUNT(*) AS count FROM courses WHERE status = 'published'",
          ),
          env.DB.prepare(
            "SELECT COUNT(*) AS count FROM ad_campaigns WHERE status = 'active'",
          ),
          env.DB.prepare(
            "SELECT COALESCE(SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END), 0) AS count FROM point_ledger_entries",
          ),
          env.DB.prepare(
            "SELECT COUNT(*) AS count FROM daily_checkins WHERE status = 'verified'",
          ),
        ]);
      return json({
        success: true,
        access: admin.adminAccess,
        overview: {
          members: Number(members.results[0].count),
          publishedCourses: Number(courses.results[0].count),
          activeCampaigns: Number(campaigns.results[0].count),
          issuedPoints: Number(points.results[0].count),
          verifiedCheckins: Number(checkins.results[0].count),
        },
      });
    }
    if (request.method === "GET" && url.pathname === "/v1/admin/cards") {
      const rows=await env.DB.prepare(`
        SELECT * FROM (
          SELECT cc.id,'collection' AS card_kind,cc.source_type,cc.scanner_user_id AS owner_user_id,
            COALESCE(owner.display_name,'') AS owner_name,COALESCE(owner.member_number,'') AS owner_member_number,
            cc.display_name,cc.english_name,cc.company_name,cc.job_title,cc.department,cc.mobile,cc.company_phone,
            cc.email,cc.website_url,cc.line_url,cc.address,cc.service_description,cc.note,COALESCE(cc.bound_user_id,'') AS bound_user_id,
            cc.status,cc.created_at,cc.updated_at,
            COALESCE(json_extract(cc.versions_json,'$._crmInsights.status'),'') AS insight_status,
            COALESCE(json_extract(cc.versions_json,'$._crmInsights.error'),'') AS insight_error,
            COALESCE(json_extract(cc.versions_json,'$._crmInsights.cards.personality'),'') AS insight_personality,
            COALESCE(json_extract(cc.versions_json,'$._crmInsights.cards.interests'),'') AS insight_interests,
            COALESCE(json_extract(cc.versions_json,'$._crmInsights.cards.wealth'),'') AS insight_wealth,
            COALESCE(json_extract(cc.versions_json,'$._crmInsights.cards.health'),'') AS insight_health,
            COALESCE(json_extract(cc.versions_json,'$._crmInsights.cards.career'),'') AS insight_career
          FROM contact_cards cc
          LEFT JOIN member_profiles owner ON owner.platform_user_id=cc.scanner_user_id
          WHERE cc.status='active'
          UNION ALL
          SELECT pc.id,'personal' AS card_kind,'personal_card' AS source_type,pc.platform_user_id AS owner_user_id,
            COALESCE(owner.display_name,'') AS owner_name,COALESCE(owner.member_number,'') AS owner_member_number,
            pc.display_name,pc.english_name,pc.company_name,pc.job_title,pc.department,pc.mobile,pc.company_phone,
            pc.email,pc.website_url,pc.line_url,pc.address,pc.service_description,'' AS note,pc.platform_user_id AS bound_user_id,
            pc.status,pc.created_at,pc.updated_at,COALESCE(mci.status,'') AS insight_status,COALESCE(mci.last_error,'') AS insight_error,
            COALESCE(json_extract(mci.insights_json,'$.personality'),'') AS insight_personality,
            COALESCE(json_extract(mci.insights_json,'$.interests'),'') AS insight_interests,
            COALESCE(json_extract(mci.insights_json,'$.wealth'),'') AS insight_wealth,
            COALESCE(json_extract(mci.insights_json,'$.health'),'') AS insight_health,
            COALESCE(json_extract(mci.insights_json,'$.career'),'') AS insight_career
          FROM personal_cards pc
          LEFT JOIN member_profiles owner ON owner.platform_user_id=pc.platform_user_id
          LEFT JOIN member_crm_insights mci ON mci.platform_user_id=pc.platform_user_id
          WHERE pc.status!='archived'
        ) ORDER BY updated_at DESC LIMIT 1000
      `).all();
      return json({success:true,cards:rows.results||[]});
    }
    const adminCardInsightRetryMatch=url.pathname.match(/^\/v1\/admin\/cards\/(personal|collection)\/([^/]+)\/recalculate-insights$/);
    if(request.method==="POST"&&adminCardInsightRetryMatch){
      const kind=adminCardInsightRetryMatch[1],cardId=decodeURIComponent(adminCardInsightRetryMatch[2]);
      if(kind==="collection"){
        const existing=await env.DB.prepare("SELECT scanner_user_id FROM contact_cards WHERE id=? AND status='active'").bind(cardId).first();
        if(!existing)return json({success:false,error:"找不到收藏名片"},404);
        const aiProvider=await resolveCardAiProvider(env);
        if(!aiProvider)return json({success:false,error:"MLM AI 服務尚未連線"},503);
        await queueContactCrmInsights(env.DB,existing.scanner_user_id,cardId,true);
        scheduleContactCrmInsights(env,ctx,existing.scanner_user_id,cardId);
        await env.DB.prepare("INSERT INTO audit_logs (id,actor_user_id,subject_user_id,action,metadata_json) VALUES (?,?,?,'admin.card.insights_recalculated',?)").bind(newId("audit"),admin.userId,existing.scanner_user_id,JSON.stringify({cardId,kind})).run();
      }else{
        const existing=await env.DB.prepare("SELECT platform_user_id FROM personal_cards WHERE id=? AND status!='archived'").bind(cardId).first();
        if(!existing)return json({success:false,error:"找不到會員名片"},404);
        const aiProvider=await resolveCardAiProvider(env);
        if(!aiProvider)return json({success:false,error:"MLM AI 服務尚未連線"},503);
        await queueMemberCrmInsight(env.DB,existing.platform_user_id);
        scheduleMemberCrmInsights(env,ctx,existing.platform_user_id);
        await env.DB.prepare("INSERT INTO audit_logs (id,actor_user_id,subject_user_id,action,metadata_json) VALUES (?,?,?,'admin.card.insights_recalculated',?)").bind(newId("audit"),admin.userId,existing.platform_user_id,JSON.stringify({cardId,kind})).run();
      }
      return json({success:true,status:"queued"});
    }
    const adminCardMatch=url.pathname.match(/^\/v1\/admin\/cards\/(personal|collection)\/([^/]+)$/);
    if(request.method==="PATCH"&&adminCardMatch){
      const kind=adminCardMatch[1],cardId=decodeURIComponent(adminCardMatch[2]),body=(await readJson(request))||{};
      const limits={displayName:120,englishName:120,companyName:180,jobTitle:120,department:120,mobile:40,companyPhone:40,email:320,websiteUrl:2048,lineUrl:2048,address:300,serviceDescription:1600,note:1000};
      const value=(key)=>String(body[key]||"").trim().slice(0,limits[key]);
      const card={displayName:value("displayName"),englishName:value("englishName"),companyName:value("companyName"),jobTitle:value("jobTitle"),department:value("department"),mobile:value("mobile"),companyPhone:value("companyPhone"),email:value("email"),websiteUrl:value("websiteUrl"),lineUrl:value("lineUrl"),address:value("address"),serviceDescription:value("serviceDescription"),note:value("note")};
      if(!card.displayName)return badRequest("名片姓名不可空白");
      for(const [key,label] of [["websiteUrl","網站"],["lineUrl","LINE 連結"]])if(card[key]&&!/^https?:\/\//i.test(card[key]))return badRequest(`${label}必須以 http:// 或 https:// 開頭`);
      if(kind==="collection"){
        const existing=await env.DB.prepare("SELECT scanner_user_id FROM contact_cards WHERE id=? AND status='active'").bind(cardId).first();
        if(!existing)return json({success:false,error:"找不到收藏名片"},404);
        await env.DB.batch([
          env.DB.prepare(`UPDATE contact_cards SET display_name=?,english_name=?,company_name=?,job_title=?,department=?,mobile=?,company_phone=?,email=?,website_url=?,line_url=?,address=?,service_description=?,note=?,normalized_mobile=?,normalized_email=?,normalized_name_company=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='active'`).bind(card.displayName,card.englishName,card.companyName,card.jobTitle,card.department,card.mobile,card.companyPhone,card.email,card.websiteUrl,card.lineUrl,card.address,card.serviceDescription,card.note,normalizePhone(card.mobile),normalizeEmail(card.email),normalizeNameCompany(card.displayName,card.companyName),cardId),
          env.DB.prepare("INSERT INTO audit_logs (id,actor_user_id,subject_user_id,action,metadata_json) VALUES (?,?,?,'admin.card.updated',?)").bind(newId("audit"),admin.userId,existing.scanner_user_id,JSON.stringify({cardId,kind})),
        ]);
        await queueContactCrmInsights(env.DB,existing.scanner_user_id,cardId,true);
        scheduleContactCrmInsights(env,ctx,existing.scanner_user_id,cardId);
      }else{
        const existing=await env.DB.prepare("SELECT platform_user_id FROM personal_cards WHERE id=? AND status!='archived'").bind(cardId).first();
        if(!existing)return json({success:false,error:"找不到會員名片"},404);
        await env.DB.batch([
          env.DB.prepare(`UPDATE personal_cards SET display_name=?,english_name=?,company_name=?,job_title=?,department=?,mobile=?,company_phone=?,email=?,website_url=?,line_url=?,address=?,service_description=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status!='archived'`).bind(card.displayName,card.englishName,card.companyName,card.jobTitle,card.department,card.mobile,card.companyPhone,card.email,card.websiteUrl,card.lineUrl,card.address,card.serviceDescription,cardId),
          env.DB.prepare("INSERT INTO audit_logs (id,actor_user_id,subject_user_id,action,metadata_json) VALUES (?,?,?,'admin.card.updated',?)").bind(newId("audit"),admin.userId,existing.platform_user_id,JSON.stringify({cardId,kind})),
        ]);
        await queueMemberCrmInsight(env.DB,existing.platform_user_id);
        scheduleMemberCrmInsights(env,ctx,existing.platform_user_id);
      }
      return json({success:true});
    }
    if(request.method==="DELETE"&&adminCardMatch){
      const kind=adminCardMatch[1],cardId=decodeURIComponent(adminCardMatch[2]);
      if(kind==="collection"){
        const existing=await env.DB.prepare("SELECT scanner_user_id FROM contact_cards WHERE id=? AND status='active'").bind(cardId).first();
        if(!existing)return json({success:false,error:"找不到收藏名片"},404);
        await deleteContact(env.DB,env.MEDIA,existing.scanner_user_id,cardId);
        await env.DB.prepare("INSERT INTO audit_logs (id,actor_user_id,subject_user_id,action,metadata_json) VALUES (?,?,?,'admin.card.deleted',?)").bind(newId("audit"),admin.userId,existing.scanner_user_id,JSON.stringify({cardId,kind})).run();
      }else{
        const existing=await env.DB.prepare("SELECT platform_user_id FROM personal_cards WHERE id=? AND status!='archived'").bind(cardId).first();
        if(!existing)return json({success:false,error:"找不到會員名片"},404);
        await env.DB.batch([
          env.DB.prepare("UPDATE personal_cards SET status='archived',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status!='archived'").bind(cardId),
          env.DB.prepare("INSERT INTO audit_logs (id,actor_user_id,subject_user_id,action,metadata_json) VALUES (?,?,?,'admin.card.deleted',?)").bind(newId("audit"),admin.userId,existing.platform_user_id,JSON.stringify({cardId,kind})),
        ]);
      }
      return json({success:true});
    }
    if (request.method === "GET" && url.pathname === "/v1/admin/members") {
      const rows = await env.DB.prepare(`
        SELECT pu.id, pu.status, pu.created_at, mp.display_name, mp.picture_url, mp.phone, mp.email,
          mp.full_name, mp.gender, mp.member_number, mp.company_member_number, mp.member_type, mp.roster_member_number, mp.roster_verified_name, mp.roster_verified_at, mp.roster_source, mp.industry, mp.birthday, mp.address, mp.admin_note, mp.profile_completed_at, COALESCE(pa.balance, 0) AS points_balance,
          rr.referrer_user_id, ref_mp.display_name AS referrer_name, ref_mp.member_number AS referrer_member_number,
          COALESCE(amp.system_access, 0) AS system_access, COALESCE(amp.operator_access, 0) AS operator_access
        FROM platform_users pu
        LEFT JOIN member_profiles mp ON mp.platform_user_id = pu.id
        LEFT JOIN point_accounts pa ON pa.platform_user_id = pu.id AND pa.program_id = 'program_main'
        LEFT JOIN referral_relationships rr ON rr.referred_user_id = pu.id AND rr.status = 'active'
        LEFT JOIN member_profiles ref_mp ON ref_mp.platform_user_id = rr.referrer_user_id
        LEFT JOIN admin_member_permissions amp ON amp.platform_user_id = pu.id
        WHERE pu.status != 'deleted'
          AND NOT EXISTS (
            SELECT 1 FROM member_account_aliases maa
            WHERE maa.alias_user_id = pu.id
          )
        ORDER BY pu.created_at DESC
        LIMIT 500
      `).all();
      return json({ success: true, members: rows.results || [] });
    }
    const memberRosterVerifyMatch = url.pathname.match(/^\/v1\/admin\/members\/([^/]+)\/verify-roster$/);
    if (request.method === "POST" && memberRosterVerifyMatch) {
      const memberId = decodeURIComponent(memberRosterVerifyMatch[1]);
      const profile = await env.DB.prepare(`
        SELECT mp.full_name, mp.phone, mp.birthday, mp.member_type, mp.roster_member_number
        FROM member_profiles mp
        JOIN platform_users pu ON pu.id = mp.platform_user_id AND pu.status = 'active'
        WHERE mp.platform_user_id = ?
      `).bind(memberId).first();
      if (!profile) return json({ success: false, error: "Member not found" }, 404);

      try {
        const verified = await verifyTdeaRosterMember(env.TDEA_WORKER, env.TDEA_DESIGN_LOOKUP_SECRET, {
          memberType: profile.member_type,
          memberNumber: profile.roster_member_number,
          fullName: profile.full_name,
          phone: profile.phone,
          birthday: profile.birthday,
        });
        await env.DB.batch([
          env.DB.prepare("UPDATE member_profiles SET roster_member_number = ?, roster_verified_name = ?, roster_verified_at = CURRENT_TIMESTAMP, roster_source = ?, updated_at = CURRENT_TIMESTAMP WHERE platform_user_id = ?")
            .bind(verified.memberNumber, verified.rosterName, verified.source, memberId),
          env.DB.prepare("INSERT INTO audit_logs (id, actor_user_id, subject_user_id, action, metadata_json) VALUES (?, ?, ?, 'admin.member.roster_verified', ?)")
            .bind(newId("audit"), admin.userId, memberId, JSON.stringify({ memberType: verified.memberType, memberNumber: verified.memberNumber, source: verified.source })),
        ]);
        return json({ success: true, binding: { ...verified, verifiedAt: new Date().toISOString() } });
      } catch (error) {
        return badRequest(error.message || "會員名冊核對失敗");
      }
    }
    const memberDetailMatch = url.pathname.match(/^\/v1\/admin\/members\/([^/]+)$/);
    if (request.method === "GET" && memberDetailMatch) {
      const memberId = memberDetailMatch[1];
      const member = await env.DB.prepare(`
        SELECT pu.id, pu.status, pu.created_at, mp.display_name, mp.picture_url, mp.phone, mp.email,
          mp.full_name, mp.gender, mp.member_number, mp.company_member_number, mp.member_type, mp.roster_member_number, mp.roster_verified_name, mp.roster_verified_at, mp.roster_source, mp.industry, mp.birthday, mp.address, mp.admin_note, mp.profile_completed_at, COALESCE(pa.balance, 0) AS points_balance,
          rr.referrer_user_id, ref_mp.display_name AS referrer_name, ref_mp.member_number AS referrer_member_number,
          COALESCE(amp.system_access, 0) AS system_access, COALESCE(amp.operator_access, 0) AS operator_access
        FROM platform_users pu
        LEFT JOIN member_profiles mp ON mp.platform_user_id = pu.id
        LEFT JOIN point_accounts pa ON pa.platform_user_id = pu.id AND pa.program_id = 'program_main'
        LEFT JOIN referral_relationships rr ON rr.referred_user_id = pu.id AND rr.status = 'active'
        LEFT JOIN member_profiles ref_mp ON ref_mp.platform_user_id = rr.referrer_user_id
        LEFT JOIN admin_member_permissions amp ON amp.platform_user_id = pu.id
        WHERE pu.id = ? AND pu.status != 'deleted'
      `).bind(memberId).first();
      if (!member) return json({ success: false, error: "Member not found" }, 404);
      const [ledger, courses, checkins, referrals] = await env.DB.batch([
        env.DB.prepare("SELECT event_type, event_reference, delta, balance_after, created_at FROM point_ledger_entries WHERE platform_user_id = ? ORDER BY created_at DESC LIMIT 50").bind(memberId),
        env.DB.prepare("SELECT cr.status, cr.source, cr.registered_at, cs.title, cs.starts_at FROM course_registrations cr JOIN course_sessions cs ON cs.id = cr.course_session_id WHERE cr.platform_user_id = ? ORDER BY cr.registered_at DESC LIMIT 30").bind(memberId),
        env.DB.prepare("SELECT business_date, checked_in_at, status FROM daily_checkins WHERE platform_user_id = ? ORDER BY business_date DESC LIMIT 30").bind(memberId),
        env.DB.prepare("SELECT mp.display_name, mp.member_number, rr.created_at FROM referral_relationships rr LEFT JOIN member_profiles mp ON mp.platform_user_id = rr.referred_user_id WHERE rr.referrer_user_id = ? AND rr.status = 'active' ORDER BY rr.created_at DESC LIMIT 30").bind(memberId),
      ]);
      const targetAccess = await getAdminAccess(env.DB, memberId, env.ADMIN_LINE_SUBJECTS);
      const crmInsights=await getMemberCrmInsight(env.DB,memberId);
      const referralUrl = memberLiffReferralUrl(env.LIFF_ID, member.member_number);
      return json({ success: true, member, referralUrl, crmInsights, access: admin.adminAccess, targetAccess, ledger: ledger.results || [], courses: courses.results || [], checkins: checkins.results || [], referrals: referrals.results || [] });
    }
    if (request.method === "DELETE" && memberDetailMatch) {
      if (!admin.adminAccess.systemAccess) return json({ success:false, error:"只有系統管理員可刪除會員帳號" }, 403);
      const memberId = memberDetailMatch[1];
      if (memberId === admin.userId) return badRequest("不可刪除目前登入的管理員帳號");
      const target = await env.DB.prepare(`
        SELECT pu.id, pu.status, maa.canonical_user_id
        FROM platform_users pu
        LEFT JOIN member_account_aliases maa ON maa.alias_user_id = pu.id
        WHERE pu.id = ?
      `).bind(memberId).first();
      if (!target || target.status === "deleted") return json({ success:false, error:"Member not found" }, 404);
      if (target.canonical_user_id) return json({ success:false, error:"此帳號已合併至主會員，不可刪除登入識別" }, 409);
      const targetAccess = await getAdminAccess(env.DB, memberId, env.ADMIN_LINE_SUBJECTS);
      if (targetAccess.role === "owner") return badRequest("不可刪除最高管理者帳號");
      const activeReferrals = await env.DB.prepare("SELECT COUNT(*) AS count FROM referral_relationships WHERE referrer_user_id=? AND status='active'").bind(memberId).first();
      if (Number(activeReferrals?.count || 0) > 0) {
        return json({ success:false, error:`此會員仍有 ${Number(activeReferrals.count)} 位推薦會員，請先重新指定推薦人` }, 409);
      }
      await env.DB.batch([
        env.DB.prepare("UPDATE platform_users SET status='deleted',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(memberId),
        env.DB.prepare("DELETE FROM external_identities WHERE platform_user_id=?").bind(memberId),
        env.DB.prepare("UPDATE invite_links SET status='disabled',disabled_at=CURRENT_TIMESTAMP WHERE inviter_user_id=? AND status='active'").bind(memberId),
        env.DB.prepare("UPDATE referral_relationships SET status='superseded' WHERE referred_user_id=? AND status='active'").bind(memberId),
        env.DB.prepare("DELETE FROM admin_member_permissions WHERE platform_user_id=?").bind(memberId),
        env.DB.prepare("INSERT INTO audit_logs (id,actor_user_id,subject_user_id,action,metadata_json) VALUES (?,?,?,'admin.member.deleted',?)")
          .bind(newId("audit"),admin.userId,memberId,JSON.stringify({mode:"soft_delete",loginIdentitiesRemoved:true})),
      ]);
      return json({ success:true, deletedMemberId:memberId });
    }
    const memberPermissionsMatch = url.pathname.match(/^\/v1\/admin\/members\/([^/]+)\/permissions$/);
    if (request.method === "PATCH" && memberPermissionsMatch) {
      if (!admin.adminAccess.canManagePermissions) return json({ success: false, error: "Only the primary administrator can assign permissions" }, 403);
      const memberId = memberPermissionsMatch[1];
      const body = (await readJson(request)) || {};
      const target = await env.DB.prepare("SELECT id FROM platform_users WHERE id = ? AND status = 'active'").bind(memberId).first();
      if (!target) return json({ success: false, error: "Member not found" }, 404);
      const systemAccess = body.systemAccess === true ? 1 : 0;
      const operatorAccess = body.operatorAccess === true ? 1 : 0;
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO admin_member_permissions
          (platform_user_id, system_access, operator_access, granted_by_user_id)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(platform_user_id) DO UPDATE SET
            system_access = excluded.system_access,
            operator_access = excluded.operator_access,
            granted_by_user_id = excluded.granted_by_user_id,
            updated_at = CURRENT_TIMESTAMP`)
          .bind(memberId, systemAccess, operatorAccess, admin.userId),
        env.DB.prepare("INSERT INTO audit_logs (id, actor_user_id, subject_user_id, action, metadata_json) VALUES (?, ?, ?, 'admin.permissions.updated', ?)")
          .bind(newId("audit"), admin.userId, memberId, JSON.stringify({ systemAccess: Boolean(systemAccess), operatorAccess: Boolean(operatorAccess) })),
      ]);
      return json({ success: true, permissions: { systemAccess: Boolean(systemAccess), operatorAccess: Boolean(operatorAccess) } });
    }
    const memberPointsMatch = url.pathname.match(/^\/v1\/admin\/members\/([^/]+)\/points$/);
    if (request.method === "POST" && memberPointsMatch) {
      if (!admin.adminAccess.canManagePoints) return json({ success: false, error: "Point management permission required" }, 403);
      const memberId = memberPointsMatch[1];
      const body = (await readJson(request)) || {};
      const target = await env.DB.prepare("SELECT id FROM platform_users WHERE id = ? AND status = 'active'").bind(memberId).first();
      if (!target) return json({ success: false, error: "Member not found" }, 404);
      try {
        const result = await adjustPoints(env.DB, {
          userId: memberId,
          actorUserId: admin.userId,
          action: String(body.action || ""),
          points: body.points,
          note: body.note,
          requestId: body.requestId,
        });
        return json({ success: true, ...result });
      } catch (error) {
        const message = error.message === "Insufficient point balance" ? "扣除點數不可超過目前餘額" : error.message === "Adjustment reason is required" ? "請填寫贈扣點備註理由" : error.message;
        return badRequest(message || "Unable to adjust points");
      }
    }
    if (request.method === "PATCH" && memberDetailMatch) {
      const memberId = memberDetailMatch[1];
      const body = (await readJson(request)) || {};
      const displayName = String(body.displayName || "").trim().slice(0, 120);
      const phone = String(body.phone || "").trim().slice(0, 40);
      const companyMemberNumber = String(body.companyMemberNumber || "").trim().slice(0, 80);
      const gender = ["", "female", "male", "other", "prefer_not_to_say"].includes(String(body.gender || "")) ? String(body.gender || "") : "";
      const industry = String(body.industry || "").trim().slice(0, 120);
      const birthday = String(body.birthday || "").trim().slice(0, 10);
      const address = String(body.address || "").trim().slice(0, 300);
      const adminNote = String(body.adminNote || "").trim().slice(0, 3000);
      if (!displayName || !companyMemberNumber) return badRequest("姓名與公司會員編號為必填");
      if (birthday && !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return badRequest("生日格式必須為 YYYY-MM-DD");
      const exists = await env.DB.prepare("SELECT platform_user_id FROM member_profiles WHERE platform_user_id = ?").bind(memberId).first();
      if (!exists) return json({ success: false, error: "Member not found" }, 404);
      const duplicate = await env.DB.prepare("SELECT platform_user_id FROM member_profiles WHERE company_member_number = ? AND platform_user_id <> ?").bind(companyMemberNumber, memberId).first();
      if (duplicate) return badRequest("公司會員編號已被其他會員使用");
      const referrerUserId = String(body.referrerUserId || "").trim();
      if (referrerUserId === memberId) return badRequest("推薦人不可為本人");
      if (referrerUserId) {
        const referrer = await env.DB.prepare("SELECT id FROM platform_users WHERE id = ? AND status = 'active'").bind(referrerUserId).first();
        if (!referrer) return badRequest("找不到推薦人系統 ID");
      }
      try {
        await env.DB.batch([
          env.DB.prepare("UPDATE member_profiles SET display_name = ?, phone = ?, gender = ?, company_member_number = ?, industry = ?, birthday = ?, address = ?, admin_note = ?, updated_at = CURRENT_TIMESTAMP WHERE platform_user_id = ?").bind(displayName, phone, gender, companyMemberNumber, industry, birthday, address, adminNote, memberId),
          referrerUserId
            ? env.DB.prepare("INSERT INTO referral_relationships (id, referred_user_id, referrer_user_id, invite_link_id) VALUES (?, ?, ?, NULL) ON CONFLICT(referred_user_id) DO UPDATE SET referrer_user_id = excluded.referrer_user_id, invite_link_id = NULL, status = 'active', created_at = CURRENT_TIMESTAMP").bind(newId("referral"), memberId, referrerUserId)
            : env.DB.prepare("DELETE FROM referral_relationships WHERE referred_user_id = ?").bind(memberId),
        ]);
        await queueMemberCrmInsight(env.DB,memberId);
        scheduleMemberCrmInsights(env,ctx,memberId);
        return json({ success: true });
      } catch (error) { return badRequest(error.message || "Unable to update member"); }
    }
    if (request.method === "GET" && url.pathname === "/v1/admin/checkin-template") {
      const rows = await Promise.all([
        env.DB.prepare("SELECT value FROM app_meta WHERE key = 'checkin_reward_templates'").first(),
        env.DB.prepare("SELECT value FROM app_meta WHERE key = 'checkin_reward_template'").first(),
        env.DB.prepare("SELECT id FROM ad_campaigns WHERE id = 'campaign_daily_template' OR id LIKE 'campaign_daily_template_%' ORDER BY updated_at DESC LIMIT 1").first(),
      ]);
      let templates = [];
      try { templates = rows[0]?.value ? JSON.parse(rows[0].value) : []; } catch { templates = []; }
      if (!Array.isArray(templates) || !templates.length) {
        let legacy = null;
        try { legacy = rows[1]?.value ? JSON.parse(rows[1].value) : null; } catch { legacy = null; }
        if (legacy?.pages) templates = [{ ...legacy, id: "legacy_daily_template", campaignId: rows[2]?.id || "campaign_daily_template" }];
      }
      templates = templates.map((template) => ({
        ...template,
        id: String(template.id || newId("daily_template")),
        campaignId: String(template.campaignId || "campaign_daily_template"),
        pages: (Array.isArray(template.pages) ? template.pages : []).map((page) => ({
          ...page,
          imageUrl: normalizeTemplateImageUrl(page.imageUrl),
        })),
      }));
      return json({ success: true, templates, template: templates[0] || null });
    }
    if (request.method === "DELETE" && url.pathname.startsWith("/v1/admin/checkin-template/")) {
      const templateId = decodeURIComponent(url.pathname.slice("/v1/admin/checkin-template/".length));
      const meta = await env.DB.prepare("SELECT value FROM app_meta WHERE key = 'checkin_reward_templates'").first();
      let templates = [];
      try { templates = meta?.value ? JSON.parse(meta.value) : []; } catch { templates = []; }
      if (!Array.isArray(templates)) templates = [];
      const target = templates.find((item) => String(item.id) === templateId);
      if (!target) return badRequest("找不到此標籤活動");
      if (templates.length <= 1) return badRequest("至少要保留一組簽到活動");
      const remaining = templates.filter((item) => String(item.id) !== templateId);
      const campaignId = String(target.campaignId || "");
      const statements = [
        env.DB.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES ('checkin_reward_templates', ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP").bind(JSON.stringify(remaining)),
        env.DB.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES ('checkin_reward_template', ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP").bind(JSON.stringify(remaining[0])),
      ];
      if (campaignId) {
        statements.push(
          env.DB.prepare("DELETE FROM ad_creatives WHERE campaign_id = ?").bind(campaignId),
          env.DB.prepare("DELETE FROM ad_campaigns WHERE id = ?").bind(campaignId),
        );
      }
      await env.DB.batch(statements);
      await removeTemplateMediaReferences(env.DB, env.MEDIA, templateId);
      return json({ success: true, templates: remaining });
    }
    if (request.method === "POST" && url.pathname === "/v1/admin/checkin-template") {
      const template = (await readJson(request)) || {};
      const pages = Array.isArray(template.pages) ? template.pages.slice(0, 12) : [];
      if (!pages.length) return badRequest("At least one template page is required");
      const templateMetaRows = await Promise.all([
        env.DB.prepare("SELECT value FROM app_meta WHERE key = 'checkin_reward_templates'").first(),
        env.DB.prepare("SELECT value FROM app_meta WHERE key = 'checkin_reward_template'").first(),
        env.DB.prepare("SELECT id FROM ad_campaigns WHERE id = 'campaign_daily_template' OR id LIKE 'campaign_daily_template_%' ORDER BY updated_at DESC LIMIT 1").first(),
      ]);
      let templates = [];
      try { templates = templateMetaRows[0]?.value ? JSON.parse(templateMetaRows[0].value) : []; } catch { templates = []; }
      if (!Array.isArray(templates)) templates = [];
      if (!templates.length) {
        let legacy = null;
        try { legacy = templateMetaRows[1]?.value ? JSON.parse(templateMetaRows[1].value) : null; } catch { legacy = null; }
        if (legacy?.pages) templates = [{ ...legacy, id: "legacy_daily_template", campaignId: templateMetaRows[2]?.id || "campaign_daily_template" }];
      }
      const requestedId = String(template.id || "");
      const previous = templates.find((item) => String(item.id) === requestedId);
      const templateId = previous?.id || newId("daily_template");
      const campaignId = previous?.campaignId || String(template.campaignId || `campaign_daily_template_${templateId}`);
      const safe = {
        id: templateId,
        campaignId,
        active: template.active !== false,
        entryUrl: String(template.entryUrl || "").slice(0, 4096),
        altText: String(template.altText || "今日簽到").slice(0, 300),
        rotationMode: template.rotationMode === "sequential" ? "sequential" : "random",
        pages: pages.map((page) => {
          const mediaType = page.mediaType === 'video' ? 'video' : 'image';
          const mediaAssetId = mediaType === 'video' ? String(page.mediaAssetId || '').trim().slice(0, 160) : '';
          return {
          id: String(page.id || newId('daily_page')).slice(0, 160), mediaType, mediaAssetId,
          mediaName: mediaType === 'video' ? String(page.mediaName || '影片').slice(0, 180) : '',
          imageUrl: mediaType === 'image' ? normalizeTemplateImageUrl(page.imageUrl).slice(0, 4096) : '',
          videoUrl: mediaAssetId ? `${url.origin}/v1/media/${encodeURIComponent(mediaAssetId)}/video` : '',
          posterUrl: mediaAssetId ? `${url.origin}/v1/media/${encodeURIComponent(mediaAssetId)}/poster` : '',
          imageLink: String(page.imageLink || "").slice(0, 4096),
          bubbleSize: ["nano","micro","deca","hecto","kilo","mega","giga"].includes(page.bubbleSize) ? page.bubbleSize : "nano",
          imageAspectRatio: /^\d{1,4}:\d{1,4}$/.test(String(page.imageAspectRatio || "")) ? page.imageAspectRatio : "400:600",
          imageAspectMode: page.imageAspectMode === "fit" ? "fit" : "cover",
          requiredWatchSeconds: Math.max(0, Math.min(3600, Math.round(Number(page.requiredWatchSeconds) || 3))),
          requiredCompletionRatio: mediaType === 'video' ? Math.max(0, Math.min(1, Number(page.requiredCompletionRatio) || 0.8)) : 0,
          buttons: (Array.isArray(page.buttons) ? page.buttons : []).slice(0, 4).map((button) => ({ label: String(button.label || "").slice(0, 80), type: "uri", text: "", uri: String(button.uri || "").slice(0, 4096), color: /^#[0-9a-f]{6}$/i.test(String(button.color || "")) ? String(button.color) : "" })).filter((button) => button.label && button.uri),
        };}),
      };
      if (safe.active && safe.pages.some(page => page.mediaType === 'image' && !page.imageUrl)) return badRequest('每一個圖片頁都必須上傳圖片');
      if (safe.active) {
        for (const page of safe.pages.filter(page => page.mediaType === 'video')) {
          if (!page.mediaAssetId) return badRequest('每一個影片頁都必須從影片庫選擇影片');
          const asset = await env.DB.prepare("SELECT id FROM media_assets WHERE id = ? AND status = 'ready'").bind(page.mediaAssetId).first();
          if (!asset) return badRequest('選擇的影片不存在或已被刪除，請重新選擇');
        }
      } else {
        safe.pages = safe.pages.map(page => page.mediaType === 'video'
          ? { ...page, mediaAssetId: '', mediaName: '', videoUrl: '', posterUrl: '' }
          : page);
      }
      templates = [...templates.filter((item) => String(item.id) !== templateId), safe];
      const campaignStatus = safe.active ? "active" : "paused";
      const statements = [
        // Keep historical creative rows: daily view/check-in records reference them.
        // Archiving lets the campaign be edited without violating those foreign keys.
        env.DB.prepare("UPDATE ad_creatives SET status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE campaign_id = ?").bind(campaignId),
        env.DB.prepare("INSERT INTO ad_campaigns (id, name, status, starts_at, ends_at, required_creative_count, rotation_mode) VALUES (?, ?, ?, '2020-01-01T00:00:00.000Z', '2099-12-31T23:59:59.000Z', ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, status = excluded.status, starts_at = excluded.starts_at, ends_at = excluded.ends_at, required_creative_count = excluded.required_creative_count, rotation_mode = excluded.rotation_mode, updated_at = CURRENT_TIMESTAMP").bind(campaignId, safe.altText, campaignStatus, Math.max(1, safe.pages.length), safe.rotationMode),
      ];
      safe.pages.forEach((page, index) => {
        statements.push(env.DB.prepare("INSERT INTO ad_creatives (id, campaign_id, creative_type, title, media_url, preview_url, target_url, image_link, buttons_json, bubble_size, image_aspect_ratio, image_aspect_mode, required_watch_seconds, required_completion_ratio, display_order, status) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(newId("creative_daily_template"), campaignId, page.mediaType, safe.altText, page.mediaType === 'video' ? page.videoUrl : page.imageUrl, page.mediaType === 'video' ? page.posterUrl : '', page.imageLink, JSON.stringify(page.buttons), page.bubbleSize, page.imageAspectRatio, page.imageAspectMode, page.requiredWatchSeconds, page.requiredCompletionRatio, index, safe.active ? "active" : "archived"));
      });
      statements.push(
        env.DB.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES ('checkin_reward_templates', ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP").bind(JSON.stringify(templates)),
        env.DB.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES ('checkin_reward_template', ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP").bind(JSON.stringify(safe)),
      );
      await env.DB.batch(statements);
      await syncTemplateMediaReferences(env.DB, env.MEDIA, templateId, safe.pages, safe.active);
      return json({ success: true, template: safe, templates, campaignId });
    }
    if (request.method === "POST" && url.pathname === "/v1/admin/checkin-template/upload-image") {
      const form = await request.formData();
      const file = form.get("image");
      if (!(file instanceof File)) return badRequest("Image file is required");
      if (file.size > 1024 * 1024) return badRequest("Image must be 1MB or smaller");
      if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) return badRequest("Only JPEG, PNG, WebP or GIF is allowed");
      const id = newId("template_image");
      await env.DB.prepare("INSERT INTO checkin_template_images (id, content_type, bytes) VALUES (?, ?, ?)").bind(id, file.type, await file.arrayBuffer()).run();
      return json({ success: true, url: `${url.origin}/v1/checkin-template/images/${id}`, size: file.size }, 201);
    }
    if (request.method === "GET" && url.pathname === "/v1/admin/point-rules") {
      await ensureServicePointRules(env.DB);
      const rules = await env.DB.prepare(`
        SELECT id, event_type, points, award_frequency, status, rule_version, created_at, updated_at
        FROM point_rules WHERE program_id = 'program_main'
          AND event_type NOT IN ('member_joined','referral_attendance_reward','registration_completed')
          AND event_type NOT LIKE 'number_science_%'
        ORDER BY event_type ASC, updated_at DESC
      `).all();
      return json({ success: true, rules: rules.results || [] });
    }
    const body = (await readJson(request)) || {};
    if (request.method === "POST" && url.pathname === "/v1/admin/point-rules/reconcile") {
      const [members, profiles, referrals, checkins, registrations, attendance] = await env.DB.batch([
        env.DB.prepare("SELECT id FROM platform_users WHERE status = 'active'"),
        env.DB.prepare("SELECT platform_user_id FROM member_profiles WHERE profile_completed_at IS NOT NULL AND profile_completed_at != ''"),
        env.DB.prepare("SELECT rr.referrer_user_id, rr.referred_user_id FROM referral_relationships rr JOIN platform_users pu ON pu.id = rr.referrer_user_id AND pu.status = 'active' WHERE rr.status = 'active'"),
        env.DB.prepare("SELECT platform_user_id, campaign_id, business_date FROM daily_checkins WHERE status = 'verified'"),
        env.DB.prepare("SELECT platform_user_id, course_session_id FROM course_registrations WHERE status = 'registered'"),
        env.DB.prepare("SELECT platform_user_id, course_session_id, id FROM attendance_records WHERE status = 'verified'"),
      ]);
      const work = [
        ...(members.results || []).map((row) => ({ userId: row.id, eventType: "member_joined", eventReference: row.id, idempotencyKey: `member_joined:${row.id}` })),
        ...(profiles.results || []).map((row) => ({ userId: row.platform_user_id, eventType: "registration_completed", eventReference: row.platform_user_id, idempotencyKey: `registration_completed:${row.platform_user_id}` })),
        ...(referrals.results || []).map((row) => ({ userId: row.referrer_user_id, eventType: "share_referral", eventReference: row.referred_user_id, idempotencyKey: `share_referral:${row.referred_user_id}`, metadata: { referredUserId: row.referred_user_id } })),
        ...(checkins.results || []).map((row) => ({ userId: row.platform_user_id, eventType: "daily_ad_checkin", eventReference: `${row.campaign_id}:${row.business_date}`, idempotencyKey: `daily_ad_checkin:${row.campaign_id}:${row.business_date}:${row.platform_user_id}` })),
        ...(registrations.results || []).map((row) => ({ userId: row.platform_user_id, eventType: "course_registered", eventReference: row.course_session_id, idempotencyKey: `course_registered:${row.course_session_id}:${row.platform_user_id}` })),
        ...(attendance.results || []).map((row) => ({ userId: row.platform_user_id, eventType: "attendance_verified", eventReference: row.course_session_id, idempotencyKey: `attendance_verified:${row.course_session_id}:${row.platform_user_id}`, metadata: { attendanceId: row.id } })),
        ...(attendance.results || []).flatMap((row) => {
          const relationship = (referrals.results || []).find((item) => item.referred_user_id === row.platform_user_id);
          return relationship ? [{
            userId: relationship.referrer_user_id,
            eventType: "referral_attendance_reward",
            eventReference: row.course_session_id,
            idempotencyKey: `referral_attendance_reward:${row.course_session_id}:${row.platform_user_id}`,
            metadata: { referredUserId: row.platform_user_id, attendanceId: row.id },
          }] : [];
        }),
      ];
      let awarded = 0;
      let skipped = 0;
      for (const award of work) {
        const result = await awardPoints(env.DB, award);
        if (result.awarded) awarded += 1;
        else skipped += 1;
      }
      return json({ success: true, awarded, skipped, checked: work.length });
    }
    if (request.method === "POST" && url.pathname === "/v1/admin/point-rules") {
      const eventType = String(body.eventType || "").trim();
      const points = Number(body.points);
      if (!POINT_RULE_EVENTS.has(eventType) || !Number.isInteger(points) || points < 0)
        return badRequest("Invalid point rule");
      const frequency = ['once', 'daily', 'per_completion'].includes(body.awardFrequency)
        ? body.awardFrequency : 'per_completion';
      const fixedFrequency = ['member_joined', 'registration_completed'].includes(eventType) ? 'once' : frequency;
      const ruleId = newId("pointrule");
      await env.DB.prepare(
        `INSERT INTO point_rules (id, program_id, event_type, points, daily_limit, award_frequency, status, rule_version) VALUES (?, 'program_main', ?, ?, NULL, ?, ?, ?)`,
      )
        .bind(
          ruleId,
          eventType,
          points,
          fixedFrequency,
          body.status || "draft",
          body.ruleVersion || "v1",
        )
        .run();
      return json({ success: true, id: ruleId }, 201);
    }
    const ruleMatch = url.pathname.match(/^\/v1\/admin\/point-rules\/([^/]+)$/);
    if (request.method === "POST" && ruleMatch) {
      const eventType = String(body.eventType || "").trim();
      const points = Number(body.points);
      if (!POINT_RULE_EVENTS.has(eventType) || !Number.isInteger(points) || points < 0) return badRequest("Invalid point rule");
      const frequency = ['once', 'daily', 'per_completion'].includes(body.awardFrequency)
        ? body.awardFrequency : 'per_completion';
      const fixedFrequency = ['member_joined', 'registration_completed'].includes(eventType) ? 'once' : frequency;
      const status = ['draft', 'active', 'paused', 'archived'].includes(body.status) ? body.status : 'draft';
      const result = await env.DB.prepare(`
        UPDATE point_rules
        SET event_type = ?, points = ?, award_frequency = ?, status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND program_id = 'program_main'
      `).bind(eventType, points, fixedFrequency, status, ruleMatch[1]).run();
      if (!result.meta?.changes) return json({ success: false, error: "Point rule not found" }, 404);
      return json({ success: true, id: ruleMatch[1] });
    }
    if (request.method === "POST" && url.pathname === "/v1/admin/courses") {
      const title = String(body.title || "").trim();
      if (!title) return badRequest("title is required");
      const id = newId("course");
      await env.DB.prepare(
        `INSERT INTO courses (id, title, description, cover_url, status, created_by_user_id) VALUES (?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          id,
          title,
          String(body.description || ""),
          String(body.coverUrl || ""),
          body.status || "draft",
          admin.userId,
        )
        .run();
      return json({ success: true, id }, 201);
    }
    if (request.method === "GET" && url.pathname === "/v1/admin/courses") {
      return json({ success: true, courses: await listAdminCourses(env.DB) });
    }
    if (request.method === "GET" && url.pathname === "/v1/admin/calendar/events") {
      return json({ success: true, events: await listCalendarSessions(env.DB, { from: url.searchParams.get('from') || '', to: url.searchParams.get('to') || '' }) });
    }
    if (request.method === "POST" && url.pathname === "/v1/admin/calendar/events") {
      const result = await saveCalendarSession(env.DB, body);
      return result.ok ? json({ success: true, id: result.id }, 201) : badRequest(result.reason);
    }
    const calendarDeleteMatch = url.pathname.match(/^\/v1\/admin\/calendar\/events\/([^/]+)$/);
    if (request.method === "DELETE" && calendarDeleteMatch) {
      const changed = await cancelCalendarSession(env.DB, decodeURIComponent(calendarDeleteMatch[1]));
      return changed ? json({ success: true }) : json({ success: false, error: '活動不存在' }, 404);
    }
    if (
      request.method === "POST" &&
      url.pathname === "/v1/admin/course-sessions"
    ) {
      const required = [
        "courseId",
        "mode",
        "startsAt",
        "endsAt",
        "checkinOpensAt",
        "checkinClosesAt",
      ];
      if (required.some((k) => !body[k]))
        return badRequest("Missing course session fields");
      if (!["physical", "online"].includes(body.mode))
        return badRequest("Invalid mode");
      const id = newId("session");
      const codeHash = body.checkinCode
        ? await sha256(String(body.checkinCode))
        : "";
      await env.DB.prepare(
        `INSERT INTO course_sessions (id, course_id, title, attendance_mode, starts_at, ends_at, venue_name, venue_address, meeting_url, checkin_opens_at, checkin_closes_at, checkin_code_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          id,
          body.courseId,
          String(body.title || ""),
          body.mode,
          body.startsAt,
          body.endsAt,
          String(body.venueName || ""),
          String(body.venueAddress || ""),
          String(body.meetingUrl || ""),
          body.checkinOpensAt,
          body.checkinClosesAt,
          codeHash,
        )
        .run();
      return json({ success: true, id }, 201);
    }
    if (
      request.method === "POST" &&
      url.pathname === "/v1/admin/ad-campaigns"
    ) {
      if (!body.name || !body.startsAt || !body.endsAt)
        return badRequest("Missing campaign fields");
      const id = newId("campaign");
      await env.DB.prepare(
        `INSERT INTO ad_campaigns (id, name, status, starts_at, ends_at, required_creative_count, rotation_mode) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          id,
          String(body.name),
          body.status || "draft",
          body.startsAt,
          body.endsAt,
          Math.max(1, Number(body.requiredCreativeCount) || 1),
          body.rotationMode === "random" ? "random" : "sequential",
        )
        .run();
      return json({ success: true, id }, 201);
    }
    if (
      request.method === "POST" &&
      url.pathname === "/v1/admin/ad-creatives"
    ) {
      if (
        !body.campaignId ||
        !body.type ||
        !body.mediaUrl ||
        !["image", "video", "article"].includes(body.type)
      )
        return badRequest("Invalid creative");
      const id = newId("creative");
      const buttons = Array.isArray(body.buttons)
        ? body.buttons
            .slice(0, 4)
            .map((button) => ({
              label: String(button.label || "").slice(0, 40),
              type: button.type === "uri" ? "uri" : "message",
              uri: String(button.uri || "").slice(0, 2048),
              text: String(button.text || "").slice(0, 300),
              color: /^#[0-9a-f]{6}$/i.test(String(button.color || ""))
                ? String(button.color)
                : "",
            }))
            .filter((button) => button.label)
        : [];
      await env.DB.prepare(
        `INSERT INTO ad_creatives (id, campaign_id, creative_type, title, media_url, preview_url, target_url, image_link, buttons_json, bubble_size, image_aspect_ratio, image_aspect_mode, required_watch_seconds, required_completion_ratio, display_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          id,
          body.campaignId,
          body.type,
          String(body.title || ""),
          body.mediaUrl,
          String(body.previewUrl || ""),
          String(body.targetUrl || ""),
          String(body.imageLink || ""),
          JSON.stringify(buttons),
          ["nano", "micro", "deca", "hecto", "kilo", "mega", "giga"].includes(
            body.bubbleSize,
          )
            ? body.bubbleSize
            : "nano",
          /^\d{1,4}:\d{1,4}$/.test(String(body.imageAspectRatio || ""))
            ? body.imageAspectRatio
            : "400:600",
          body.imageAspectMode === "fit" ? "fit" : "cover",
          Math.max(0, Number(body.requiredWatchSeconds) || 3),
          Math.min(1, Math.max(0, Number(body.requiredCompletionRatio) || 0)),
          Number(body.displayOrder) || 0,
        )
        .run();
      return json({ success: true, id }, 201);
    }
    return json({ success: false, error: "Admin endpoint not found" }, 404);
  }

  if (request.method === "GET" && url.pathname === "/v1/tdea-showcase") {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    try {
      return json({ success: true, ...(await fetchTdeaShowcase(env)) });
    } catch (error) {
      console.error("TDEA showcase fetch failed", { error: String(error) });
      return json({ success: false, error: "TDEA 內容暫時無法載入" }, 502);
    }
  }
  if (request.method === "GET" && url.pathname === "/v1/courses") {
    try {
      await syncMlmCourses(env);
    } catch (error) {
      console.error("MLM course sync before listing failed", error);
    }
    return json({
      success: true,
      sessions: await listPublicCourseSessions(env.DB),
    });
  }

  if (request.method === "GET" && url.pathname === "/v1/courses/my") {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    return json({
      success: true,
      sessions: await listMyCourseSessions(env.DB, member.userId),
    });
  }

  if (request.method === "GET" && url.pathname === "/v1/daily-ad") {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    const campaignId = String(url.searchParams.get("campaignId") || "");
    const campaigns = await listDailyAdCampaigns(env.DB);
    const dailyAd = await getDailyAdCampaign(env.DB, member.userId, campaignId);
    return dailyAd
      ? json({ success: true, campaigns, ...dailyAd })
      : json({ success: true, campaigns, campaign: null, creatives: [] });
  }

  if (
    request.method === "POST" &&
    url.pathname === "/v1/daily-ad/view-sessions"
  ) {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    const body = (await readJson(request)) || {};
    const result = await startAdView(env.DB, member.userId, body.creativeId, String(body.campaignId || ""));
    return result.ok
      ? json({ success: true, ...result }, 201)
      : badRequest(result.reason);
  }

  const adProgressMatch = url.pathname.match(
    /^\/v1\/daily-ad\/view-sessions\/([^/]+)\/progress$/,
  );
  if (request.method === "POST" && adProgressMatch) {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    const body = (await readJson(request)) || {};
    const result = await recordAdViewProgress(env.DB, {
      userId: member.userId,
      token: decodeURIComponent(adProgressMatch[1]),
      watchedSeconds: body.watchedSeconds,
      completionRatio: body.completionRatio,
      pageVisible: body.pageVisible !== false,
    });
    return result.ok
      ? json({ success: true, ...result })
      : badRequest(result.reason);
  }

  if (request.method === "POST" && url.pathname === "/v1/daily-ad/check-in") {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    const body = (await readJson(request)) || {};
    const result = await checkInDailyAd(env.DB, member.userId, String(body.campaignId || ""));
    return result.ok
      ? json({ success: true, ...result }, result.duplicate ? 200 : 201)
      : badRequest(result.reason);
  }

  const registrationMatch = url.pathname.match(
    /^\/v1\/course-sessions\/([^/]+)\/register$/,
  );
  if (request.method === "POST" && registrationMatch) {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    const result = await registerForSession(
      env.DB,
      member.userId,
      decodeURIComponent(registrationMatch[1]),
      String((await readJson(request))?.source || 'member_portal'),
    );
    return result.ok
      ? json({ success: true, ...result }, result.duplicate ? 200 : 201)
      : badRequest(result.reason);
  }

  const checkinMatch = url.pathname.match(
    /^\/v1\/course-sessions\/([^/]+)\/check-in$/,
  );
  if (request.method === "POST" && checkinMatch) {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    const body = (await readJson(request)) || {};
    const result = await checkInToSession(env.DB, {
      userId: member.userId,
      sessionId: decodeURIComponent(checkinMatch[1]),
      method: body.method,
      code: body.code,
    });
    return result.ok
      ? json({ success: true, ...result }, result.duplicate ? 200 : 201)
      : badRequest(result.reason);
  }

  if (request.method === "POST" && url.pathname === "/v1/course-sessions/smart-check-in") {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    const result = await smartCheckInToActiveSession(env.DB, { userId: member.userId });
    return result.ok ? json({ success: true, ...result }, result.duplicate ? 200 : 201) : badRequest(result.reason);
  }

  if (request.method === "POST" && url.pathname === "/v1/invite-links") {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
      const body = (await readJson(request)) || {};
      const token = body.token || randomInviteToken();
      try {
        const invite = await createInviteLink(env.DB, member.userId, token);
        // 專屬分享是永久推薦入口，固定留在 A-kaffit 網域，
        // 不與共用 LIFF 入口或限時錢包 QR 綁定。
        const shareUrl = `${url.origin}/i/${encodeURIComponent(invite.token)}`;
      return json(
        {
          success: true,
          invite: {
            id: invite.id,
            token: invite.token,
            url: shareUrl,
            qrPayload: shareUrl,
          },
        },
        201,
      );
    } catch (error) {
      return badRequest(error.message || "Unable to create invite link");
    }
  }

  if (request.method === "GET" && url.pathname.startsWith("/i/")) {
    const inviteToken = decodeURIComponent(url.pathname.slice(3));
    if (!inviteToken || inviteToken.length > 512)
      return new Response("Invalid invite link", { status: 400 });
    const landingUrl = new URL("/", url.origin);
    landingUrl.searchParams.set("invite", inviteToken);
    return Response.redirect(landingUrl.toString(), 302);
  }

  if (env.ASSETS) {
    const assetRequest = url.pathname === "/"
      ? new Request(new URL("/index-20260803-123.txt", url.origin), request)
      : request;
    const assetResponse = await env.ASSETS.fetch(assetRequest);
    if (url.pathname === "/" || ["/admin/", "/admin/index.html", "/admin.html"].includes(url.pathname)) {
      const headers = new Headers(assetResponse.headers);
      if (url.pathname === "/") headers.set("content-type", "text/html; charset=utf-8");
      headers.set("cache-control", "no-store, no-cache, must-revalidate");
      headers.set("pragma", "no-cache");
      headers.set("expires", "0");
      return new Response(assetResponse.body, { status: assetResponse.status, statusText: assetResponse.statusText, headers });
    }
    return assetResponse;
  }
  return json({ success: false, error: "Not Found" }, 404);
}


async function runSystemCrmInsightBackfill(env) {
  try {
    const aiProvider=await resolveCardAiProvider(env);
    if(!aiProvider)return;
    const importRetries=await queueLegacyFailedImportRetries(env.DB,3);
    for(const task of importRetries)await processImportInBackground(env.DB,env.MEDIA,task.userId,task.eventId,aiProvider,env.OPENAI_CARD_MODEL);
    const queued=await queueSystemCrmInsightBackfill(env.DB,6);
    for(const task of queued.tasks) await processContactInsightsInBackground(env.DB,task.userId,task.id,aiProvider,env.OPENAI_CARD_MODEL);
    const memberTasks=await queueSystemMemberCrmInsightBackfill(env.DB,6);
    for(const task of memberTasks)await processMemberCrmInsight(env.DB,task.userId,aiProvider,env.OPENAI_CARD_MODEL);
  } catch(error) {
    console.error("Scheduled CRM insight backfill failed",error);
  }
}

async function runSystemAiCardCrmBackfill(env) {
  try {
    const aiProvider=await resolveCardAiProvider(env);
    if(!aiProvider)return;
    const tasks=await queueSystemAiCardCrmBackfill(env.DB,2);
    for(const task of tasks)await processContactAiCardCrm(env.DB,task.userId,task.id,aiProvider,env.OPENAI_CARD_MODEL);
  } catch(error) {
    console.error("Scheduled AI business-card CRM backfill failed",error);
  }
}

async function runDueTaskPushes(env) {
  try {
    const lineToken = env.LINE_CHANNEL_ACCESS_TOKEN || await getLineAccessToken(env.DB, env.SESSION_SIGNING_SECRET);
    const result = await dispatchDueTaskPushes(env.DB, env, lineToken);
    console.log("Task Engine due notifications completed", { taskCount:result.length });
  } catch (error) { console.error("Scheduled Task Engine push failed", error); }
}
async function runMlmCourseSync(env) {
  try {
    const result = await syncMlmCourses(env);
    console.log("MLM course sync completed", result);
  } catch (error) {
    console.error("Scheduled MLM course sync failed", error);
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS")
      return new Response(null, { headers: { allow: "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS" } });
    try {
      return await app(request, env, ctx);
    } catch (error) {
      console.error("Unhandled request error", error);
      return json({ success: false, error: "Internal Server Error" }, 500);
    }
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runSystemCrmInsightBackfill(env));
    ctx.waitUntil(runSystemAiCardCrmBackfill(env));
    ctx.waitUntil(runMlmCourseSync(env));
    ctx.waitUntil(retryPendingCardCollectionRewards(env));
    ctx.waitUntil(runDueTaskPushes(env));
  },
};
