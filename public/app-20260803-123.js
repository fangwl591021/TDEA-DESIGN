const OFFICIAL_PAGES = {
  home: "https://www.k-link.com.tw/",
  about: "https://www.k-link.com.tw/about-us%E8%B5%B0%E9%80%B2%E5%BA%B7%E7%AB%8B",
  news: "https://www.k-link.com.tw/news-%E6%9C%80%E6%96%B0%E6%B6%88%E6%81%AF",
  products: "https://www.k-link.com.tw/products-%E7%94%A2%E5%93%81%E7%B8%BD%E8%A6%BD",
  video: "https://www.k-link.com.tw/video%E5%BD%B1%E9%9F%B3%E5%B0%88%E5%8D%80",
};
const officialLiffUrl = (page = "home") => `#official-${page}`;

const inviteFromLocation = () => {
  const params = new URLSearchParams(location.search);
  if (params.get("invite")) return params.get("invite");
  const liffState = params.get("liff.state");
  if (!liffState) return "";
  try { return new URL(liffState, location.origin).searchParams.get("invite") || ""; }
  catch { return ""; }
};
const courseSessionFromLocation = () => {
  const params = new URLSearchParams(location.search);
  if (params.get("courseSession")) return params.get("courseSession");
  const liffState = params.get("liff.state");
  if (!liffState) return "";
  try { return new URL(liffState, location.origin).searchParams.get("courseSession") || ""; }
  catch { return ""; }
};
const smartCheckinFromLocation = () => {
  const params = new URLSearchParams(location.search);
  if (params.get("smartCheckin") === "1") return true;
  const liffState = params.get("liff.state");
  if (!liffState) return false;
  try { return new URL(liffState, location.origin).searchParams.get("smartCheckin") === "1"; }
  catch { return false; }
};
const publicCardFromLocation = () => {
  const params = new URLSearchParams(location.search);
  if (params.get("publicCard")) return params.get("publicCard");
  const liffState = params.get("liff.state");
  if (!liffState) return "";
  try { return new URL(liffState, location.origin).searchParams.get("publicCard") || ""; }
  catch { return ""; }
};
const sharedContactFromLocation = () => {
  const params=new URLSearchParams(location.search);if(params.get("sharedContact"))return params.get("sharedContact");
  const liffState=params.get("liff.state");if(!liffState)return "";try{return new URL(liffState,location.origin).searchParams.get("sharedContact")||""}catch{return ""}
};
const cardShareIdFromLocation = () => {
  const params = new URLSearchParams(location.search);
  if (params.get("shareCardId")) return params.get("shareCardId");
  const liffState = params.get("liff.state");
  if (!liffState) return "";
  try { return new URL(liffState, location.origin).searchParams.get("shareCardId") || ""; }
  catch { return ""; }
};
const cardShareModeFromLocation = () => {
  const params = new URLSearchParams(location.search);
  if (params.get("share") === "1") return true;
  const liffState = params.get("liff.state");
  if (!liffState) return false;
  try { return new URL(liffState, location.origin).searchParams.get("share") === "1"; }
  catch { return false; }
};
const pendingCollectedShareFromStorage = () => {
  try { return JSON.parse(sessionStorage.getItem("klinkweb_pending_collected_share") || "null"); }
  catch { return null; }
};
const state = {
  config: null,
  token: localStorage.getItem("klinkweb_session") || "",
  member: null,
  tab: ["daily","tasks"].includes(new URLSearchParams(location.search).get("tab")) ? new URLSearchParams(location.search).get("tab") : "home",
  invite: inviteFromLocation() || sessionStorage.getItem("klinkweb_invite") || "",
  courseSession: courseSessionFromLocation() || sessionStorage.getItem("klinkweb_course_session") || "",
  smartCheckin: smartCheckinFromLocation() || sessionStorage.getItem("klinkweb_smart_checkin") === "1",
  publicCard: publicCardFromLocation(),
  sharedContact: sharedContactFromLocation(),
  cardShareId: cardShareIdFromLocation() || sessionStorage.getItem("klinkweb_card_share_id") || "",
  cardShareMode: cardShareModeFromLocation() || sessionStorage.getItem("klinkweb_card_share_mode") === "1",
  pendingCardShareId: sessionStorage.getItem("klinkweb_pending_card_share_id") || "",
  pendingCollectedShare: pendingCollectedShareFromStorage(),
  courseView: "catalog",
  cardVersion: "",
  daily: null,
  dailyPanel: "checkin",
  dailyCampaignId: new URLSearchParams(location.search).get("checkin") || "",
  calendarSessions: null,
  calendarRegisteredIds: new Set(),
  calendarMonth: "",
  calendarSelectedDate: "",
  calendarLabels: [],
  calendarContacts: [],
};
const $ = (s) => document.querySelector(s);
let dailyRotationTimer = null;
let loginInProgress = false;
let mlmPointSyncError = "";
// 必須在 liff.init() 消耗 OAuth 參數前先記住是否為登入回跳。
const liffLoginCallbackAtLoad = (() => {
  const params = new URLSearchParams(location.search);
  return params.get("loginResume") === "1" || (params.has("code") && params.has("state"));
})();
// LIFF 的 OAuth code 僅能兌換一次。整個頁面生命週期只能初始化一次，
// 否則在名片分享時再次 init 會重新使用網址上殘留的 code，導致
// "invalid authorization code" 而無法開啟分享對象選擇器。
let liffInitPromise = null;
function cleanLiffRedirectUrl() {
  const current = new URL(location.href);
  const encodedState = current.searchParams.get("liff.state");
  let redirect = current;
  if (encodedState) {
    try { redirect = new URL(encodedState, location.origin); } catch { /* retain current URL */ }
  }
  ["code", "state", "scope", "error", "error_description", "liff.state", "liff.referrer"].forEach((key) => redirect.searchParams.delete(key));
  return redirect.toString();
}
function liffLoginRedirectUrl() {
  const redirect = new URL(cleanLiffRedirectUrl());
  // LINE 內建瀏覽器重新建立 WebView 時可能不保留 session/localStorage，
  // 因此把一次性的續登入訊號直接放進回跳網址。
  redirect.searchParams.set("loginResume", "1");
  return redirect.toString();
}
function hasPendingLiffLogin() {
  const sessionPending = sessionStorage.getItem("klinkweb_liff_login_pending") === "1";
  const pendingAt = Number(localStorage.getItem("klinkweb_liff_login_pending_at") || 0);
  const recentPersistentPending = pendingAt > 0 && Date.now() - pendingAt < 120000;
  return liffLoginCallbackAtLoad || sessionPending || recentPersistentPending;
}
function shouldAutoStartLineLogin() {
  // 公開名片與公開收藏名片是給收件人免登入瀏覽的內容。
  // LINE 內建瀏覽器也會回報 isInClient()，不能因此把收件人送進 LIFF 授權，
  // 否則一般分享網址會在內容顯示後跳成 LINE 的 400 Bad Request。
  if (!state.config?.liffId || state.member || state.publicCard || state.sharedContact) return false;
  if (hasPendingLiffLogin()) return true;
  const params = new URLSearchParams(location.search);
  if (params.has("liff.state")) return true;
  try { return Boolean(window.liff?.isInClient?.()); }
  catch { return false; }
}
function markLiffLoginPending() {
  sessionStorage.setItem("klinkweb_liff_login_pending", "1");
  localStorage.setItem("klinkweb_liff_login_pending_at", String(Date.now()));
}
function clearLiffLoginPending() {
  sessionStorage.removeItem("klinkweb_liff_login_pending");
  localStorage.removeItem("klinkweb_liff_login_pending_at");
}
async function initLiffOnce() {
  const liffId = state.cardShareMode
    ? (state.config?.cardShareLiffId || state.config?.liffId)
    : state.config?.liffId;
  if (!liffId) throw new Error("尚未設定 LIFF_ID");
  if (!window.liff) throw new Error("LINE LIFF 尚未載入，請從 LINE 重新開啟會員中心");
  if (!liffInitPromise) {
    liffInitPromise = liff.init({ liffId }).catch((error) => {
      liffInitPromise = null;
      throw error;
    });
  }
  await liffInitPromise;
}
if (inviteFromLocation()) sessionStorage.setItem("klinkweb_invite", state.invite);
if (courseSessionFromLocation()) sessionStorage.setItem("klinkweb_course_session", state.courseSession);
if (smartCheckinFromLocation()) sessionStorage.setItem("klinkweb_smart_checkin", "1");
if (cardShareIdFromLocation()) sessionStorage.setItem("klinkweb_card_share_id", state.cardShareId);
if (cardShareModeFromLocation()) sessionStorage.setItem("klinkweb_card_share_mode", "1");
const pointEventLabel = { member_joined:"加入會員", registration_completed:"完成註冊", share_referral:"分享邀約成功", daily_ad_checkin:"每日簽到", course_registered:"課程報名", attendance_verified:"課程簽到", referral_attendance_reward:"所屬會員完成獎勵", task_completed:"完成任務", card_collection_reward:"掃描名片", card_collection_reward_reversal:"刪除名片扣回" };
const FIXED_CARD_IMAGE_LINK = "https://lin.ee/ngaHmLM";
const DEFAULT_CARD_CHAT_ALT_TEXT = "健康新世代、從康立開始";
const AI_WEAR_LIFF_URL = "https://liff.line.me/2007221311-snSAlddv?aiWearTry=1";
const MLM_AI_WEAR_MEMBER_SETTINGS_URL = "https://mlm.fangwl591021.workers.dev/api/ai-wear/member-settings";
const cardChatAltText = (card) => String(card?.chatAltText || DEFAULT_CARD_CHAT_ALT_TEXT).trim().slice(0, 300) || DEFAULT_CARD_CHAT_ALT_TEXT;
class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = "ApiError";
    this.status = Number(status) || 0;
  }
}
const api = async (path, options = {}) => {
  const headers = {
    ...(state.token ? { authorization: `Bearer ${state.token}` } : {}),
    ...(options.headers || {}),
  };
  if (!(options.body instanceof FormData)) headers["content-type"] = "application/json";
  let r;
  try {
    r = await fetch(path, {
      ...options,
      headers,
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError("網路連線暫時中斷，請稍後重試");
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(j.error || (r.status >= 500 ? "系統暫時忙碌，請稍後重試" : "操作失敗"), r.status);
  return j;
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function withActionFeedback(button, task, { busy = "處理中…", success = "已完成" } = {}) {
  if (!button) return task();
  if (button.dataset.busy === "1") return;
  const original = button.textContent;
  button.dataset.busy = "1";
  button.disabled = true;
  button.textContent = busy;
  try {
    const result = await task();
    if (button.isConnected) {
      button.textContent = success;
      await wait(650);
    }
    return result;
  } finally {
    if (button.isConnected) {
      button.disabled = false;
      button.textContent = original;
      delete button.dataset.busy;
    }
  }
}
const esc = (s) =>
  String(s || "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const format = (value) => new Intl.NumberFormat("zh-TW").format(Number(value) || 0);
function avatar(member = state.member) {
  return member?.pictureUrl
    ? `<img class="avatar" src="${esc(member.pictureUrl)}" alt="LINE 頭貼">`
    : `<span class="avatar placeholder">${esc((member?.displayName || "L").slice(0, 1))}</span>`;
}
function layout(body) {
  const featureCopy = { wallet:["點數錢包","查看目前可用點數與交易紀錄。"], courses:["課程活動","查看課程、完成報名與簽到。"], daily:["TDEA 每日簽到",`向左滑動輪播卡；完成 ${Number(state.daily?.campaign?.requiredCreativeCount) || 0} 項觀看後，即可每日簽到。`], card:["我的名片","編輯並分享你的專屬數位名片。"], zodiac:["星座命理","整合星座、生肖、生命靈數與 AI，提供今日導航。"], cardCollection:["名片收藏","掃描、整理並搜尋你的私人名片簿。"], smartMatch:["智能配對","輸入合作需求，從你的名片收藏中找出適合的人選。"], calendar:["個人行程","管理個人行程、聯絡人生日與提醒。"], tasks:["AI 任務中心","提醒、執行、回報、分析，再自動形成下一步。"], profile:["會員資料","管理你的會員資料與個人資訊。"] };
  const [featureTitle,featureHint] = featureCopy[state.tab] || ["康立行動入口","會員服務與活動入口。"];
  const homeAction = `<button class="feature-header-action feature-home-action" data-home-action="home" aria-label="返回首頁"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 11 8-7 8 7v9h-6v-6h-4v6H4z"/></svg><span>返回首頁</span></button>`;
  const headerActions = `<div class="feature-header-actions">${homeAction}</div>`;
  const featureHeader = `<header class="hero member-hero feature-member-hero"><div class="daily-banner-profile">${avatar()}<strong>${esc(state.member?.displayName || "LINE 會員")}</strong></div><div class="daily-banner-copy"><h1>${esc(featureTitle)}</h1><p>${esc(featureHint)}</p></div>${headerActions}</header>`;
  const memberHeader = state.tab === "home" ? "" : featureHeader;
  $("#app").innerHTML =
    `${memberHeader}<div class="content">${state.tab === "home" ? "" : portalMenu()}${body}</div>`;
  bindPortalActions();
}
async function login() {
  await initLiffOnce();
  if (!liff.isLoggedIn()) {
    // LINE Login 完成後會重新載入 LIFF；保留標記，讓 boot() 自動續跑
    // 身份驗證，而不是停在原本的登入按鈕頁面等使用者再點一次。
    markLiffLoginPending();
    liff.login({ redirectUri: liffLoginRedirectUrl() });
    // 若 LINE 沒有成功開啟授權頁，數秒後解除鎖定，讓使用者可以重試。
    setTimeout(() => {
      if (document.visibilityState === "visible" && !liff.isLoggedIn()) {
        clearLiffLoginPending();
        loginInProgress = false;
        const button = $("#login");
        if (button) {
          button.disabled = false;
          button.textContent = "使用 LINE 登入";
        }
        const status = $("#loginStatus");
        if (status) status.textContent = "尚未開啟 LINE 授權，請再試一次。";
      }
    }, 8000);
    return;
  }
  clearLiffLoginPending();
  const status = $("#loginStatus");
  if (status) status.textContent = "LINE 身份已確認，正在建立會員資料…";
  const idToken = liff.getIDToken();
  const lineProfile = await liff.getProfile().catch(() => null);
  const r = await api("/v1/auth/line/verify", {
    method: "POST",
    body: JSON.stringify({
      idToken,
      accessToken: liff.getAccessToken() || "",
      inviteToken: state.invite,
      pictureUrl: lineProfile?.pictureUrl || "",
      displayName: lineProfile?.displayName || "",
    }),
  });
  state.token = r.sessionToken;
  localStorage.setItem("klinkweb_session", state.token);
  state.member = r.member;
  const invitedReferrer = state.invite ? r.member?.systemReferrer : null;
  if(state.invite){
    const referrerLabel=invitedReferrer?.displayName||invitedReferrer?.memberNumber||"";
    setTimeout(()=>alert(referrerLabel?`LINE 登入成功\n推薦關係已確立：${referrerLabel}`:"LINE 登入成功，但這組邀請碼未建立新的推薦關係。"),0);
  }
  sessionStorage.removeItem("klinkweb_invite");
  // 驗證完成後必須同步清除記憶體中的邀請狀態；否則 render() 會判定為
  // 「已登入會員再次開啟邀約」，又回到同一張登入卡，形成無限循環。
  state.invite = "";
  loginInProgress = false;
  if (state.courseSession) state.tab = "courses";
  history.replaceState({}, "", state.tab === "daily" ? `${location.pathname}?tab=daily` : location.pathname);
  await render();
}
async function startLogin() {
  if (loginInProgress) return;
  loginInProgress = true;
  const button = $("#login");
  if (button) {
    button.disabled = true;
    button.textContent = "LINE 登入處理中…";
  }
  const status = $("#loginStatus");
  if (status) status.textContent = "請稍候，不需要重複點擊。";
  try {
    await login();
  } catch (error) {
    clearLiffLoginPending();
    loginInProgress = false;
    if (button) {
      button.disabled = false;
      button.textContent = "使用 LINE 登入";
    }
    if (status) status.textContent = "登入未完成，請重新嘗試。";
    alert(error.message || "LINE 登入失敗");
  }
}
let phoneAuthMode = "login";
async function submitPhoneBirthdayAuth() {
  const button = $("#phoneAuthSubmit");
  const phone = $("#registerPhone")?.value.trim() || "";
  const birthday = $("#registerBirthday")?.value || "";
  if (!phone || !birthday) return alert("請填寫手機與生日");
  if (!/^\d{6,7}$/.test(birthday)) return alert("生日密碼請輸入民國年月日，例如 591021、390305");
  const isLogin = phoneAuthMode === "login";
  try {
    const result = await withActionFeedback(button, () => api("/v1/auth/phone-birthday", {
      method: "POST",
      body: JSON.stringify({ phone, birthday, inviteToken: state.invite, intent:phoneAuthMode }),
    }), { busy:isLogin ? "登入中…" : "建立會員中…", success:isLogin ? "登入成功" : "註冊完成" });
    state.token = result.sessionToken;
    state.member = result.member;
    localStorage.setItem("klinkweb_session", state.token);
    sessionStorage.removeItem("klinkweb_invite");
    state.invite = "";
    await render();
  } catch (error) {
    alert(error.message || (isLogin ? "登入未完成" : "註冊未完成"));
  }
}
async function renderLogin() {
  const isLogin = phoneAuthMode === "login";
  const lineReady = Boolean(state.config?.liffId);
  $("#app").innerHTML = `<section class="ak-register"><div class="ak-register-wordmark">A-KAFFIT TEAM</div><h1>使用 LINE 登入</h1><p>以你的 LINE 身分安全登入；第一次使用會建立會員資料，之後會直接回到原帳號。</p><button class="btn" id="login" ${lineReady ? "" : "disabled"}>使用 LINE 登入</button><div class="ak-auth-mode-note" id="loginStatus">${lineReady ? "將使用 LINE 授權確認身分，不需要另外設定密碼。" : "LINE Login 尚未設定，請使用下方備援登入。"}</div><details class="ak-auth-fallback"><summary>其他登入方式：手機＋生日</summary><div class="ak-auth-tabs" role="tablist" aria-label="會員登入與註冊"><button type="button" role="tab" aria-selected="${isLogin}" class="${isLogin ? "active" : ""}" data-phone-auth-mode="login">會員登入</button><button type="button" role="tab" aria-selected="${!isLogin}" class="${!isLogin ? "active" : ""}" data-phone-auth-mode="register">新會員註冊</button></div><div class="ak-auth-mode-note">${isLogin ? "輸入已註冊的手機與生日密碼。" : "確認尚未註冊後，再建立新的會員資料。"}</div><label>手機<input id="registerPhone" type="tel" inputmode="tel" autocomplete="tel" placeholder="0912345678" maxlength="20"></label><label>生日密碼（民國年月日）<input id="registerBirthday" type="text" inputmode="numeric" autocomplete="bday" placeholder="例如 591021、390305" pattern="[0-9]{6,7}" maxlength="7"></label><button class="btn alt" id="phoneAuthSubmit">${isLogin ? "登入會員中心" : "建立新會員"}</button><em>${isLogin ? "查無會員時，系統不會自動建立帳號。" : "已註冊的手機與生日不會再次建立帳號。"}</em></details></section>`;
  if (lineReady) $("#login").onclick = startLogin;
  document.querySelectorAll("[data-phone-auth-mode]").forEach((tab)=>tab.onclick=()=>{phoneAuthMode=tab.dataset.phoneAuthMode === "register" ? "register" : "login";renderLogin();});
  $("#phoneAuthSubmit").onclick = submitPhoneBirthdayAuth;
}
function renderSessionRecovery(error) {
  const message = error?.message || "會員資料暫時無法載入";
  $("#app").innerHTML = `<section class="ak-register ak-session-recovery"><div class="ak-register-wordmark">A-KAFFIT TEAM</div><h1>登入資料仍為你保留</h1><p>${esc(message)}</p><button class="btn" id="retrySession">重新載入首頁</button><button class="btn alt" id="resetSession">改用其他帳號登入</button><em>系統不會因暫時連線失敗而要求你重新註冊。</em></section>`;
  $("#retrySession").onclick = () => render();
  $("#resetSession").onclick = () => {
    state.token = "";
    state.member = null;
    localStorage.removeItem("klinkweb_session");
    renderLogin();
  };
}
async function renderAuthenticatedMember() {
  if (!state.member.profileCompletedAt) return profile(true);
  if (state.smartCheckin) return smartCheckin();
  if (state.courseSession) state.tab = "courses";
  if (state.tab === "wallet") return wallet();
  if (state.tab === "courses") return courses();
  if (state.tab === "daily") return daily();
  if (state.tab === "card") return card();
  if (state.tab === "zodiac") return zodiac();
  if (state.tab === "cardCollection") return cardCollection();
  if (state.tab === "smartMatch") return smartMatch();
  if (state.tab === "calendar") return personalCalendar();
  if (state.tab === "tasks") return taskCenter();
  if (state.tab === "profile") return profile();
  return home();
}
async function render() {
  // 已有工作階段的會員再次從邀約 QR 進站時，保留單一步驟讓他確認推薦關係；
  // 不自動重導，避免某些 LINE WebView 停在載入畫面。
  if (state.token && state.invite) return renderLogin();
  if (state.pendingCollectedShare?.id) return resumePendingCollectedShare();
  if (state.pendingCardShareId) return resumePendingCardShare();
  if (state.cardShareMode && state.cardShareId) return shareCardFromHeader();
  if (state.publicCard) return publicCard();
  if (state.sharedContact) return publicSharedContact();
  if (!state.token && state.invite) return renderLogin();
  try {
    const session = await api("/v1/session");
    if (!session.member) {
      state.token = "";
      state.member = null;
      localStorage.removeItem("klinkweb_session");
      return renderLogin();
    }
    state.member = session.member;
  } catch (error) {
    if (error?.status === 401) {
      state.token = "";
      state.member = null;
      localStorage.removeItem("klinkweb_session");
      return renderLogin();
    }
    return renderSessionRecovery(error);
  }
  try {
    return await renderAuthenticatedMember();
  } catch (error) {
    return renderSessionRecovery(error);
  }
}
const smartCheckinReason = { no_active_session:"目前沒有可報到的活動，請確認報到時間。", registration_required:"尚未報名此場活動，無法完成簽到。", session_unavailable:"此場活動目前無法簽到。" };
async function smartCheckin() {
  state.tab = "courses";
  layout('<section class="card smart-checkin-result"><h2>智慧簽到驗證中</h2><p class="muted">正在確認你的報名資格、報到時間與活動場次…</p></section>');
  try {
    const result = await api("/v1/course-sessions/smart-check-in", { method:"POST", body:"{}" });
    const message = result.duplicate ? "你已完成本場簽到，無需重複報到。" : "簽到成功，課程簽到點數已依規則入帳。";
    layout(`<section class="card smart-checkin-result success"><h2>✓ ${message}</h2><p class="muted">已完成報名資格、報到時間與活動場次驗證。</p><button class="btn" id="backCourses">查看課程紀錄</button></section>`);
  } catch (error) {
    const text = smartCheckinReason[error.message] || error.message || "智慧簽到失敗";
    layout(`<section class="card smart-checkin-result"><h2>暫時無法完成簽到</h2><p class="muted">${esc(text)}</p><button class="btn alt" id="retrySmartCheckin">重新驗證</button></section>`);
  }
  state.smartCheckin = false;
  sessionStorage.removeItem("klinkweb_smart_checkin");
  history.replaceState({}, "", location.pathname);
  $("#backCourses")?.addEventListener("click", () => courses());
  $("#retrySmartCheckin")?.addEventListener("click", () => { state.smartCheckin = true; smartCheckin(); });
}
const portalIcon = (name) => ({
  cardCollection: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="11" r="2.2"/><path d="M5.8 16c.7-1.7 1.8-2.6 3.2-2.6s2.5.9 3.2 2.6M14.2 9.5h3.4M14.2 12.5h3.4"/></svg>`,
  smartMatch: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><path d="M3.5 18c.6-3 2.1-4.6 4.5-4.6 1.7 0 3 .8 3.8 2.3.9-1.5 2.3-2.3 4.2-2.3 2.4 0 3.9 1.6 4.5 4.6"/><path d="m12 3 .5 1.2 1.3.1-1 .8.3 1.3-1.1-.7-1.1.7.3-1.3-1-.8 1.3-.1z"/></svg>`,
  courses: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.2c1.3 2.3 3 3.3 5.2 3.6-1.6 1.6-2.2 3.3-1.8 5.5-2.1-.6-3.5-.1-5.4 1.4.1-2.4-.8-4-2.8-5.4 2.3-.6 3.8-2 4.8-5.2Z"/><path d="M18.8 14.5c.5.9 1.2 1.3 2.1 1.5-.7.6-.9 1.3-.7 2.2-.8-.3-1.4 0-2.2.5.1-.9-.3-1.6-1.1-2.1.9-.2 1.5-.8 1.9-1.9Z"/></svg>`,
  daily: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="9" r="4.6"/><path d="m9.1 12.6-1.4 7 4.3-2 4.3 2-1.4-7"/><path d="m12 6.5.75 1.7 1.85.15-1.4 1.22.42 1.8L12 10.4l-1.62 1.02.42-1.8-1.4-1.22 1.85-.15Z"/></svg>`,
  aiWear: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 10.2h3.1l1.1 4.1h3.2l1.1-4.1 1.1 4.1h3.2l1.1-4.1h3.1"/><path d="M6.6 10.2c.5-1.1 1.4-1.7 2.6-1.7s2.1.6 2.8 1.7c.7-1.1 1.6-1.7 2.8-1.7s2.1.6 2.6 1.7"/><path d="m18.5 3.5.5 1.4 1.5.1-1.2.9.4 1.5-1.2-.9-1.3.9.5-1.5-1.2-.9 1.5-.1z"/></svg>`,
  profile: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.3" y="4.3" width="15.4" height="15.4" rx="3.2"/><circle cx="12" cy="12" r="3.2"/><path d="M8 7.1h.01M16 7.1h.01"/></svg>`,
  home: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4.5 11 7.5-6.2 7.5 6.2v8.3H4.5z"/><path d="M9 19.3v-4.4h6v4.4M12 7.2v3.1M10.45 8.75h3.1"/></svg>`,
  calendar: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/><path d="M7 14h2M11 14h2M15 14h2M7 18h2M11 18h2"/></svg>`,
  zodiac: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.8 1.1 3.2 3.3.1-2.6 2 1 3.2-2.8-1.9-2.8 1.9 1-3.2-2.6-2 3.3-.1z"/><path d="M18.4 14.4a3.8 3.8 0 1 1-4.8 4.8 4.6 4.6 0 0 0 4.8-4.8Z"/></svg>`
}[name] || "");
const zodiacRanges = [
  [119,"摩羯座","♑"],[218,"水瓶座","♒"],[320,"雙魚座","♓"],[419,"牡羊座","♈"],
  [520,"金牛座","♉"],[621,"雙子座","♊"],[722,"巨蟹座","♋"],[822,"獅子座","♌"],
  [922,"處女座","♍"],[1023,"天秤座","♎"],[1122,"天蠍座","♏"],[1221,"射手座","♐"],[1231,"摩羯座","♑"]
];
const zodiacProfiles = {
  "牡羊座":["主動、直接、行動快","把衝勁留給最重要的一件事，先聽完再回應會更有力量。"],
  "金牛座":["穩定、重視品質、有耐心","當你清楚說出標準與需求，別人會更容易信任你的選擇。"],
  "雙子座":["好奇、靈活、善於交流","資訊很多時，選一個重點說清楚，比同時展開多個話題有效。"],
  "巨蟹座":["細膩、重感受、保護關係","你的關心是優勢；記得也把界線和期待說得明白。"],
  "獅子座":["熱情、表現力強、有領導感","適度分享成果能帶來機會，讓事實與故事一起說話。"],
  "處女座":["觀察細緻、務實、重流程","不必追求一次完美；先完成可用的第一步，持續修正就很好。"],
  "天秤座":["有美感、擅長協調、重公平","在關係中先確認彼此的期待，選擇會更容易做。"],
  "天蠍座":["專注、洞察深、重承諾","把直覺轉成具體問題，能幫你更準確地理解對方。"],
  "射手座":["樂觀、愛探索、視野開闊","保留自由也要留下可落地的下一步，想法才會變成成果。"],
  "摩羯座":["有責任感、目標明確、耐力強","你擅長長期累積；偶爾肯定自己已完成的進度，也能走得更穩。"],
  "水瓶座":["獨立、創新、思考前瞻","新點子很有價值；搭配簡單可理解的說法，就更容易被採納。"],
  "雙魚座":["直覺敏銳、有同理心、富想像力","相信感受的同時，寫下具體安排，能讓靈感真正發揮作用。"]
};
const chineseZodiacProfiles = [
  ["猴","機智轉換"],["雞","細節掌握"],["狗","信任維護"],["豬","資源整合"],
  ["鼠","機會嗅覺"],["牛","穩定推進"],["虎","主動開局"],["兔","關係柔化"],
  ["龍","格局放大"],["蛇","深度判斷"],["馬","行動節奏"],["羊","協調共創"]
];
function birthdayParts(birthday) {
  const match = String(birthday || "").match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  return match ? { year:Number(match[1]), month:Number(match[2]), day:Number(match[3]) } : null;
}
function zodiacFromBirthday(birthday) {
  const parts = birthdayParts(birthday);
  if (!parts) return null;
  const md = parts.month * 100 + parts.day;
  const result = zodiacRanges.find(([max]) => md <= max) || zodiacRanges[0];
  return { name:result[1], symbol:result[2], parts };
}
function chineseZodiacFromBirthday(birthday) {
  const parts = birthdayParts(birthday);
  if (!parts) return null;
  const profile = chineseZodiacProfiles[parts.year % 12];
  return { name:profile[0], trait:profile[1] };
}
function fortuneSeed(text) {
  return Math.abs(Array.from(text).reduce((sum,char) => ((sum << 5) - sum + char.charCodeAt(0)) | 0, 0));
}
function lifePathFromBirthday(birthday) {
  const parts = birthdayParts(birthday);
  if (!parts) return null;
  let value = `${parts.year}${String(parts.month).padStart(2,"0")}${String(parts.day).padStart(2,"0")}`.split("").reduce((sum,digit) => sum + Number(digit), 0);
  while (value > 9 && ![11,22,33].includes(value)) value = String(value).split("").reduce((sum,digit) => sum + Number(digit), 0);
  return value;
}
const lifePathProfiles = {
  1:"獨立開創，適合主動定義今天的第一步。",2:"協調共感，適合用傾聽推進重要關係。",3:"表達創意，適合把想法說清楚並留下紀錄。",
  4:"穩定建構，適合整理流程與完成承諾。",5:"彈性探索，適合嘗試新方法但保留明確邊界。",6:"責任照顧，適合支持團隊也照顧自己的節奏。",
  7:"深度分析，適合先釐清資訊再做決策。",8:"目標成果，適合鎖定最有價值的推進事項。",9:"理想整合，適合用更大的視角連結人與資源。",
  11:"直覺啟發，適合把靈感整理成可執行的訊息。",22:"願景落地，適合把長期目標拆成今天能完成的一步。",33:"關懷引導，適合用溫暖而清楚的方式帶動他人。"
};
const dailyScriptures = [
  ["箴言 16:3","把今天的計畫交託，專注完成眼前能做的一步。"],
  ["傳道書 3:1","每件事都有合適的時機，今天先守住自己的節奏。"],
  ["腓立比書 4:6","把擔心轉成具體的祈求與行動，心就有安定的位置。"],
  ["詩篇 90:12","珍惜今天可運用的時間，把智慧放進每個選擇。"],
  ["箴言 15:1","溫和而清楚的回應，能為關係留下轉圜空間。"],
  ["以賽亞書 40:31","需要等待時先補充力量，再走下一段路。"],
  ["加拉太書 6:9","持續做對的事，即使成果尚未立刻出現。"]
];
const dailyWisdoms = [
  "先完成最小可行的一步，清晰會在行動中出現。","重要的關係不靠猜測，靠真誠確認彼此期待。","把注意力放回能控制的事，能量就會回來。",
  "今天少做一件不重要的事，才能做好真正重要的事。","好的節奏不是更快，而是知道何時前進、何時停下。","把複雜的想法說得簡單，是一種成熟的力量。","留一點空白給直覺，也留一個期限讓決定落地。"
];
function buildPersonalFortune(birthday) {
  const zodiac = zodiacFromBirthday(birthday), chinese = chineseZodiacFromBirthday(birthday), lifePath = lifePathFromBirthday(birthday);
  if (!zodiac || !chinese || !lifePath) return null;
  const now = new Date();
  const seed = fortuneSeed([now.getFullYear(),now.getMonth()+1,now.getDate(),zodiac.name,chinese.name,lifePath].join("-"));
  const themes = ["溫柔聚焦","穩定前進","好感累積","靈感開展","自信表達","關係加溫","節奏整理"];
  const advices = [
    "今天適合把一件最重要的事做得更完整，不必同時回應所有事情。",
    "先照顧自己的節奏，再安排與人的互動，事情會更順。",
    "一句真誠的關心，會比急著說服更容易帶來好回應。",
    "適合整理想法、更新形象，也適合把新的計畫先說給信任的人聽。",
    "把注意力放在已經有進展的關係上，小小推進就很有力量。",
    "今天適合保留一點空白；美感與直覺會幫你做出好選擇。",
    "別急著做最後決定，先確認細節，答案會自然浮現。"
  ];
  const connectionTips = ["主動關心一位近期合作過的人。","先聽完對方的需求，再提出一個具體建議。","把一段模糊的期待改成明確的下一步。","感謝一位曾提供協助的人。","安排一次不超過十五分鐘的有效對話。","把承諾寫下來並確認完成時間。","今天先經營已有信任，不急著擴大範圍。"];
  const colors = ["玫瑰粉","香檳金","奶油白","霧紫","珊瑚橘","鼠尾草綠","可可棕"];
  const index = seed % themes.length;
  const scripture = dailyScriptures[(seed >> 1) % dailyScriptures.length];
  return {
    zodiac, chinese, lifePath, theme:themes[index], advice:advices[index], connection:connectionTips[(seed >> 2) % connectionTips.length],
    scripture:{ reference:scripture[0], text:scripture[1] }, wisdom:dailyWisdoms[(seed >> 3) % dailyWisdoms.length],
    luckyColor:colors[(seed >> 4) % colors.length], score:72 + seed % 25, relation:68 + (seed >> 1) % 29, career:70 + (seed >> 3) % 27,
    date:`${now.getMonth()+1} 月 ${now.getDate()} 日`
  };
}
function showBirthdayRequiredDialog() {
  document.querySelector(".birthday-required-dialog")?.remove();
  const dialog = document.createElement("div");
  dialog.className = "birthday-required-dialog";
  dialog.innerHTML = `<div class="birthday-required-sheet" role="dialog" aria-modal="true" aria-labelledby="birthdayPromptTitle"><span class="zodiac-prompt-icon">✦</span><h2 id="birthdayPromptTitle">先填寫生日，才能查看星座命理</h2><p>生日只用於西洋星座、生肖與生命靈數的基礎分析，不會公開給其他會員。</p><div class="birthday-required-actions"><button class="btn alt" data-zodiac-prompt-close>稍後再說</button><button class="btn" data-zodiac-prompt-fill>前往填寫生日</button></div></div>`;
  document.body.appendChild(dialog);
  dialog.querySelector("[data-zodiac-prompt-close]").onclick = () => dialog.remove();
  dialog.querySelector("[data-zodiac-prompt-fill]").onclick = async () => {
    dialog.remove();
    sessionStorage.setItem("klinkweb_after_profile", "zodiac");
    await showProfileDialog(false, { focusId:"birthday" });
  };
}
const personalityState = { assessments:null, results:{} };
function destinySourceCard(label, value, detail, status = "ready", assessmentType = "") {
  const statusLabel = assessmentType ? (status === "ready" ? "已完成・可重測" : "點擊開始測驗") : status === "ready" ? "已分析" : status === "ai" ? "AI 整合" : "待補資料";
  const action = assessmentType ? ` data-assessment-type="${assessmentType}" role="button" tabindex="0" aria-label="${esc(label)} ${esc(statusLabel)}"` : "";
  return `<article class="destiny-source-card ${status}${assessmentType ? " assessment" : ""}"${action}><header><strong>${esc(label)}</strong><span>${statusLabel}</span></header><b>${esc(value)}</b><p>${esc(detail)}</p>${assessmentType ? '<em>開啟測驗 →</em>' : ""}</article>`;
}
function personalitySourceCard(type, label, fallback) {
  const result = personalityState.results?.[type];
  return result
    ? destinySourceCard(label, result.headline || result.resultCode, result.summary || "已完成測驗並納入性格參考。", "ready", type)
    : destinySourceCard(label, "待完成測驗", fallback, "locked", type);
}
function destinySourcesMarkup(fortune) {
  const [traits, zodiacTip] = zodiacProfiles[fortune.zodiac.name] || ["獨特、真誠、持續成長","保持自己的步調。"];
  return [
    destinySourceCard("西洋星座",fortune.zodiac.name,`${traits}。${zodiacTip}`),
    destinySourceCard("東方生肖",`生肖 ${fortune.chinese.name}`,`${fortune.chinese.trait}；以出生年份提供基礎方向。`),
    destinySourceCard("紫微斗數","待補出生時間","需要出生時辰才能建立可靠命盤。","locked"),
    destinySourceCard("八字","待補出生時間","需要出生時辰才能完成四柱分析。","locked"),
    destinySourceCard("生命靈數",`生命靈數 ${fortune.lifePath}`,lifePathProfiles[fortune.lifePath] || "以生日數字理解今日行動傾向。"),
    personalitySourceCard("mbti","MBTI","不可僅憑生日推測人格類型。"),
    personalitySourceCard("disc","DISC","完成行為風格題目後才能納入。"),
    personalitySourceCard("enneagram","九型人格","需要動機與壓力反應資料。"),
    personalitySourceCard("big_five","Big Five","需要五大人格量表結果。"),
    destinySourceCard("每日經文",fortune.scripture.reference,fortune.scripture.text),
    destinySourceCard("每日智慧","今日一句",fortune.wisdom),
    destinySourceCard("AI 綜合分析","整合中","只整合已有資料，不虛構未完成的測驗。","ai")
  ].join("");
}
function zodiacFortuneMarkup(fortune) {
  return `<section class="zodiac-fortune-card zodiac-comprehensive destiny-card"><header class="destiny-title"><div class="zodiac-fortune-symbol">${fortune.zodiac.symbol}</div><div><small>${esc(fortune.date)}・${esc(fortune.zodiac.name)}</small><h2>星座命理</h2><p>多來源分析，匯整成今天可以採取的下一步。</p></div></header><div class="zodiac-score"><span>今日整體</span><strong>${fortune.score}</strong><i><b style="width:${fortune.score}%"></b></i></div><section class="destiny-sources"><header><div><small>ANALYSIS SOURCES</small><h3>分析來源</h3></div><span>12 項</span></header><div class="destiny-source-grid" data-destiny-sources>${destinySourcesMarkup(fortune)}</div></section><section class="destiny-ai-engine"><header><span>AI</span><div><small>AI ANALYSIS ENGINE</small><h3>AI 分析引擎</h3></div></header><div class="destiny-ai-content loading" data-destiny-ai><b>正在整合已具備的分析來源…</b><p>未完成的命盤與人格測驗不會被推測或補造。</p></div></section><section class="destiny-navigation"><small>TODAY'S NAVIGATION</small><h3>今日導航卡｜${esc(fortune.theme)}</h3><p>${esc(fortune.advice)}</p><div><article><span>今日焦點</span><b>${esc(fortune.theme)}</b></article><article><span>人際導航</span><b>${esc(fortune.connection)}</b></article><article><span>幸運提示</span><b>${esc(fortune.luckyColor)}・生命靈數 ${fortune.lifePath}</b></article></div></section><p class="muted small zodiac-note">性格測驗與命理內容僅供自我覺察與生活導航參考，不構成心理、醫療、投資或重大決策建議。</p></section>`;
}
async function loadDestinyAiAnalysis(root = document) {
  const target = root.querySelector("[data-destiny-ai]");
  const sourceCard = [...root.querySelectorAll(".destiny-source-card")].find((card) => card.querySelector("strong")?.textContent === "AI 綜合分析");
  if (!target) return;
  try {
    const result = await api("/v1/destiny-analysis");
    const analysis = result.analysis || {};
    if (analysis.status === "ready") {
      const combined = [analysis.cards?.personality, analysis.cards?.career, analysis.cards?.interests].filter(Boolean).join(" ");
      target.className = "destiny-ai-content ready";
      target.innerHTML = `<b>AI 綜合分析已完成</b><p>${esc(combined || "已完成個人化分析，可依今日導航卡安排下一步。")}</p>`;
      if (sourceCard) sourceCard.outerHTML = destinySourceCard("AI 綜合分析","已完成",combined || "已整合會員 AI 分析結果。","ready");
      return;
    }
    target.className = "destiny-ai-content pending";
    target.innerHTML = `<b>AI 分析準備中</b><p>系統正在整合會員資料與已完成的性格測驗；稍後再次開啟即可查看。</p>`;
  } catch {
    target.className = "destiny-ai-content failed";
    target.innerHTML = `<b>AI 分析暫時無法載入</b><p>已完成的測驗結果、生日分析與今日導航卡仍可正常使用。</p>`;
  }
}
function bindPersonalitySourceCards(root, fortune) {
  root.querySelectorAll("[data-assessment-type]").forEach((card) => {
    const open = () => openPersonalityAssessment(card.dataset.assessmentType, root, fortune);
    card.addEventListener("click", open);
    card.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } });
  });
}
function refreshPersonalitySourceCards(root, fortune) {
  const grid = root.querySelector("[data-destiny-sources]");
  if (!grid) return;
  grid.innerHTML = destinySourcesMarkup(fortune);
  bindPersonalitySourceCards(root, fortune);
}
async function loadPersonalityAssessments(root, fortune) {
  try {
    const data = await api("/v1/personality-assessments");
    personalityState.assessments = data.assessments || {};
    personalityState.results = data.results || {};
    refreshPersonalitySourceCards(root, fortune);
  } catch { bindPersonalitySourceCards(root, fortune); }
}
function closePersonalityAssessment() {
  document.querySelector(".personality-assessment-dialog")?.remove();
}
function personalityResultMarkup(result) {
  const scoreRows = Object.entries(result.scores || {}).map(([key,value]) => `<span><b>${esc(key)}</b>${esc(value)} 分</span>`).join("");
  return `<section class="personality-result" aria-live="polite"><small>測驗完成</small><h3>${esc(result.headline || result.resultCode)}</h3><p>${esc(result.summary)}</p><div>${scoreRows}</div><button type="button" class="btn" data-personality-close>完成</button></section>`;
}
async function openPersonalityAssessment(type, zodiacRoot, fortune) {
  closePersonalityAssessment();
  if (!personalityState.assessments) {
    try { const data = await api("/v1/personality-assessments"); personalityState.assessments = data.assessments || {}; personalityState.results = data.results || {}; }
    catch (error) { alert(error.message || "測驗載入失敗"); return; }
  }
  const assessment = personalityState.assessments[type];
  if (!assessment) return alert("找不到這份測驗");
  const dialog = document.createElement("section");
  dialog.className = "personality-assessment-dialog";
  const questions = assessment.questions.map((question,index) => `<fieldset><legend><span>${index + 1}</span>${esc(question.prompt)}</legend><div>${question.options.map((option) => `<label><input type="radio" name="${esc(question.id)}" value="${option.value}" required><span>${esc(option.label)}</span></label>`).join("")}</div></fieldset>`).join("");
  dialog.innerHTML = `<div class="personality-assessment-backdrop" data-personality-close></div><article class="personality-assessment-sheet" role="dialog" aria-modal="true" aria-labelledby="personalityAssessmentTitle"><button type="button" class="personality-assessment-close" data-personality-close aria-label="關閉測驗">×</button><header><small>PERSONALITY ASSESSMENT</small><h2 id="personalityAssessmentTitle">${esc(assessment.title)}</h2><p>${esc(assessment.intro)}</p><span>共 ${assessment.questions.length} 題・約 3–5 分鐘</span></header><form><div class="personality-questions">${questions}</div><p class="personality-disclaimer">${esc(assessment.disclaimer)}</p><button type="submit" class="btn personality-submit">完成並儲存結果</button></form></article>`;
  dialog.querySelectorAll("[data-personality-close]").forEach((node) => node.addEventListener("click", closePersonalityAssessment));
  dialog.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("[type=submit]");
    const formData = new FormData(event.currentTarget), answers = {};
    assessment.questions.forEach((question) => { if (formData.has(question.id)) answers[question.id] = Number(formData.get(question.id)); });
    if (Object.keys(answers).length !== assessment.questions.length) return alert(`請完成全部 ${assessment.questions.length} 題`);
    await withActionFeedback(button, async () => {
      const saved = await api("/v1/personality-assessments", { method:"POST", body:JSON.stringify({ type, answers }) });
      personalityState.results[type] = saved.result;
      refreshPersonalitySourceCards(zodiacRoot, fortune);
      dialog.querySelector(".personality-assessment-sheet").innerHTML = `<button type="button" class="personality-assessment-close" data-personality-close aria-label="關閉測驗">×</button>${personalityResultMarkup(saved.result)}`;
      dialog.querySelectorAll("[data-personality-close]").forEach((node) => node.addEventListener("click", closePersonalityAssessment));
    }, { busy:"計算並儲存中…", success:"已儲存" });
  });
  document.body.appendChild(dialog);
  dialog.querySelector("input")?.focus();
}
async function zodiac() {
  const fortune = buildPersonalFortune(state.member?.birthday);
  if (!fortune) return showBirthdayRequiredDialog();
  layout(zodiacFortuneMarkup(fortune));
  bindPersonalitySourceCards(document, fortune);
  loadPersonalityAssessments(document, fortune);
  loadDestinyAiAnalysis(document);
}
function showZodiacDialog() {
  const fortune = buildPersonalFortune(state.member?.birthday);
  if (!fortune) return showBirthdayRequiredDialog();
  document.querySelector(".ak-zodiac-dialog")?.remove();
  const dialog = document.createElement("section");
  dialog.className = "ak-zodiac-dialog";
  dialog.innerHTML = `<div class="ak-zodiac-backdrop" data-close-zodiac></div><article class="ak-zodiac-card" role="dialog" aria-modal="true" aria-labelledby="zodiacDialogTitle"><button type="button" class="ak-zodiac-close" data-close-zodiac aria-label="關閉星座命理">×</button><h2 id="zodiacDialogTitle" class="sr-only">星座命理</h2>${zodiacFortuneMarkup(fortune)}</article>`;
  dialog.querySelectorAll("[data-close-zodiac]").forEach((node) => node.addEventListener("click", () => { closePersonalityAssessment(); dialog.remove(); }));
  document.body.appendChild(dialog);
  bindPersonalitySourceCards(dialog, fortune);
  loadPersonalityAssessments(dialog, fortune);
  loadDestinyAiAnalysis(dialog);
}
function calendarDateKey(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone:"Asia/Taipei", year:"numeric", month:"2-digit", day:"2-digit" }).format(date);
}
function calendarMonthKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone:"Asia/Taipei", year:"numeric", month:"2-digit" }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value || "";
  const month = parts.find((part) => part.type === "month")?.value || "";
  return year && month ? `${year}-${month}` : "";
}
function calendarTimeText(event) {
  if (event.allDay) return "全天";
  const start = new Date(event.startsAt), end = new Date(event.endsAt);
  if (!Number.isFinite(start.getTime())) return "時間未設定";
  const fmt = new Intl.DateTimeFormat("zh-TW", { timeZone:"Asia/Taipei", hour:"2-digit", minute:"2-digit", hour12:false });
  return Number.isFinite(end.getTime()) ? `${fmt.format(start)}–${fmt.format(end)}` : fmt.format(start);
}
function calendarLocalInput(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("sv-SE", { timeZone:"Asia/Taipei", year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hour12:false }).format(date);
  return parts.replace(" ", "T");
}
function calendarIsoFromLocal(value) {
  return new Date(`${value}:00+08:00`).toISOString();
}
function calendarReminderText(minutes) {
  const value = Number(minutes || 0);
  if (!value) return "不提醒";
  if (value === 1440) return "1 天前提醒";
  if (value >= 60) return `${value / 60} 小時前提醒`;
  return `${value} 分鐘前提醒`;
}
async function reloadPersonalCalendar() {
  state.calendarSessions = null;
  await personalCalendar();
}
async function setCalendarLabelVisible(label, visible) {
  await api(`/v1/personal-calendar/labels/${encodeURIComponent(label.id)}`, { method:"PATCH", body:JSON.stringify({ visible }) });
  label.visible = visible;
  renderPersonalCalendarView();
}
async function createCalendarLabelPrompt(suggestedName = "") {
  const initial = typeof suggestedName === "string" ? suggestedName : "";
  const name = prompt("建立行事曆標籤，例如：工作、家庭、約訪、學習", initial);
  if (!name?.trim()) return null;
  const cleanName = name.trim();
  const suggestedColors = { "工作":"#345bdb", "家庭":"#d49121", "約訪":"#b65d79", "學習":"#8246ee" };
  const current = state.calendarLabels.find((label) => label.sourceType === "custom" && label.name.trim().toLocaleLowerCase("zh-TW") === cleanName.toLocaleLowerCase("zh-TW"));
  const color = prompt("標籤顏色（HEX 色碼）", current?.color || suggestedColors[cleanName] || "#52637d") || current?.color || "#52637d";
  const result = await api("/v1/personal-calendar/labels", { method:"POST", body:JSON.stringify({ name:cleanName, color }) });
  if (!result.label) return null;
  const existingIndex = state.calendarLabels.findIndex((label) => label.id === result.label.id);
  if (existingIndex >= 0) state.calendarLabels[existingIndex] = result.label;
  else state.calendarLabels.push(result.label);
  return result.label;
}
function browserCalendarSpeechRecognition() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}
function useCalendarKeyboardDictation(button, titleInput, status, reason = "") {
  button.disabled = false;
  button.classList.remove("is-listening");
  button.textContent = "⌨ 使用鍵盤語音";
  status.textContent = reason || "此裝置無法直接錄音，請改用手機鍵盤語音輸入。";
  button.onclick = () => {
    titleInput.scrollIntoView({ behavior:"smooth", block:"center" });
    titleInput.focus({ preventScroll:true });
    titleInput.click();
    titleInput.setSelectionRange(titleInput.value.length, titleInput.value.length);
    status.textContent = "鍵盤已開啟，請按鍵盤上的 🎙 麥克風。";
  };
}
function calendarVoiceMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"];
  return candidates.find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || "";
}
function applyCalendarVoiceProposal(dialog, proposal, selectContact, status) {
  const setValue = (name, value) => { const input=dialog.querySelector(`[name="${name}"]`); if(input && value !== undefined && value !== null) input.value=value; };
  setValue("title", proposal.title || "");
  if (proposal.startsAt) setValue("startsAt", calendarLocalInput(proposal.startsAt));
  if (proposal.endsAt) setValue("endsAt", calendarLocalInput(proposal.endsAt));
  setValue("location", proposal.location || "");
  setValue("description", proposal.description || "");
  setValue("reminderMinutes", Number(proposal.reminderMinutes || 0));
  if (proposal.labelId && [...dialog.querySelector(`[name="labelId"]`).options].some((option)=>option.value===proposal.labelId)) setValue("labelId", proposal.labelId);
  if (proposal.contactId) selectContact(state.calendarContacts.find((contact)=>contact.id===proposal.contactId) || null);
  const confidence = Math.round(Number(proposal.confidence || 0) * 100);
  status.textContent = proposal.needsConfirmation
    ? `AI 已整理草稿（信心 ${confidence}%），日期或時間仍需確認後再儲存。`
    : `AI 已整理草稿（信心 ${confidence}%），請確認內容後儲存。`;
}
function setupCalendarVoice(dialog, button, status, selectContact) {
  const titleInput = dialog.querySelector(`[name="title"]`);
  let recorder = null, stream = null, countdownTimer = null, autoStopTimer = null, recognition = null, startedAt = 0, disposed = false;
  const clearTimers = () => { clearInterval(countdownTimer); clearTimeout(autoStopTimer); countdownTimer=null;autoStopTimer=null; };
  const stopTracks = () => { stream?.getTracks?.().forEach((track)=>track.stop());stream=null; };
  const idle = () => { if(disposed)return;button.disabled=false;button.classList.remove("is-listening");button.textContent="🎙 開始錄音";button.onclick=()=>startRecording(); };
  const submitVoice = async (body) => {
    button.disabled = true;
    button.textContent = "AI 分析中…";
    status.textContent = "正在辨識語音並整理日期、時間與行程內容。";
    try {
      const result = await api("/v1/personal-calendar/voice", { method:"POST", body });
      applyCalendarVoiceProposal(dialog, result.proposal || {}, selectContact, status);
    } catch (error) {
      status.textContent = error.message || "AI 語音行程建立失敗，請再試一次。";
    } finally { idle(); }
  };
  const startSpeechRecognition = () => {
    const Recognition = browserCalendarSpeechRecognition();
    if (!Recognition) return useCalendarKeyboardDictation(button,titleInput,status,"此裝置無法直接錄音，請改用手機鍵盤語音。");
    recognition = new Recognition();
    recognition.lang="zh-TW";recognition.continuous=false;recognition.interimResults=false;recognition.maxAlternatives=1;
    let transcript="";
    recognition.onstart=()=>{startedAt=performance.now();button.classList.add("is-listening");button.textContent="■ 停止（15 秒）";status.textContent="請說出行程，最長錄音 15 秒。";autoStopTimer=setTimeout(()=>recognition?.stop?.(),15_000);};
    recognition.onresult=(speechEvent)=>{transcript=Array.from(speechEvent.results).map((result)=>result[0]?.transcript||"").join("").trim();};
    recognition.onerror=(speechError)=>{clearTimers();status.textContent=["not-allowed","service-not-allowed"].includes(speechError.error)?"麥克風權限未開啟，請允許後再試。":"沒有辨識到語音，請再試一次。";idle();};
    recognition.onend=()=>{clearTimers();recognition=null;if(transcript)submitVoice(JSON.stringify({transcript}));else idle();};
    button.onclick=()=>recognition?.stop?.();
    try { recognition.start(); } catch { useCalendarKeyboardDictation(button,titleInput,status,"直接語音無法啟動，請改用手機鍵盤語音。"); }
  };
  const startRecording = async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
      const mimeType = calendarVoiceMimeType();
      recorder = new MediaRecorder(stream, mimeType ? {mimeType} : undefined);
      const chunks = [];
      recorder.ondataavailable=(dataEvent)=>{if(dataEvent.data?.size)chunks.push(dataEvent.data);};
      recorder.onerror=()=>{clearTimers();stopTracks();status.textContent="錄音失敗，請再試一次。";recorder=null;idle();};
      recorder.onstop=async()=>{
        clearTimers();
        if(disposed){recorder=null;stopTracks();return;}
        const durationMs=Math.min(15_000,Math.max(1,Math.round(performance.now()-startedAt)));
        const recordedType=recorder?.mimeType||mimeType||"audio/webm";
        recorder=null;stopTracks();
        const blob=new Blob(chunks,{type:recordedType});
        if(!blob.size){status.textContent="沒有錄到聲音，請再試一次。";idle();return;}
        const form=new FormData();
        const extension=recordedType.includes("mp4")?"m4a":recordedType.includes("ogg")?"ogg":"webm";
        form.append("audio",blob,`calendar-voice.${extension}`);
        form.append("durationMs",String(durationMs));
        await submitVoice(form);
      };
      startedAt=performance.now();
      recorder.start(250);
      button.classList.add("is-listening");
      button.textContent="■ 停止（15 秒）";
      status.textContent="請說出行程，錄音會在 15 秒後自動停止。";
      countdownTimer=setInterval(()=>{const left=Math.max(0,15-Math.floor((performance.now()-startedAt)/1000));button.textContent=`■ 停止（${left} 秒）`;},250);
      autoStopTimer=setTimeout(()=>{if(recorder?.state==="recording")recorder.stop();},15_000);
      button.onclick=()=>{if(recorder?.state==="recording")recorder.stop();};
    } catch (error) {
      stopTracks();
      if (["NotAllowedError","SecurityError"].includes(error?.name)) status.textContent="麥克風權限未開啟，請允許後再試。";
      startSpeechRecognition();
    }
  };
  button.onclick = () => startRecording();
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) button.onclick = () => startSpeechRecognition();
  return () => { disposed=true;clearTimers();if(recorder?.state==="recording")recorder.stop();recognition?.abort?.();stopTracks(); };
}
function openCalendarEventDialog(event = null) {
  const editableLabels = state.calendarLabels.filter((label) => !["company","birthday"].includes(label.sourceType));
  const personalLabel = editableLabels.find((label) => label.sourceType === "personal") || editableLabels[0];
  if (!personalLabel) return alert("目前沒有可用的行程分類");
  const selectedDate = state.calendarSelectedDate || calendarDateKey(new Date());
  const defaultStart = `${selectedDate}T09:00`, defaultEnd = `${selectedDate}T10:00`;
  const selectedContact = state.calendarContacts.find((contact) => contact.id === event?.contactCardId) || null;
  const dialog = document.createElement("dialog");
  dialog.className = "personal-calendar-dialog";
  dialog.innerHTML = `<form method="dialog" class="personal-calendar-form"><header><div><small>${event ? "編輯行程" : "新增行程"}</small><h2>${event ? esc(event.title) : "安排新行程"}</h2></div><button type="button" data-close>×</button></header><section class="calendar-voice-input"><div><b>AI 語音新增</b><span data-calendar-voice-status aria-live="polite">直接說出日期、時間與行程，AI 會在 15 秒內整理成草稿。</span></div><button type="button" data-calendar-voice>🎙 開始錄音</button></section><label>行程名稱<input name="title" maxlength="100" required value="${esc(event?.title || "")}" placeholder="例如：與王先生討論合作"></label><section class="calendar-form-section"><div class="calendar-label-picker"><label>行程分類<select name="labelId">${editableLabels.map((label) => `<option value="${esc(label.id)}" ${label.id === (event?.labelId || personalLabel.id) ? "selected" : ""}>${esc(label.name)}</option>`).join("")}</select></label><button type="button" data-add-calendar-label>＋ 新增標籤</button></div><p>「未分類」是沒有指定標籤時的預設分類；你也可以建立工作、家庭、約訪或學習。公司與生日由系統同步，只用於顯示篩選。</p><div class="calendar-label-suggestions"><button type="button" data-label-suggestion="工作">工作</button><button type="button" data-label-suggestion="家庭">家庭</button><button type="button" data-label-suggestion="約訪">約訪</button><button type="button" data-label-suggestion="學習">學習</button></div></section><section class="calendar-form-section calendar-contact-picker"><label>會面／追蹤對象（選填）<input type="search" data-contact-search autocomplete="off" value="${esc(selectedContact?.displayName || "")}" placeholder="搜尋姓名、公司或職稱"><input type="hidden" name="contactCardId" value="${esc(event?.contactCardId || "")}"></label><p>選擇收藏名片後，行程會記在這位聯絡人的約訪紀錄中；沒有特定對象可留空。</p><div class="calendar-contact-selected" data-contact-selected>${selectedContact ? `<b>${esc(selectedContact.displayName)}</b><span>${esc([selectedContact.companyName,selectedContact.jobTitle].filter(Boolean).join("・"))}</span><button type="button" data-clear-contact>清除</button>` : "尚未選擇對象"}</div><div class="calendar-contact-results" data-contact-results hidden></div></section><div class="personal-calendar-form-grid"><label>開始時間<input name="startsAt" type="datetime-local" required value="${event ? calendarLocalInput(event.startsAt) : defaultStart}"></label><label>結束時間<input name="endsAt" type="datetime-local" required value="${event ? calendarLocalInput(event.endsAt) : defaultEnd}"></label><label>提醒時間<select name="reminderMinutes">${[[0,"不提醒"],[10,"10 分鐘前"],[30,"30 分鐘前"],[60,"1 小時前"],[1440,"1 天前"]].map(([value,label]) => `<option value="${value}" ${Number(event ? event.reminderMinutes || 0 : 60) === value ? "selected" : ""}>${label}</option>`).join("")}</select></label><label>地點<input name="location" maxlength="300" value="${esc(event?.location || "")}"></label></div><label>備註<textarea name="description" maxlength="2000" rows="3">${esc(event?.description || "")}</textarea></label><div class="personal-calendar-form-actions">${event ? `<button type="button" class="danger" data-delete>刪除行程</button>` : ""}<button type="button" class="btn alt" data-close>取消</button><button type="submit" class="btn">儲存行程</button></div></form>`;
  document.body.append(dialog);
  const labelSelect = dialog.querySelector(`[name="labelId"]`);
  const voiceButton = dialog.querySelector("[data-calendar-voice]");
  const voiceStatus = dialog.querySelector("[data-calendar-voice-status]");
  const addLabel = async (suggested = "") => {
    try { const label = await createCalendarLabelPrompt(suggested); if (!label) return; let option=[...labelSelect.options].find((item)=>item.value===label.id); if(!option){option=document.createElement("option");option.value=label.id;labelSelect.append(option);} option.textContent=label.name; option.selected=true; }
    catch (error) { alert(error.message || "標籤建立失敗"); }
  };
  dialog.querySelector("[data-add-calendar-label]").onclick = () => addLabel();
  dialog.querySelectorAll("[data-label-suggestion]").forEach((button) => button.onclick = () => addLabel(button.dataset.labelSuggestion || ""));
  const contactSearch=dialog.querySelector("[data-contact-search]"),contactId=dialog.querySelector(`[name="contactCardId"]`),contactResults=dialog.querySelector("[data-contact-results]"),contactSelected=dialog.querySelector("[data-contact-selected]");
  const selectContact=(contact)=>{contactId.value=contact?.id||"";contactSearch.value=contact?.displayName||"";contactSelected.innerHTML=contact?`<b>${esc(contact.displayName)}</b><span>${esc([contact.companyName,contact.jobTitle].filter(Boolean).join("・"))}</span><button type="button" data-clear-contact>清除</button>`:"尚未選擇對象";contactResults.hidden=true;contactSelected.querySelector("[data-clear-contact]")?.addEventListener("click",()=>selectContact(null));};
  const cleanupCalendarVoice = setupCalendarVoice(dialog, voiceButton, voiceStatus, selectContact);
  const searchContacts=()=>{const keyword=contactSearch.value.trim().toLowerCase();const matches=state.calendarContacts.filter((contact)=>!keyword||`${contact.displayName} ${contact.companyName} ${contact.jobTitle}`.toLowerCase().includes(keyword)).slice(0,12);contactResults.innerHTML=matches.length?matches.map((contact)=>`<button type="button" data-contact-id="${esc(contact.id)}"><b>${esc(contact.displayName)}</b><span>${esc([contact.companyName,contact.jobTitle].filter(Boolean).join("・")||"未填公司與職稱")}</span></button>`).join(""):`<p>找不到符合的收藏名片</p>`;contactResults.hidden=false;contactResults.querySelectorAll("[data-contact-id]").forEach((button)=>button.onclick=()=>selectContact(state.calendarContacts.find((contact)=>contact.id===button.dataset.contactId)));};
  contactSearch.addEventListener("focus",searchContacts);contactSearch.addEventListener("input",()=>{contactId.value="";searchContacts();});
  contactSelected.querySelector("[data-clear-contact]")?.addEventListener("click",()=>selectContact(null));
  dialog.querySelectorAll("[data-close]").forEach((button) => button.onclick = () => dialog.close());
  dialog.addEventListener("close", () => {
    cleanupCalendarVoice();
    if (dialog.contains(document.activeElement)) document.activeElement?.blur?.();
    dialog.remove();
  });
  dialog.querySelector("form").onsubmit = async (submitEvent) => {
    submitEvent.preventDefault();
    const form = new FormData(submitEvent.currentTarget);
    const payload = { title:form.get("title"), labelId:form.get("labelId"), contactCardId:form.get("contactCardId"), startsAt:calendarIsoFromLocal(form.get("startsAt")), endsAt:calendarIsoFromLocal(form.get("endsAt")), reminderMinutes:Number(form.get("reminderMinutes") || 0), location:form.get("location"), description:form.get("description") };
    const saveButton = submitEvent.currentTarget.querySelector(`button[type="submit"]`);
    try { await withActionFeedback(saveButton, async () => { await api(event ? `/v1/personal-calendar/events/${encodeURIComponent(event.id)}` : "/v1/personal-calendar/events", { method:event ? "PATCH" : "POST", body:JSON.stringify(payload) }); dialog.close(); await reloadPersonalCalendar(); }, { busy:"儲存中…", success:"已儲存" }); }
    catch (error) { alert(error.message || "行程儲存失敗"); }
  };
  const deleteButton = dialog.querySelector("[data-delete]");
  if (deleteButton) deleteButton.onclick = async () => { if (!confirm("確定刪除這筆行程？")) return; try { await withActionFeedback(deleteButton, async () => { await api(`/v1/personal-calendar/events/${encodeURIComponent(event.id)}`, { method:"DELETE" }); dialog.close(); await reloadPersonalCalendar(); }, { busy:"刪除中…", success:"已刪除" }); } catch (error) { alert(error.message || "刪除失敗"); } };
  dialog.showModal();
}
function renderPersonalCalendarView() {
  const visibleLabelIds = new Set(state.calendarLabels.filter((label) => label.visible).map((label) => label.id));
  const sessions = (Array.isArray(state.calendarSessions) ? state.calendarSessions : []).filter((event) => visibleLabelIds.has(event.labelId));
  const monthKey = state.calendarMonth || calendarMonthKey();
  const [year, month] = monthKey.split("-").map(Number);
  const first = new Date(year, month - 1, 1), daysInMonth = new Date(year, month, 0).getDate(), leading = first.getDay();
  const monthSessions = sessions.filter((event) => calendarDateKey(event.startsAt).startsWith(monthKey));
  const eventMap = new Map();
  monthSessions.forEach((event) => { const key=calendarDateKey(event.startsAt); if(!eventMap.has(key))eventMap.set(key,[]); eventMap.get(key).push(event); });
  const todayKey = calendarDateKey(new Date());
  if (!state.calendarSelectedDate || !state.calendarSelectedDate.startsWith(monthKey)) state.calendarSelectedDate = todayKey.startsWith(monthKey) ? todayKey : `${monthKey}-01`;
  const cells=[];
  for(let i=0;i<leading;i+=1)cells.push(`<span class="personal-calendar-empty"></span>`);
  for(let day=1;day<=daysInMonth;day+=1){const key=`${monthKey}-${String(day).padStart(2,"0")}`,events=eventMap.get(key)||[],colors=[...new Set(events.map((event)=>event.color))].slice(0,3);cells.push(`<button class="personal-calendar-day${key===todayKey?" today":""}${key===state.calendarSelectedDate?" selected":""}" data-calendar-date="${key}"><span>${day}</span>${events.length?`<b>${events.length}</b><em>${colors.map((color)=>`<i style="background:${esc(color)}"></i>`).join("")}</em>`:""}</button>`);}
  const selectedEvents=(eventMap.get(state.calendarSelectedDate)||[]).sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt));
  const selectedLabel=new Intl.DateTimeFormat("zh-TW",{timeZone:"Asia/Taipei",month:"long",day:"numeric",weekday:"short"}).format(new Date(`${state.calendarSelectedDate}T12:00:00+08:00`));
  const eventHtml=selectedEvents.length?selectedEvents.map((event)=>`<article class="personal-calendar-event${event.readonly?" readonly":""}" style="--event-color:${esc(event.color)}"><div class="personal-calendar-event-time"><b>${esc(calendarTimeText(event))}</b><span>${esc(event.labelName)}</span></div><div class="personal-calendar-event-copy"><div><small>${event.sourceType==="company"?`MLM 公司行事曆${event.registeredAt?"・已報名":""}`:event.sourceType==="birthday"?"生日提醒":"我的行程"}</small><h3>${esc(event.title)}</h3></div>${event.contactName?`<p>名片：${esc(event.contactName)}</p>`:""}${event.location?`<p>${esc(event.location)}</p>`:""}${event.reminderMinutes?`<p class="muted">⏰ ${esc(calendarReminderText(event.reminderMinutes))}</p>`:""}${event.description?`<p class="muted">${esc(event.description)}</p>`:""}</div>${event.readonly?"":`<button class="personal-calendar-edit" data-edit-event="${esc(event.id)}">編輯</button>`}</article>`).join(""):`<div class="personal-calendar-no-event">這一天沒有顯示中的行程。</div>`;
  const labelHtml=state.calendarLabels.map((label)=>`<span class="calendar-label-item" style="--label-color:${esc(label.color)}"><button class="calendar-label-chip${label.visible?" active":""}" data-label-toggle="${esc(label.id)}"><i></i>${esc(label.name)}<span>${label.visible?"顯示":"隱藏"}</span></button>${label.system?"":`<button class="calendar-label-delete" data-label-delete="${esc(label.id)}" aria-label="刪除 ${esc(label.name)}">×</button>`}</span>`).join("");
  const reminderNow=Date.now();
  const reminders=sessions.filter((event)=>!event.allDay&&event.reminderMinutes&&Date.parse(event.startsAt)>=reminderNow&&Date.parse(event.startsAt)-reminderNow<=Number(event.reminderMinutes)*60000).slice(0,3);
  const reminderHtml=reminders.length?`<section class="personal-calendar-reminder"><b>即將開始</b>${reminders.map((event)=>`<span>${esc(calendarTimeText(event))}｜${esc(event.title)}</span>`).join("")}</section>`:"";
  layout(`${reminderHtml}<section class="personal-calendar-labels"><header><div><small>顯示篩選</small><h2>我的行事曆標籤</h2></div><button id="calendarAddLabel" type="button">＋ 自訂標籤</button></header><p class="muted">點擊標籤可顯示／隱藏行事曆內容。</p><div>${labelHtml}</div></section><section class="personal-calendar-card"><header class="personal-calendar-toolbar"><button id="calendarPrev" type="button">‹</button><div><small>PERSONAL CALENDAR</small><h2>${year} 年 ${month} 月</h2></div><button id="calendarNext" type="button">›</button></header><div class="personal-calendar-week"><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span></div><div class="personal-calendar-grid">${cells.join("")}</div><div class="personal-calendar-sync-note"><span>●</span> 本月顯示 ${monthSessions.length} 項個人與生日行程</div></section><section class="personal-calendar-agenda"><header><div><small>當日行程</small><h2>${esc(selectedLabel)}</h2></div><div><button id="calendarToday" type="button">今天</button><button id="calendarAddEvent" type="button">＋ 行程</button></div></header>${eventHtml}</section>`);
  document.querySelectorAll("[data-calendar-date]").forEach((button)=>button.onclick=()=>{state.calendarSelectedDate=button.dataset.calendarDate||"";renderPersonalCalendarView();});
  document.querySelectorAll("[data-label-toggle]").forEach((button)=>button.onclick=async()=>{const label=state.calendarLabels.find((item)=>item.id===button.dataset.labelToggle);if(!label)return;button.disabled=true;try{await setCalendarLabelVisible(label,!label.visible);}catch(error){alert(error.message||"標籤更新失敗");button.disabled=false;}});
  document.querySelectorAll("[data-label-delete]").forEach((button)=>button.onclick=async()=>{const label=state.calendarLabels.find((item)=>item.id===button.dataset.labelDelete);if(!label||label.system)return;if(!confirm(`刪除「${label.name}」標籤？標籤內的行程會移到「未分類」。`))return;button.disabled=true;try{await api(`/v1/personal-calendar/labels/${encodeURIComponent(label.id)}`,{method:"DELETE"});await reloadPersonalCalendar();}catch(error){alert(error.message||"標籤刪除失敗");button.disabled=false;}});
  document.querySelectorAll("[data-edit-event]").forEach((button)=>button.onclick=()=>openCalendarEventDialog(state.calendarSessions.find((event)=>event.id===button.dataset.editEvent)));
  $("#calendarAddLabel").onclick=async()=>{try{const label=await createCalendarLabelPrompt();if(label)renderPersonalCalendarView();}catch(error){alert(error.message||"標籤建立失敗");}};
  $("#calendarAddEvent").onclick=()=>openCalendarEventDialog();
  $("#calendarPrev").onclick=()=>{const next=new Date(year,month-2,1);state.calendarMonth=`${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,"0")}`;state.calendarSelectedDate="";renderPersonalCalendarView();};
  $("#calendarNext").onclick=()=>{const next=new Date(year,month,1);state.calendarMonth=`${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,"0")}`;state.calendarSelectedDate="";renderPersonalCalendarView();};
  $("#calendarToday").onclick=()=>{state.calendarMonth=calendarMonthKey();state.calendarSelectedDate=calendarDateKey(new Date());renderPersonalCalendarView();};
}
async function personalCalendar() {
  state.tab="calendar";
  layout(`<section class="card personal-calendar-loading"><h2>同步個人行程中…</h2><p class="muted">正在整合個人行程與生日提醒。</p></section>`);
  try {
    const now=new Date(),from=new Date(now.getFullYear()-1,0,1).toISOString(),to=new Date(now.getFullYear()+2,0,1).toISOString();
    const result=await api(`/v1/personal-calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    state.calendarSessions=Array.isArray(result.events)?result.events:[];
    state.calendarLabels=Array.isArray(result.labels)?result.labels:[];
    state.calendarContacts=Array.isArray(result.contacts)?result.contacts:[];
    state.calendarMonth=state.calendarMonth||calendarMonthKey();state.calendarSelectedDate=state.calendarSelectedDate||calendarDateKey(new Date());
    renderPersonalCalendarView();
  }catch(error){layout(`<section class="card personal-calendar-loading"><h2>行事曆同步失敗</h2><p class="muted">${esc(error.message||"暫時無法讀取行事曆")}</p><button class="btn" id="retryPersonalCalendar">重新同步</button></section>`);$("#retryPersonalCalendar").onclick=personalCalendar;}
}
const taskStatusLabel={pending:"待執行",postponed:"已延期",completed:"已完成",cancelled:"已取消"};
const taskEventLabel={created:"建立任務",completed:"回報完成",postponed:"延期",cancelled:"取消",note_added:"新增紀錄",push_sent:"推播成功",push_failed:"推播失敗",push_skipped:"未推播",ai_next_created:"AI 建立下一步",ai_next_skipped:"AI 判斷暫無下一步",ai_failed:"AI 分析失敗"};
function taskLocalValue(value){const date=new Date(value);if(!Number.isFinite(date.getTime()))return "";const local=new Date(date.getTime()-date.getTimezoneOffset()*60000);return local.toISOString().slice(0,16)}
function taskDateLabel(value){const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleString("zh-TW",{year:"numeric",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"}):"未設定"}
function taskCardMarkup(task,events,deliveries){
  const taskEvents=events.filter((item)=>item.taskId===task.id).slice(0,4);
  const taskDeliveries=deliveries.filter((item)=>item.task_id===task.id).slice(0,2);
  const active=["pending","postponed"].includes(task.status);
  const overdue=active&&Date.parse(task.dueAt)<Date.now();
  return `<article class="task-engine-item ${esc(task.status)}${overdue?" overdue":""}" data-task-id="${esc(task.id)}"><header><div><span class="task-status">${overdue?"逾期":taskStatusLabel[task.status]||task.status}</span><h3>${esc(task.title)}</h3></div><time>${esc(taskDateLabel(task.dueAt))}</time></header>${task.contactName?`<p class="task-contact">名片｜${esc(task.contactName)}</p>`:""}${task.description?`<p>${esc(task.description)}</p>`:""}<div class="task-meta"><span>${task.priority==="high"?"高優先":task.priority==="low"?"低優先":"一般"}</span><span>${task.source==="ai"?"AI 下一步":task.source==="card_crm"?"名片 CRM":"手動建立"}</span>${task.aiStatus==="queued"?"<span class=\"ai-working\">AI 分析中</span>":task.aiReason?`<span title="${esc(task.aiReason)}">AI 已分析</span>`:""}</div>${active?`<div class="task-actions"><button data-task-action="complete">✓ 已完成</button><button data-task-action="postpone">⏰ 延期</button><button data-task-action="cancel">× 取消</button><button data-task-action="note">＋ 新增紀錄</button><button class="task-push" data-task-action="push">發送提醒</button></div>`:`<div class="task-actions"><button data-task-action="note">＋ 新增紀錄</button></div>`}${taskEvents.length?`<details class="task-timeline"><summary>CRM 歷程 ${taskEvents.length} 筆</summary>${taskEvents.map((item)=>`<div><b>${esc(taskEventLabel[item.type]||item.type)}</b><span>${esc(item.note||"")}</span><time>${esc(taskDateLabel(item.createdAt))}</time></div>`).join("")}</details>`:""}${taskDeliveries.length?`<div class="task-delivery">${taskDeliveries.map((item)=>`<span class="${esc(item.status)}">${item.channel==="line"?"LINE":"Telegram"} ${item.status==="sent"?"已送出":item.status==="failed"?"失敗":"未啟用"}</span>`).join("")}</div>`:""}${task.nextTaskId?`<p class="task-next">AI 已建立下一個任務 ↑</p>`:""}</article>`;
}
function taskOverviewMarkup(tasks){
  const now=Date.now(),today=new Date();today.setHours(23,59,59,999);
  const active=tasks.filter((task)=>["pending","postponed"].includes(task.status));
  const overdue=active.filter((task)=>Date.parse(task.dueAt)<now).length;
  const todayDue=active.filter((task)=>{const due=Date.parse(task.dueAt);return due>=now&&due<=today.getTime()}).length;
  const completed=tasks.filter((task)=>task.status==="completed").length;
  return `<section class="task-overview" aria-label="任務摘要"><div><strong>${active.length}</strong><span>待辦</span></div><div class="${overdue?"is-alert":""}"><strong>${overdue}</strong><span>逾期</span></div><div><strong>${todayDue}</strong><span>今日到期</span></div><div><strong>${completed}</strong><span>已完成</span></div></section><section class="task-loop" aria-label="提醒 → 執行 → 回報 → 分析 → 下一步"><span>提醒</span><i>→</i><span>執行</span><i>→</i><span>回報</span><i>→</i><span>分析</span><i>→</i><span>下一步</span></section>`;
}
function taskChannelMarkup(channel,capabilities){
  const telegramReady=channel.telegramEnabled&&channel.telegramBotConfigured;
  const status=telegramReady?"個人 Bot 已啟用":channel.telegramBotConfigured?"個人 Bot 已設定":"尚未設定個人 Bot";
  const tokenHint=channel.telegramBotConfigured
    ? `已設定${channel.telegramBotTokenLast4?`（末四碼 ${esc(channel.telegramBotTokenLast4)}）`:""}，留空可保留`
    : "貼上 BotFather 提供的完整 Token";
  return `<section class="task-channel-card"><details><summary><span class="task-channel-title"><b>推播設定</b><small>每位會員使用自己的 Telegram Bot</small></span><span class="task-channel-state ${telegramReady?"is-ready":""}">${esc(status)}</span><i aria-hidden="true"></i></summary><div class="task-channel-grid"><div class="task-channel-heading"><div><strong>Telegram 個人任務提醒</strong><small>Token 會加密保存，系統不會再次顯示原始內容。</small></div><button id="taskTelegramHelp" type="button" aria-label="查看 Telegram 設定說明">?</button></div><label class="task-channel-field">Telegram Bot Token<input id="taskTelegramBotToken" type="password" autocomplete="new-password" maxlength="160" placeholder="${tokenHint}"></label><div class="task-channel-chat-row"><label class="task-channel-field">Telegram Chat ID<input id="taskTelegramChatId" inputmode="numeric" autocomplete="off" value="${esc(channel.telegramChatId||"")}" placeholder="按右側按鈕自動取得"></label><button id="taskTelegramDetect" type="button">自動取得 ID</button></div><small id="taskTelegramStatus">先在自己的 Bot 按 Start 並傳送「測試」，再自動取得 ID。</small><label class="task-channel-toggle"><input id="taskTelegramEnabled" type="checkbox" ${channel.telegramEnabled?"checked":""}><span>使用 Telegram Push</span></label><div class="task-channel-actions"><button id="saveTaskChannels" type="button">儲存推播設定</button><button id="taskTelegramTest" type="button">發送測試通知</button></div><small>未啟用推播時，任務、CRM 回報與 AI 下一步仍可正常使用。</small></div></details></section><dialog id="taskTelegramHelpDialog" class="task-help-dialog"><form method="dialog"><header><strong>Telegram 個人推播設定</strong><button type="submit" aria-label="關閉說明">×</button></header><ol><li>在 Telegram 找到 <b>@BotFather</b>，傳送 <b>/newbot</b> 建立自己的 Bot。</li><li>將 BotFather 提供的完整 Token 貼到「Telegram Bot Token」。</li><li>開啟自己的 Bot，按 Start 並傳送一則「測試」。</li><li>回到本頁按「自動取得 ID」，確認帳號後儲存。</li><li>按「發送測試通知」確認 Bot 能正常傳送。</li></ol><p>Bot Token 就像密碼，請勿傳給他人。系統只會加密保存，不會在儲存後再次顯示。</p><button class="btn" type="submit">我知道了</button></form></dialog>`;
}
async function taskAction(task,action){
  let body={action};
  if(action==="postpone"){
    const initial=taskLocalValue(new Date(Date.parse(task.dueAt)+86400000));
    const value=prompt("延期到何時？請輸入 YYYY-MM-DDTHH:mm",initial);
    if(!value)return;
    body.dueAt=new Date(value).toISOString();
  }
  if(action==="note"){
    const note=prompt("新增 CRM 紀錄");
    if(!note?.trim())return;
    body.note=note.trim();
  }
  if(action==="cancel"&&!confirm(`確定取消「${task.title}」？`))return;
  await api(`/v1/tasks/${encodeURIComponent(task.id)}/action`,{method:"PATCH",body:JSON.stringify(body)});
  await taskCenter();
  if(["complete","cancel","note"].includes(action))setTimeout(()=>{if(state.tab==="tasks")taskCenter()},1800);
}
async function taskCenter(){
  state.tab="tasks";
  layout(`<section class="card task-engine-loading"><h2>AI 任務中心</h2><p class="muted">正在讀取提醒、回報與下一步…</p></section>`);
  try{
    const data=await api("/v1/tasks");
    const tasks=Array.isArray(data.tasks)?data.tasks:[],events=Array.isArray(data.events)?data.events:[],deliveries=(Array.isArray(data.deliveries)?data.deliveries:[]).filter((item)=>item.channel!=="line"),contacts=Array.isArray(data.contacts)?data.contacts:[];
    const active=tasks.filter((task)=>["pending","postponed"].includes(task.status)),closed=tasks.filter((task)=>!["pending","postponed"].includes(task.status));
    const tomorrow=new Date(Date.now()+86400000);tomorrow.setMinutes(0,0,0);
    const contactOptions=contacts.map((contact)=>`<option value="${esc(contact.id)}">${esc(contact.displayName)}${contact.companyName?`｜${esc(contact.companyName)}`:""}</option>`).join("");
    const channel=data.channel||{},capabilities=data.pushCapabilities||{};
    layout(`<section class="task-engine-intro"><small>TASK ENGINE</small><h2>AI 商務導航</h2><p>把每一次提醒，變成可以追蹤的商務下一步。</p></section>${taskOverviewMarkup(tasks)}<section class="card task-create"><header><div><small>建立任務</small><h2>今天要推進什麼？</h2></div><button id="toggleTaskForm" type="button">＋ 新增</button></header><form id="taskCreateForm" hidden><label>任務名稱<input id="taskTitle" maxlength="120" required placeholder="例如：回訪王小姐確認合作需求"></label><label>關聯名片<select id="taskContact"><option value="">不指定聯絡人</option>${contactOptions}</select></label><div class="task-form-row"><label>期限<input id="taskDueAt" type="datetime-local" value="${taskLocalValue(tomorrow)}" required></label><label>優先順序<select id="taskPriority"><option value="normal">一般</option><option value="high">高</option><option value="low">低</option></select></label></div><label>說明<textarea id="taskDescription" rows="3" maxlength="2000" placeholder="成功標準、要確認的內容…"></textarea></label><button class="btn" id="taskCreateButton" type="submit">建立任務</button></form></section>${taskChannelMarkup(channel,capabilities)}<section class="task-engine-section"><header><div><small>執行中</small><h2>待辦任務</h2></div><b>${active.length}</b></header><div class="task-engine-list">${active.length?active.map((task)=>taskCardMarkup(task,events,deliveries)).join(""):'<div class="task-empty"><strong>目前沒有待辦任務</strong><span>從上方建立第一筆，讓提醒、執行、回報與下一步形成閉環。</span></div>'}</div></section>${closed.length?`<section class="task-engine-section closed"><header><div><small>已回報</small><h2>CRM 任務紀錄</h2></div><b>${closed.length}</b></header><div class="task-engine-list">${closed.map((task)=>taskCardMarkup(task,events,deliveries)).join("")}</div></section>`:""}`);
    $("#toggleTaskForm").setAttribute("aria-expanded","false");$("#toggleTaskForm").onclick=()=>{const form=$("#taskCreateForm"),expanded=form.hidden;form.hidden=!expanded;$("#toggleTaskForm").setAttribute("aria-expanded",String(expanded));$("#toggleTaskForm").textContent=expanded?"收合":"＋ 新增";if(expanded)$("#taskTitle").focus()};
    $("#taskCreateForm").onsubmit=async(event)=>{event.preventDefault();const button=$("#taskCreateButton");try{await withActionFeedback(button,()=>api("/v1/tasks",{method:"POST",body:JSON.stringify({title:$("#taskTitle").value,contactCardId:$("#taskContact").value,dueAt:new Date($("#taskDueAt").value).toISOString(),priority:$("#taskPriority").value,description:$("#taskDescription").value})}),{busy:"建立中…",success:"已建立"});await taskCenter()}catch(error){alert(error.message||"任務建立失敗")}};
    const taskTelegramPayload=()=>({telegramBotToken:$("#taskTelegramBotToken").value,telegramChatId:$("#taskTelegramChatId").value});
    $("#saveTaskChannels").onclick=async()=>{const button=$("#saveTaskChannels");try{await withActionFeedback(button,()=>api("/v1/tasks/channels",{method:"PUT",body:JSON.stringify({lineEnabled:channel.lineEnabled===true,telegramEnabled:$("#taskTelegramEnabled").checked,...taskTelegramPayload()})}),{busy:"儲存中…",success:"已儲存"});await taskCenter()}catch(error){alert(error.message||"推播設定失敗")}};
    $("#taskTelegramDetect").onclick=async()=>{const button=$("#taskTelegramDetect"),status=$("#taskTelegramStatus");try{const result=await withActionFeedback(button,()=>api("/v1/tasks/channels/discover",{method:"POST",body:JSON.stringify({telegramBotToken:$("#taskTelegramBotToken").value})}),{busy:"取得中…",success:"已取得"});$("#taskTelegramChatId").value=result.chatId||"";status.textContent=`已找到 ${result.displayName||"Telegram 帳號"}（${result.botName||"個人 Bot"}）`;status.className="success"}catch(error){status.textContent=error.message||"Chat ID 取得失敗";status.className="error"}};
    $("#taskTelegramTest").onclick=async()=>{const button=$("#taskTelegramTest"),status=$("#taskTelegramStatus");try{await withActionFeedback(button,()=>api("/v1/tasks/channels/test",{method:"POST",body:JSON.stringify(taskTelegramPayload())}),{busy:"發送中…",success:"已送出"});status.textContent="測試通知已送出，請查看 Telegram。";status.className="success"}catch(error){status.textContent=error.message||"測試通知失敗";status.className="error"}};
    $("#taskTelegramHelp").onclick=()=>$("#taskTelegramHelpDialog").showModal();
    document.querySelectorAll("[data-task-action]").forEach((button)=>button.onclick=async()=>{const task=tasks.find((item)=>item.id===button.closest("[data-task-id]")?.dataset.taskId);if(!task)return;button.disabled=true;try{if(button.dataset.taskAction==="push"){await api(`/v1/tasks/${encodeURIComponent(task.id)}/push`,{method:"POST",body:"{}"});await taskCenter()}else await taskAction(task,button.dataset.taskAction)}catch(error){alert(error.message||"任務操作失敗");button.disabled=false}});
    const focusId=new URLSearchParams(location.search).get("task");if(focusId)setTimeout(()=>document.querySelector(`[data-task-id="${CSS.escape(focusId)}"]`)?.scrollIntoView({behavior:"smooth",block:"center"}),50);
  }catch(error){layout(`<section class="card task-engine-loading"><h2>任務中心讀取失敗</h2><p class="muted">${esc(error.message||"暫時無法讀取任務")}</p><button class="btn" id="retryTasks">重新載入</button></section>`);$("#retryTasks").onclick=taskCenter}
}
const portalMenu = () => `<section class="portal-menu portal-menu-compact portal-menu-text" aria-label="會員功能"><button data-home-action="cardCollection"><span>名片收藏</span></button><button data-home-action="daily"><span>每日簽到</span></button><button data-home-action="smartMatch"><span>智能配對</span></button><button data-home-action="calendar"><span>個人行程</span></button></section>`;
function openAiWear(){try{if(window.liff?.isInClient?.()){window.liff.openWindow({url:AI_WEAR_LIFF_URL,external:false});return}}catch{/* Fall back to direct LIFF navigation. */}window.location.href=AI_WEAR_LIFF_URL}
function openOfficialSite(page="home"){
  document.querySelector("#officialSiteOverlay")?.remove();
  const target=OFFICIAL_PAGES[page]||OFFICIAL_PAGES.home;
  const overlay=document.createElement("section");
  overlay.id="officialSiteOverlay";
  overlay.className="official-site-overlay";
  overlay.innerHTML=`<header><button type="button" aria-label="關閉官網">‹</button><strong>康立官方網站</strong><span></span></header><div class="official-site-loading">官網載入中…</div><iframe title="康立官方網站" src="${esc(target)}" referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  document.body.appendChild(overlay);
  const close=()=>overlay.remove();
  overlay.querySelector("button").onclick=close;
  overlay.querySelector("iframe").addEventListener("load",()=>overlay.querySelector(".official-site-loading")?.remove());
}
function bindOfficialSiteLinks(){
  const links=[[document.querySelector(".klink-home-hero>a"),"home"],[document.querySelector(".klink-official-banner"),"home"],...Array.from(document.querySelectorAll(".klink-home-grid>a")).map((link,index)=>[link,["about","news","products","video"][index]])];
  links.forEach(([link,page])=>link?.addEventListener("click",(event)=>{event.preventDefault();openOfficialSite(page)}));
}
async function openBlogPost(slug){
  try{
    const data=await api(`/v1/blog/posts/${encodeURIComponent(slug)}`);
    const post=data.post;
    const dialog=document.createElement("div");
    dialog.className="ak-blog-dialog";
    dialog.innerHTML=`<div class="ak-blog-backdrop" data-close-blog></div><article role="dialog" aria-modal="true" aria-label="${esc(post.title)}"><button class="ak-blog-close" data-close-blog aria-label="關閉">×</button>${post.coverImageUrl?`<img src="${esc(post.coverImageUrl)}" alt="">`:""}<small>${esc(post.category)}</small><h2>${esc(post.title)}</h2><p>${esc(post.content||post.excerpt).replace(/\n/g,"<br>")}</p></article>`;
    dialog.querySelectorAll("[data-close-blog]").forEach((node)=>node.onclick=()=>dialog.remove());
    document.body.append(dialog);
  }catch(error){alert(error.message||"文章載入失敗")}
}
function bindBlogCards(){document.querySelectorAll("[data-blog-slug]").forEach((button)=>button.onclick=()=>openBlogPost(button.dataset.blogSlug))}
function bindPortalActions(){document.querySelectorAll("[data-home-action]").forEach((button)=>(button.onclick=async()=>{const action=button.dataset.homeAction;if(action==="share")return showShareQr();if(action==="zodiacPopup")return showZodiacDialog();if(action==="profile")return showProfileDialog(false);if(action==="aiWear")return openAiWear();if(action==="walletqr"){const panel=$("#walletPanel");if(!panel){state.tab="wallet";return render()}$(".site-home-frame")?.classList.add("hidden");panel.classList.remove("hidden");panel.scrollIntoView({behavior:"smooth",block:"start"});return showWalletQr("homeWalletQr","homeWalletExpire")}state.tab=action==="home"?"home":action==="daily"?"daily":action==="courses"?"courses":action==="card"?"card":action==="zodiac"?"zodiac":action==="cardCollection"?"cardCollection":action==="smartMatch"?"smartMatch":action==="calendar"?"calendar":action==="tasks"?"tasks":"wallet";await render()}));bindOfficialSiteLinks();bindBlogCards();$("#copyInvite")?.addEventListener("click",copyInvite);document.querySelectorAll("[data-close-share]").forEach((node)=>node.addEventListener("click",closeShareQr))}
async function mlmMemberPointBalance(fallbackBalance=0){
  try{
    mlmPointSyncError="";
    await initLiffOnce();
    if(!liff.isLoggedIn()){
      // klinkweb 的登入工作階段比 LINE ID Token 長。PC 瀏覽器再次開啟時
      // 可能仍可進會員中心，卻沒有可供 MLM 核對的 LIFF 身分，因而曾
      // 錯誤顯示本機點數。補做一次 LINE Login 後，PC/手機都以同一個
      // LINE UID 查詢康立智能 K 點。
      markLiffLoginPending();
      liff.login({redirectUri:liffLoginRedirectUrl()});
      return null;
    }
    const idToken=liff.getIDToken();
    const accessToken=liff.getAccessToken()||"";
    if(!idToken&&!accessToken){
      // PC 外部瀏覽器有時保留 LINE Login 狀態，卻已失去 ID Token。
      // isLoggedIn() 仍會回 true，所以必須主動登出再授權，不能退回
      // klinkweb 的本機餘額，否則就會和手機顯示不同。
      if(sessionStorage.getItem("klinkweb_point_reauth_attempted")!=="1"){
        sessionStorage.setItem("klinkweb_point_reauth_attempted","1");
        markLiffLoginPending();
        try{liff.logout();}catch{}
        liff.login({redirectUri:liffLoginRedirectUrl()});
        return null;
      }
      throw new Error("LINE 登入未提供 ID Token，無法核對康立智能 K點");
    }
    const payload=await api("/v1/points/mlm-balance",{method:"POST",body:JSON.stringify({idToken:idToken||"",accessToken})});
    if(!Number.isFinite(Number(payload.balance)))throw new Error("康立智能 K點讀取失敗");
    sessionStorage.removeItem("klinkweb_point_reauth_attempted");
    return {
      balance:Number(payload.balance),
      entries:Array.isArray(payload.entries)?payload.entries:[],
      ledgerSource:payload.ledgerSource||"mlm-mother-site",
    };
  }catch(error){
    console.warn("MLM member point sync failed",error);
    mlmPointSyncError=error?.message||"康立智能 K點同步失敗";
    return null;
  }
}
let youtubePlayerClose = null;
function closeYoutubePlayer() {
  if (youtubePlayerClose) {
    const close = youtubePlayerClose;
    youtubePlayerClose = null;
    close();
  } else {
    document.querySelector(".ak-youtube-dialog")?.remove();
    document.body.classList.remove("ak-youtube-playing");
  }
}
function showYoutubePlayer(video = {}) {
  const videoId = String(video.videoId || "");
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) return;
  closeYoutubePlayer();
  const dialog = document.createElement("section");
  const title = String(video.title || "A’kaffit YouTube 影片");
  dialog.className = "ak-youtube-dialog";
  dialog.innerHTML = `<div class="ak-youtube-backdrop" data-close-youtube></div><article class="ak-youtube-player-card" role="dialog" aria-modal="true" aria-labelledby="youtubePlayerTitle"><button type="button" class="ak-youtube-player-close" data-close-youtube aria-label="關閉影片">×</button><div class="ak-youtube-embed"><iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&amp;rel=0&amp;playsinline=1" title="${esc(title)}" loading="eager" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div><h3 id="youtubePlayerTitle">${esc(title)}</h3></article>`;
  const onKeydown = (event) => {
    if (event.key === "Escape") closeYoutubePlayer();
  };
  youtubePlayerClose = () => {
    dialog.remove();
    document.body.classList.remove("ak-youtube-playing");
    document.removeEventListener("keydown", onKeydown);
  };
  dialog.querySelectorAll("[data-close-youtube]").forEach((node) => node.addEventListener("click", closeYoutubePlayer));
  document.body.appendChild(dialog);
  document.body.classList.add("ak-youtube-playing");
  document.addEventListener("keydown", onKeydown);
  dialog.querySelector(".ak-youtube-player-close")?.focus();
}
async function loadAkaffitYoutube() {
  const panel = $(".ak-youtube-panel");
  if (!panel) return;
  panel.innerHTML = '<div class="ak-youtube-loading">YouTube 影片載入中…</div>';
  try {
    const data = await api("/v1/youtube/videos");
    const videos = Array.isArray(data.videos) ? data.videos : [];
    panel.innerHTML = `<header class="ak-youtube-head"><div><small>OFFICIAL YOUTUBE</small><h2>${esc(data.channel?.title || "Akaffit 咖啡")}</h2></div><a href="https://www.youtube.com/@akaffit" target="_blank" rel="noopener noreferrer">前往官方頻道 ↗</a></header>${videos.length ? `<div class="ak-youtube-grid">${videos.map((video, index) => `<button type="button" class="ak-youtube-card" data-youtube-index="${index}" aria-label="播放 ${esc(video.title)}"><span><img src="${esc(video.thumbnailUrl)}" alt="" loading="lazy"><i aria-hidden="true">▶</i></span><strong>${esc(video.title)}</strong></button>`).join("")}</div>` : '<p class="ak-youtube-empty">目前尚無公開影片。</p>'}`;
    panel.querySelectorAll("[data-youtube-index]").forEach((button) => button.addEventListener("click", () => {
      const video = videos[Number(button.dataset.youtubeIndex)];
      if (video) showYoutubePlayer(video);
    }));
  } catch (error) {
    panel.innerHTML = `<div class="ak-youtube-error"><strong>暫時無法載入 YouTube 影片</strong><a href="https://www.youtube.com/@akaffit" target="_blank" rel="noopener noreferrer">直接前往官方頻道 ↗</a></div>`;
  }
}

const homeToolIcons = {
  card: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4.5" width="18" height="15" rx="2.5"/><circle cx="8" cy="10" r="2"/><path d="M5.5 16c.4-2 1.2-3 2.5-3s2.1 1 2.5 3M13.5 9h4.5M13.5 13h4.5M13.5 16h3"/></svg>`,
  cardCollection: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="8.5" cy="11" r="2"/><path d="M5.8 16c.5-1.7 1.4-2.5 2.7-2.5s2.2.8 2.7 2.5M14 9h4M14 13h4M14 16h3"/></svg>`,
  daily: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="15" rx="2"/><path d="M7 3.5v4M17 3.5v4M3.5 9.5h17m-12 5 2.2 2.2 4.8-5"/></svg>`,
  smartMatch: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="9" r="3"/><circle cx="17" cy="8" r="2.5"/><path d="M2.8 19c.5-3.5 2.2-5.3 5.2-5.3s4.7 1.8 5.2 5.3M13.5 13.5c2.9-.7 5.9.9 6.7 4.5"/></svg>`,
  calendar: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="15" rx="2"/><path d="M7 3.5v4M17 3.5v4M3.5 9.5h17M8 13h1M12 13h1M16 13h1M8 17h1M12 17h1"/></svg>`,
  tasks: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 3v4M16 3v4M8 11h8M8 15h5"/><path d="m15.5 16.5 1.4 1.4 2.6-3"/></svg>`,
};

const goldenJourneySlideUrls = Array.from(
  { length:43 },
  (_, index) => `/assets/academy/golden-journey/slide-${String(index).padStart(2, "0")}.jpg`,
);
let goldenJourneyAutoTimer = null;
let goldenJourneyViewerClose = null;

function closeGoldenJourneyViewer() {
  goldenJourneyViewerClose?.();
}

function showGoldenJourneyViewer(slideIndex) {
  const index = Number(slideIndex);
  if (!Number.isInteger(index) || index < 0 || index >= goldenJourneySlideUrls.length) return;
  closeGoldenJourneyViewer();
  const dialog = document.createElement("section");
  dialog.className = "ak-golden-dialog";
  dialog.innerHTML = `<div class="ak-golden-dialog-backdrop" data-close-golden-viewer></div>
    <article class="ak-golden-viewer" role="dialog" aria-modal="true" aria-labelledby="goldenViewerTitle">
      <button type="button" class="ak-golden-viewer-close" data-close-golden-viewer aria-label="關閉放大投影片">×</button>
      <img class="ak-golden-viewer-image" src="${goldenJourneySlideUrls[index]}" alt="醇金之旅第 ${index + 1} 張投影片放大檢視">
      <footer><strong id="goldenViewerTitle">醇金之旅</strong><span>第 ${index + 1} 張，共 ${goldenJourneySlideUrls.length} 張</span></footer>
    </article>`;
  const onKeyDown = (event) => {
    if (event.key === "Escape") closeGoldenJourneyViewer();
  };
  goldenJourneyViewerClose = () => {
    document.removeEventListener("keydown", onKeyDown);
    dialog.remove();
    document.body.classList.remove("ak-golden-viewing");
    goldenJourneyViewerClose = null;
  };
  dialog.querySelectorAll("[data-close-golden-viewer]").forEach((button) => button.addEventListener("click", closeGoldenJourneyViewer));
  document.body.append(dialog);
  document.body.classList.add("ak-golden-viewing");
  document.addEventListener("keydown", onKeyDown);
  dialog.querySelector(".ak-golden-viewer-close")?.focus();
}

function goldenJourneyMarkup() {
  return `<div class="ak-academy-shell">
    <header class="ak-academy-heading"><div><small>COFFEE ACADEMY</small><h2>咖啡學院</h2></div><span>線上課程</span></header>
    <div class="ak-academy-course-tabs" role="tablist" aria-label="咖啡學院課程">
      <button type="button" role="tab" class="active" aria-selected="true" data-academy-course="golden-journey">醇金之旅</button>
    </div>
    <section class="ak-golden-journey" aria-label="醇金之旅線上簡報" data-golden-journey>
      <div class="ak-golden-stage">
        <button type="button" class="ak-golden-arrow is-prev" data-golden-prev aria-label="上一張投影片">‹</button>
        <div class="ak-golden-track" data-golden-track tabindex="0" aria-label="醇金之旅投影片，可左右滑動">
          ${goldenJourneySlideUrls.map((url, index) => `<button type="button" class="ak-golden-slide" data-golden-slide="${index}" aria-label="放大觀看第 ${index + 1} 張，共 ${goldenJourneySlideUrls.length} 張"><img src="${url}" alt="醇金之旅第 ${index + 1} 張投影片" loading="${index === 0 ? "eager" : "lazy"}" decoding="async"></button>`).join("")}
        </div>
        <button type="button" class="ak-golden-arrow is-next" data-golden-next aria-label="下一張投影片">›</button>
      </div>
      <footer class="ak-golden-footer"><strong data-golden-counter>1 / ${goldenJourneySlideUrls.length}</strong><span><b>點擊投影片可放大單獨觀看</b><small>左右滑動瀏覽・每 10 秒自動播放</small></span></footer>
    </section>
  </div>`;
}

function initGoldenJourney() {
  if (goldenJourneyAutoTimer) clearInterval(goldenJourneyAutoTimer);
  const root = document.querySelector("[data-golden-journey]");
  const track = root?.querySelector("[data-golden-track]");
  const counter = root?.querySelector("[data-golden-counter]");
  if (!root || !track || !counter) return;
  const panel = root.closest('[data-content-panel="academy"]');
  const count = goldenJourneySlideUrls.length;
  let index = 0;
  let scrollFrame = 0;
  let pointerStartX = 0;
  let pointerActive = false;
  let slideDragged = false;

  const updateCounter = () => { counter.textContent = `${index + 1} / ${count}`; };
  const goTo = (nextIndex, smooth = true) => {
    index = (nextIndex + count) % count;
    track.scrollTo({ left:index * track.clientWidth, behavior:smooth ? "smooth" : "auto" });
    updateCounter();
  };
  const startAutoPlay = () => {
    if (goldenJourneyAutoTimer) clearInterval(goldenJourneyAutoTimer);
    goldenJourneyAutoTimer = setInterval(() => {
      if (!root.isConnected) {
        clearInterval(goldenJourneyAutoTimer);
        goldenJourneyAutoTimer = null;
        return;
      }
      if (!document.hidden && !panel?.classList.contains("hidden")) goTo(index + 1);
    }, 10000);
  };
  const restartAutoPlay = () => startAutoPlay();

  root.querySelector("[data-golden-prev]")?.addEventListener("click", () => { goTo(index - 1); restartAutoPlay(); });
  root.querySelector("[data-golden-next]")?.addEventListener("click", () => { goTo(index + 1); restartAutoPlay(); });
  root.querySelectorAll("[data-golden-slide]").forEach((slide) => slide.addEventListener("click", () => {
    if (!slideDragged) showGoldenJourneyViewer(slide.dataset.goldenSlide);
    slideDragged = false;
  }));
  track.addEventListener("scroll", () => {
    cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(() => {
      if (!track.clientWidth) return;
      index = Math.max(0, Math.min(count - 1, Math.round(track.scrollLeft / track.clientWidth)));
      updateCounter();
    });
  }, { passive:true });
  track.addEventListener("pointerdown", (event) => {
    pointerStartX = event.clientX;
    pointerActive = true;
    slideDragged = false;
    if (goldenJourneyAutoTimer) clearInterval(goldenJourneyAutoTimer);
  }, { passive:true });
  track.addEventListener("pointermove", (event) => {
    if (pointerActive && Math.abs(event.clientX - pointerStartX) > 8) slideDragged = true;
  }, { passive:true });
  track.addEventListener("pointerup", () => { pointerActive = false; restartAutoPlay(); }, { passive:true });
  track.addEventListener("pointercancel", () => { pointerActive = false; restartAutoPlay(); }, { passive:true });
  track.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    goTo(index + (event.key === "ArrowRight" ? 1 : -1));
    restartAutoPlay();
  });
  startAutoPlay();
}

function homeTaskSummary(data, failed = false) {
  if (failed) return { failed:true, active:[], overdue:[], notice:"查看待辦" };
  const active = (Array.isArray(data?.tasks) ? data.tasks : [])
    .filter((task) => ["pending", "postponed"].includes(task.status))
    .sort((a, b) => {
      const aDue = Date.parse(a.dueAt), bDue = Date.parse(b.dueAt);
      const aTime = Number.isFinite(aDue) ? aDue : Number.MAX_SAFE_INTEGER;
      const bTime = Number.isFinite(bDue) ? bDue : Number.MAX_SAFE_INTEGER;
      const aOverdue = aTime < Date.now(), bOverdue = bTime < Date.now();
      return Number(bOverdue) - Number(aOverdue) || aTime - bTime;
    });
  const overdue = active.filter((task) => Date.parse(task.dueAt) < Date.now());
  const notice = overdue.length ? `${overdue.length} 項逾期` : active.length ? `${active.length} 項待辦` : "今日完成 ✓";
  return { failed:false, active, overdue, notice };
}
function homeTaskListMarkup(summary) {
  if (summary.failed) return `<div class="ak-task-empty"><strong>待辦暫時無法載入</strong><span>不影響首頁其他功能，稍後可前往任務中心查看。</span></div>`;
  if (!summary.active.length) return `<div class="ak-task-empty is-complete"><strong>今天的待辦已完成 ✓</strong><span>需要時可以到 AI 任務中心建立下一步。</span></div>`;
  return summary.active.slice(0, 3).map((task) => {
    const overdue = Date.parse(task.dueAt) < Date.now();
    return `<article class="ak-home-task${overdue ? " is-overdue" : ""}"><div><strong>${esc(task.title || "未命名任務")}</strong>${task.contactName ? `<span>名片｜${esc(task.contactName)}</span>` : ""}</div><time>${overdue ? "逾期・" : ""}${esc(taskDateLabel(task.dueAt))}</time></article>`;
  }).join("");
}
function bindHomeTaskToggle() {
  const panel = document.querySelector("[data-home-task-panel]");
  const detail = document.querySelector("[data-home-task-detail]");
  const toggles = document.querySelectorAll("[data-home-task-toggle]");
  if (!panel || !detail || !toggles.length) return;
  const setExpanded = (expanded) => {
    panel.classList.toggle("is-expanded", expanded);
    detail.hidden = !expanded;
    toggles.forEach((button) => button.setAttribute("aria-expanded", String(expanded)));
  };
  toggles.forEach((button) => button.addEventListener("click", () => setExpanded(!panel.classList.contains("is-expanded"))));
}

async function home() {
  const result = await Promise.allSettled([api("/v1/points/wallet"), api("/v1/tasks")]);
  const wallet = result[0].status === "fulfilled" ? result[0].value.wallet : { balance:0 };
  const taskSummary = homeTaskSummary(result[1].status === "fulfilled" ? result[1].value : null, result[1].status !== "fulfilled");

  const taskCount = taskSummary.failed ? "—" : String(taskSummary.active.length);
  const taskAlert = taskSummary.overdue.length ? " is-overdue" : "";
  layout(`<section class="ak-dashboard">
    <header class="ak-member-summary">
      <div class="ak-member-brand-row">
        <strong class="ak-wordmark">TDEA</strong>
        <button type="button" class="ak-member-avatar" data-home-action="profile" aria-label="開啟會員資料">${avatar()}</button>
        <button type="button" class="ak-task-notice${taskAlert}" data-home-task-toggle aria-expanded="false" aria-controls="homeTaskDetail">
          <svg class="ak-bell-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 9a5.5 5.5 0 0 1 11 0c0 6 2.5 6 2.5 7.5H4c0-1.5 2.5-1.5 2.5-7.5M9.5 20h5"/></svg>
          <span aria-live="polite">${esc(taskSummary.notice)}</span>
          <svg class="ak-task-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 9.5 5 5 5-5"/></svg>
        </button>
      </div>
      <div class="ak-member-actions">
        <button type="button" class="ak-point-card" data-home-action="wallet" aria-label="開啟有點開心點數錢包"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="m12 7 1.4 2.9 3.1.4-2.3 2.2.6 3.2-2.8-1.5-2.8 1.5.6-3.2-2.3-2.2 3.1-.4z"/></svg><strong>${format(wallet.balance)}</strong><span>點</span></button>
        <button type="button" class="ak-profile-card" data-home-action="profile" aria-label="開啟我的會員資料"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c.7-4.3 3-6.5 7-6.5s6.3 2.2 7 6.5"/></svg><span>我的</span></button>
        <button type="button" class="ak-destiny-card" data-home-action="zodiacPopup" aria-label="開啟星座命理"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.8 1.1 3.2 3.3.1-2.6 2 1 3.2-2.8-1.9-2.8 1.9 1-3.2-2.6-2 3.3-.1z"/><path d="M18.4 14.4a3.8 3.8 0 1 1-4.8 4.8 4.6 4.6 0 0 0 4.8-4.8Z"/></svg><span>星座命理</span></button>
        <button type="button" class="ak-qr-card" data-home-action="share" aria-label="開啟專屬分享 QR 碼"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM15 14h2v2h-2zM19 14h2v4h-2zM14 18h3v3h-3zM19 20h2v1h-2z"/></svg><span>專屬分享</span></button>
      </div>
    </header>
    <section class="ak-home-task-panel${taskAlert}" data-home-task-panel>
      <button type="button" class="ak-task-summary" data-home-task-toggle aria-expanded="false" aria-controls="homeTaskDetail"><span>今天要推進什麼？</span><b>${esc(taskCount)}</b><svg class="ak-task-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 9.5 5 5 5-5"/></svg></button>
      <div id="homeTaskDetail" class="ak-home-task-detail" data-home-task-detail hidden><div class="ak-home-task-list">${homeTaskListMarkup(taskSummary)}</div><button type="button" class="ak-task-all" data-home-action="tasks">查看全部任務</button></div>
    </section>
    <section class="ak-home-content">
      <div class="ak-frozen-nav">
        <div class="ak-feature-grid">
          <button data-home-action="cardCollection">${homeToolIcons.cardCollection}<span>名片收藏</span></button>
          <button type="button" data-home-inline="daily" aria-pressed="true">${homeToolIcons.daily}<span>每日簽到</span></button>
          <button data-home-action="smartMatch">${homeToolIcons.smartMatch}<span>智能配對</span></button>
          <button data-home-action="calendar">${homeToolIcons.calendar}<span>個人行程</span></button>
          <button data-home-action="tasks">${homeToolIcons.tasks}<span>AI 任務</span></button>
        </div>

      </div>
      <section id="homeDailyPanel" class="ak-daily-panel ak-content-panel" aria-label="每日簽到"></section>
  </section><section id="sharePanel" class="ak-share-dialog hidden" role="dialog" aria-modal="true" aria-labelledby="sharePanelTitle"><div class="ak-share-backdrop" data-close-share></div><article class="ak-share-card"><button type="button" class="ak-share-close" data-close-share aria-label="關閉專屬分享">×</button><h3 id="sharePanelTitle">專屬分享</h3><p class="muted">朋友掃描或開啟網址後，會帶入你的系統推薦關係。</p><div id="shareQr" class="qr"></div><p id="shareInviteUrl" class="share-invite-url" aria-label="推薦網址"></p><button class="btn alt" id="copyInvite">分享給 LINE 好友</button></article></section>`);
  bindHomeTaskToggle();
  const dailyButton = document.querySelector('[data-home-inline="daily"]');
  const dailyPanel = $("#homeDailyPanel");
  const openHomeDaily = async () => {
    dailyButton?.setAttribute("aria-pressed", "true");
    if (!dailyPanel) return;
    dailyPanel.innerHTML = '<div class="ak-inline-loading">簽到內容載入中…</div>';
    try {
      await daily("#homeDailyPanel");
    } catch (error) {
      dailyPanel.innerHTML = `<div class="ak-inline-error"><strong>簽到內容載入失敗</strong><p>${esc(error.message || "請稍後再試")}</p><button type="button" class="btn" data-retry-daily>重新載入</button></div>`;
      dailyPanel.querySelector("[data-retry-daily]")?.addEventListener("click", openHomeDaily);
    }
  };
  dailyButton?.addEventListener("click", openHomeDaily);
  openHomeDaily();

}
async function legacyHome() {
  const wallet = await api("/v1/points/wallet");
  const syncedPointSnapshot = await mlmMemberPointBalance(wallet.wallet.balance);
  const syncedPointText = syncedPointSnapshot == null ? (mlmPointSyncError ? "同步失敗" : "同步中…") : format(syncedPointSnapshot.balance);
  layout(
    `<section class="member-portal"><button type="button" class="portal-profile" data-home-action="profile" aria-label="開啟會員資料">${avatar()}<strong>會員專區</strong></button><div class="portal-primary" data-home-action="wallet"><div><span>康立智能 K點</span><strong>${syncedPointText}</strong></div></div><div class="portal-primary" data-home-action="share"><div><span>專屬 QR</span><strong>分享</strong></div></div></section>${portalMenu()}<section class="site-home-frame klink-mobile-home"><header class="klink-home-hero"><div class="klink-brand"><img src="data:image/png;base64,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" alt="康立全球 LiNK Logo"><div><b>康立全球</b><small>K-LINK GLOBAL</small></div></div><p>從健康生活、會員服務到數位工具，開啟你的康立智慧行動入口。</p><a href="${officialLiffUrl("home")}">前往康立官方網站 <span>↗</span></a></header><a class="klink-official-banner" href="${officialLiffUrl("home")}" aria-label="開啟康立官方網站"><img src="https://static.wixstatic.com/media/cbd8fa_dcb55697bcfd4ed9a50beded41e35b9d~mv2.png/v1/fill/w_2016,h_745,al_c,q_90,usm_0.66_1.00_0.01,enc_avif,quality_auto/%E9%87%91%E7%89%8C%E7%8D%8EFB-Banner.png" alt="康立全球金牌獎官方 Banner" loading="lazy"></a><div class="klink-home-grid"><a href="${officialLiffUrl("about")}"><i>01</i><b>走進康立</b><small>認識康立優勢與發展理念</small><span>›</span></a><a href="${officialLiffUrl("news")}"><i>02</i><b>最新訊息</b><small>掌握公告、活動與行事曆</small><span>›</span></a><a href="${officialLiffUrl("products")}"><i>03</i><b>產品總覽</b><small>瀏覽康立產品與計畫內容</small><span>›</span></a><a href="${officialLiffUrl("video")}"><i>04</i><b>影音專區</b><small>觀看品牌、產品與活動影片</small><span>›</span></a></div><section class="klink-home-philosophy"><small>K-LINK CULTURE</small><h2>5S × 3I 經營理念</h2><p>群策群力、與時俱進，透過前瞻策略、完善管理與創新工具，讓每位夥伴都能連結更大的事業舞台。</p><div><span>遠見</span><span>使命</span><span>表揚</span><span>感恩</span><span>歸屬</span></div></section></section><section id="sharePanel" class="card qr-card quick-panel hidden"><h3>我的推薦網址 QR 碼</h3><p class="muted">朋友掃描或開啟網址後，會帶入你的系統推薦關係。</p><div id="shareQr" class="qr"></div><p id="shareInviteUrl" class="share-invite-url" aria-label="推薦網址"></p><button class="btn alt" id="copyInvite">分享給 LINE 好友</button></section><section id="walletPanel" class="card qr-card quick-panel hidden"><h3>我的點數錢包 QR 碼</h3><p class="muted">供現場人員掃描識別；每次產生後 60 秒失效。</p><div id="homeWalletQr" class="qr"></div><p id="homeWalletExpire" class="muted small"></p></section>`,
  );
}
async function invite() {
  return api("/v1/invite-links", { method: "POST", body: "{}" });
}
function closeShareQr() {
  $("#sharePanel")?.classList.add("hidden");
}
async function showShareQr() {
  try {
    const r = await invite();
    const qr = $("#shareQr");
    const inviteUrl = $("#shareInviteUrl");
    if (!qr || !inviteUrl) throw new Error("分享區載入失敗，請重新整理後再試");
    const panel = $("#sharePanel");
    panel?.classList.remove("hidden");
    qr.innerHTML = "";
    new QRCode(qr, { text: r.invite.url, width: 210, height: 210 });
    qr.dataset.url = r.invite.url;
    inviteUrl.textContent = r.invite.url;
  } catch (error) {
    alert(error.message || "分享 QR 碼產生失敗");
  }
}
async function copyInvite() {
  try {
    const url = $("#shareQr").dataset.url || (await invite()).invite.url;
    const shareText = `TDEA 專屬分享\n${url}`;
    const lineShareUrl = `https://line.me/R/share?text=${encodeURIComponent(shareText)}`;
    let canUseLinePicker = false;
    try {
      if (window.liff && state.config?.liffId) {
        await initLiffOnce();
        canUseLinePicker = liff.isLoggedIn() && liff.isApiAvailable?.("shareTargetPicker");
      }
    } catch {
      canUseLinePicker = false;
    }
    if (canUseLinePicker) {
      try {
        const shared = await liff.shareTargetPicker([{ type:"text", text:shareText }]);
        if (shared !== false) alert("推薦網址已分享");
        return;
      } catch (error) {
        if (/cancel|abort/i.test(String(error?.message || ""))) return;
      }
    }
    window.location.assign(lineShareUrl);
  } catch (error) {
    if (!/cancel|abort/i.test(String(error?.message || ""))) alert(error.message || "推薦網址分享失敗");
  }
}
async function showWalletQr(qrId, expiryId) {
  const q = await api("/v1/points/wallet/qr", { method: "POST", body: "{}" });
  const node = $("#" + qrId);
  node.innerHTML = "";
  new QRCode(node, { text: q.qrPayload, width: 210, height: 210 });
  $("#" + expiryId).textContent = "QR Code 將於 60 秒後失效";
  setTimeout(() => {
    node.innerHTML = "";
    $("#" + expiryId).textContent = "QR Code 已失效，請重新產生";
  }, 60000);
}
async function wallet() {
  const r = await api("/v1/points/wallet");
  const syncedPointText = format(r.wallet.balance);
  const entries = (r.wallet.entries || []).map((entry) => ({
    event_type:pointEventLabel[entry.event_type] || entry.event_type || "有點開心",
    event_content:entry.activity_title || entry.referred_display_name || "",
    delta:Number(entry.delta || 0),
    balance_after:Number(entry.balance_after || 0),
    created_at:entry.created_at || "",
  }));
  const referrals = r.referrals || [];
  const regularEntries = entries;
  const regularRows = regularEntries.map((x) => {
    const delta = Number(x.delta || 0);
    const meta = [x.created_at, x.event_content, `餘額 ${format(x.balance_after)} 點`].filter(Boolean).join("｜");
    return `<div class="item wallet-entry"><div><b>${esc(x.event_type)}</b><span class="muted">${esc(meta)}</span></div><b class="wallet-delta ${delta < 0 ? "negative" : ""}">${delta > 0 ? "+" : ""}${delta}</b></div>`;
  }).join("");
  const entryRows = entries.length
    ? regularRows
    : '<p class="muted wallet-empty">目前尚無點數紀錄</p>';
  const referralRows = referrals.length
    ? referrals.map((x) => `<div class="item wallet-referral"><div><b>${esc(x.display_name || "新會員")}</b><span class="muted">會員編號：${esc(x.member_number || "尚未完成註冊")}</span></div><span class="muted">${esc(x.created_at)}</span></div>`).join("")
    : '<p class="muted wallet-empty">尚無邀約成功紀錄</p>';
  layout(
    `<div class="card"><div class="muted">有點開心</div><div class="points">${syncedPointText}</div><button class="btn" id="walletQr">顯示動態錢包 QR Code</button><div id="qr" class="qr"></div><p id="expire" class="muted small"></p></div>
    <details class="card wallet-disclosure"><summary><span>點數明細</span><span class="wallet-summary-meta">共 ${regularEntries.length} 筆 <i aria-hidden="true"></i></span></summary><div class="wallet-list">${entryRows}</div></details>
    <details class="card wallet-disclosure"><summary><span>分享成果清單</span><span class="wallet-summary-meta">共 ${referrals.length} 人 <i aria-hidden="true"></i></span></summary><div class="wallet-list">${referralRows}</div></details>`,
  );
  $("#walletQr").onclick = () => showWalletQr("qr", "expire");
}
async function courses() {
  const [all, mine] = await Promise.all([
    api("/v1/courses"),
    api("/v1/courses/my"),
  ]);
  const registered = new Set(mine.sessions.map((x) => x.sessionId));
  let scanNotice = "";
  if (state.courseSession) {
    const target = all.sessions.find((session) => session.sessionId === state.courseSession);
    if (target && !registered.has(target.sessionId)) {
      try {
        const result = await api(`/v1/course-sessions/${encodeURIComponent(target.sessionId)}/register`, { method:"POST", body:JSON.stringify({source:"calendar_qr"}) });
        registered.add(target.sessionId);
        scanNotice = result.duplicate ? "此課程已完成報名。" : `已完成「${target.title || target.courseTitle}」掃碼報名；點數將依課程報名規則入帳。`;
      } catch (error) { scanNotice = `掃碼報名失敗：${error.message}`; }
    } else if (!target) scanNotice = "此活動不存在或已下架。";
    state.courseSession = "";
    sessionStorage.removeItem("klinkweb_course_session");
    history.replaceState({}, "", `${location.pathname}?tab=courses`);
  }
  const formatCourseDate = (value) => new Intl.DateTimeFormat("zh-TW", { timeZone:"Asia/Taipei", month:"numeric", day:"numeric", weekday:"short" }).format(new Date(value));
  const formatCourseTime = (value) => new Intl.DateTimeFormat("zh-TW", { timeZone:"Asia/Taipei", hour:"2-digit", minute:"2-digit", hour12:false }).format(new Date(value));
  const formatRecordTime = (value) => value ? new Intl.DateTimeFormat("zh-TW", { timeZone:"Asia/Taipei", year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hour12:false }).format(new Date(value)) : "—";
  const activityHeader = `<div class="course-page-head"><h2>課程活動</h2><button class="course-record-tag ${state.courseView === "records" ? "active" : ""}" data-course-view="${state.courseView === "records" ? "catalog" : "records"}">${state.courseView === "records" ? "活動列表" : "課程紀錄"}</button></div>`;
  const statusOf = (session) => session.attendanceStatus === "verified" ? ["已完成", "completed"] : session.registrationStatus === "cancelled" ? ["已取消", "cancelled"] : ["已報名", "registered"];
  const records = mine.sessions.length
    ? `<section class="course-records">${mine.sessions.map((s) => { const [status, type] = statusOf(s); return `<article class="course-record-card"><div class="course-record-top"><div><small>場次紀錄</small><h3>${esc(s.courseTitle || s.title)}</h3></div><span class="course-status ${type}">${status}</span></div><p class="course-record-id">${esc(s.sessionId)}</p><div class="course-record-details"><div><span>活動日期</span><b>${esc(formatCourseDate(s.startsAt))}</b></div><div><span>活動時間</span><b>${esc(formatCourseTime(s.startsAt))}–${esc(formatCourseTime(s.endsAt))}</b></div><div><span>報名時間</span><b>${esc(formatRecordTime(s.registeredAt))}</b></div><div><span>${s.attendanceStatus === "verified" ? "簽到時間" : "報到狀態"}</span><b>${s.attendanceStatus === "verified" ? esc(formatRecordTime(s.attendanceAt)) : "尚未簽到"}</b></div></div></article>`; }).join("")}</section>`
    : '<div class="course-record-empty">目前還沒有報名任何課程</div>';
  const cards = all.sessions.length
    ? `<section class="course-grid">${all.sessions
        .map((s) => {
          const image = s.coverUrl
            ? `<img class="course-cover" src="${esc(s.coverUrl)}" alt="${esc(s.courseTitle)}">`
            : `<div class="course-cover course-cover-placeholder" aria-hidden="true"><span>✦</span></div>`;
          return `<article class="card course-card">${image}<div class="course-card-body"><h3>${esc(s.courseTitle || s.title)}</h3><p class="course-description">${esc(s.courseDescription || s.title || "活動說明將於現場提供")}</p><div class="course-card-footer"><div><strong>${esc(formatCourseDate(s.startsAt))}</strong><span>${esc(formatCourseTime(s.startsAt))}–${esc(formatCourseTime(s.endsAt))}</span></div><button class="btn" data-register="${s.sessionId}" ${registered.has(s.sessionId) ? "disabled" : ""}>${registered.has(s.sessionId) ? "已報名" : "我要報名"}</button></div></div></article>`;
        }).join("")}</section>`
    : '<div class="card muted">目前沒有公開課程</div>';
  layout(`${activityHeader}${scanNotice ? `<div class="notice">${esc(scanNotice)}</div>` : ""}${state.courseView === "records" ? records : cards}`);
  document.querySelector("[data-course-view]")?.addEventListener("click", async () => { state.courseView = document.querySelector("[data-course-view]").dataset.courseView; await courses(); });
  document.querySelectorAll("[data-register]").forEach(
    (x) =>
      (x.onclick = async () => {
        try {
          await withActionFeedback(x, () => api(`/v1/course-sessions/${x.dataset.register}/register`, {
              method: "POST",
              body: "{}",
            }), { busy:"報名中…", success:"已報名" });
          alert("報名成功");
          courses();
        } catch (e) {
          alert(e.message);
        }
      }),
  );
}
async function daily(targetSelector = "") {
  if (dailyRotationTimer) {
    clearInterval(dailyRotationTimer);
    dailyRotationTimer = null;
  }
  const getDailyRoot = () => targetSelector ? document.querySelector(targetSelector) : document;
  const renderDaily = (markup) => {
    if (!targetSelector) {
      layout(markup);
      return true;
    }
    const target = document.querySelector(targetSelector);
    if (!target) return false;
    target.innerHTML = markup;
    return true;
  };
  const panelTabs = `<div class="daily-top-tabs daily-panel-tabs" role="tablist" aria-label="TDEA 服務"><button type="button" class="daily-top-tab ${state.dailyPanel === "checkin" ? "active" : ""}" data-daily-panel="checkin">每日簽到</button><button type="button" class="daily-top-tab ${state.dailyPanel === "activities" ? "active" : ""}" data-daily-panel="activities">活動報名</button><button type="button" class="daily-top-tab ${state.dailyPanel === "ads" ? "active" : ""}" data-daily-panel="ads">廣告贈點</button></div>`;
  const renderTabs = (campaigns = []) => campaigns.length ? `<div class="daily-top-tabs daily-campaign-tabs" role="tablist" aria-label="簽到活動">${campaigns.map((campaign) => `<button type="button" class="daily-top-tab ${state.dailyCampaignId === campaign.id ? "active" : ""}" data-daily-campaign="${esc(campaign.id)}">${esc(campaign.name || "簽到活動")}</button>`).join("")}</div>` : "";
  const bindTabs = () => {
    getDailyRoot()?.querySelectorAll("[data-daily-panel]").forEach((button) => { button.onclick = () => { state.dailyPanel = button.dataset.dailyPanel || "checkin"; daily(targetSelector); }; });
    getDailyRoot()?.querySelectorAll("[data-daily-campaign]").forEach((button) => { button.onclick = () => { state.dailyPanel = "checkin"; state.dailyCampaignId = button.dataset.dailyCampaign; daily(targetSelector); }; });
  };
  if (state.dailyPanel !== "checkin") {
    try {
      const showcase = await api("/v1/tdea-showcase");
      const activities = Array.isArray(showcase.activities) ? showcase.activities : [];
      const ads = Array.isArray(showcase.ads) ? showcase.ads : [];
      const activityMarkup = activities.length ? `<section class="tdea-activity-carousel" aria-label="TDEA 活動報名，左右滑動瀏覽">${activities.map((activity) => `<article class="card tdea-activity-card"><div class="tdea-activity-poster">${activity.imageUrl ? `<img src="${esc(activity.imageUrl)}" alt="${esc(activity.title)}" loading="lazy">` : `<span>TDEA 活動</span>`}</div><div class="tdea-activity-copy"><small>${esc(activity.courseTime || "TDEA 活動")}</small><h2>${esc(activity.title)}</h2><p>${esc(activity.description || "活動資訊請見報名頁")}</p><footer>${activity.deadline ? `<span>報名截止：${esc(activity.deadline)}</span>` : ""}${activity.capacity ? `<span>名額：${esc(activity.capacity)}</span>` : ""}</footer>${activity.registrationUrl ? `<div class="tdea-activity-actions"><a class="btn alt" href="${esc(activity.registrationUrl)}" target="_blank" rel="noopener noreferrer">詳細說明</a><a class="btn" href="${esc(activity.registrationUrl)}" target="_blank" rel="noopener noreferrer">點我報名</a></div>` : ""}</div></article>`).join("")}</section>` : `<div class="card muted">目前沒有公開活動。</div>`;
      const adMarkup = ads.length ? `<section class="tdea-ad-carousel" aria-label="TDEA 廣告贈點">${ads.map((ad) => `<article class="tdea-ad-card"><img src="${esc(ad.imageUrl)}" alt="${esc(ad.title)}" loading="lazy"><div><strong>${esc(ad.title)}</strong><span>點擊廣告每日可獲 ${esc(ad.points)} 點</span>${showcase.adLiffUrl ? `<a class="btn" href="${esc(showcase.adLiffUrl)}" target="_blank" rel="noopener noreferrer">開啟廣告贈點</a>` : ""}</div></article>`).join("")}</section>` : `<div class="card muted">目前沒有啟用中的廣告贈點。</div>`;
      if (!renderDaily(`${panelTabs}${state.dailyPanel === "activities" ? activityMarkup : adMarkup}`)) return;
      bindTabs();
      const carousel = getDailyRoot()?.querySelector(".tdea-ad-carousel");
      if (carousel && ads.length > 1) dailyRotationTimer = setInterval(() => { if (document.visibilityState === "visible") carousel.scrollBy({ left:Math.max(180, carousel.clientWidth*.72), behavior:"smooth" }); }, 4000);
      return;
    } catch (error) {
      if (!renderDaily(`${panelTabs}<div class="card muted">${esc(error.message || "TDEA 內容暫時無法載入")}</div>`)) return;
      bindTabs(); return;
    }
  }
  const query = state.dailyCampaignId ? `?campaignId=${encodeURIComponent(state.dailyCampaignId)}` : "";
  const r = await api(`/v1/daily-ad${query}`);
  const campaigns = r.campaigns || [];
  if (!state.dailyCampaignId && r.campaign?.id) state.dailyCampaignId = r.campaign.id;
  if (!r.campaign && campaigns.length && state.dailyCampaignId) {
    state.dailyCampaignId = campaigns[0].id;
    return daily(targetSelector);
  }
  state.daily = { ...r, campaigns };
  const tabs = renderTabs(campaigns);
  if (!r.campaign) {
    if (!renderDaily(`${panelTabs}${tabs}<div class="card">今天沒有輪播簽到活動。</div>`)) return;
    bindTabs();
    return;
  }
  const completed = new Set(r.qualifiedCreativeIds || []);
  if (!r.creatives.length) {
    if (!renderDaily(`${panelTabs}${tabs}<div class="card">此輪播活動尚未設定素材。</div>`)) return;
    bindTabs();
    return;
  }
  const cards = [...r.creatives];
  if (r.campaign.rotationMode === "random") {
    for (let index = cards.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(Math.random() * (index + 1));
      [cards[index], cards[swap]] = [cards[swap], cards[index]];
    }
  }
  const cardHtml = (creative, index) => {
    const ratio = String(creative.image_aspect_ratio || "400:600").replace(":", " / ");
    const mode = creative.image_aspect_mode === "fit" ? "contain" : "cover";
    const bubbleWidths = { nano: "48%", micro: "56%", deca: "64%", hecto: "72%", kilo: "82%", mega: "92%", giga: "100%" };
    const bubbleWidth = bubbleWidths[creative.bubble_size] || bubbleWidths.nano;
    const detailLink = creative.image_link || creative.target_url;
    const media = `<div class="daily-media-frame" style="aspect-ratio:${esc(ratio)}"><${creative.creative_type === "video" ? "video controls playsinline preload=\"metadata\"" : "img"} class="daily-media" ${creative.creative_type === "video" ? `poster="${esc(creative.preview_url || "")}"` : `alt="${esc(creative.title || `第 ${index + 1} 頁`)}"`} src="${esc(creative.media_url)}" style="object-fit:${mode}"></${creative.creative_type === "video" ? "video" : "img"}></div>`;
    const extraButtons = (creative.buttons || []).filter((button) => button.type === "uri" && button.uri).map((button) => `<a class="btn alt link-btn" target="_blank" rel="noopener" href="${esc(button.uri)}" ${button.color ? `style="background:${esc(button.color)};color:#fff"` : ""}>${esc(button.label)}</a>`).join("");
    const detailButton = detailLink ? `<a class="btn alt detail-button" target="_blank" rel="noopener" href="${esc(detailLink)}">詳細<br>說明</a>` : `<button class="btn alt detail-button" data-detail="${esc(creative.id)}">詳細<br>說明</button>`;
    const watchLabel = completed.has(creative.id) ? "已完成" : "開始<br>觀看";
    return `<article class="daily-slide ${completed.has(creative.id) ? "complete" : ""}" data-creative-id="${esc(creative.id)}" style="--bubble-width:${bubbleWidth}">${media}<div class="daily-slide-body"><div class="daily-actions"><button class="btn watch-button" data-watch="${esc(creative.id)}" ${completed.has(creative.id) ? "disabled" : ""}>${watchLabel}</button>${detailButton}</div>${extraButtons ? `<div class="daily-extra-actions">${extraButtons}</div>` : ""}<p class="muted watch-status"></p></div></article>`;
  };
  if (!renderDaily(`${panelTabs}${tabs}<div class="daily-carousel" aria-label="每日輪播活動">${cards.map(cardHtml).join("")}</div><button class="btn ${r.checkedIn ? "alt" : ""}" id="checkin" ${!r.checkedIn && r.qualifiedCreativeCount < r.campaign.requiredCreativeCount ? "disabled" : ""}>${r.checkedIn ? "今日已簽到（確認點數）" : `今日簽到（已完成 ${r.qualifiedCreativeCount}/${r.campaign.requiredCreativeCount} 項）`}</button>`)) return;
  const dailyRoot = getDailyRoot();
  bindTabs();
  dailyRoot.querySelectorAll("[data-watch]").forEach((button) => {
    button.onclick = () => {
      const creative = r.creatives.find((item) => item.id === button.dataset.watch);
      if (creative) watchCreative(creative, button.closest(".daily-slide"), () => daily(targetSelector));
    };
  });
  dailyRoot.querySelectorAll("[data-detail]").forEach((button) => {
    button.onclick = () => {
      const creative = cards.find((item) => item.id === button.dataset.detail);
      if (!creative) return;
      const dialog = document.createElement("div");
      dialog.className = "media-dialog";
      dialog.innerHTML = `<div class="media-dialog-backdrop" data-close-detail></div><div class="media-dialog-panel" role="dialog" aria-modal="true" aria-label="詳細說明"><button class="media-dialog-close" data-close-detail aria-label="關閉">×</button>${creative.creative_type === "video" ? `<video controls playsinline autoplay src="${esc(creative.media_url)}"></video>` : `<img src="${esc(creative.media_url)}" alt="${esc(creative.title || "詳細說明")}">`}</div>`;
      dialog.querySelectorAll("[data-close-detail]").forEach((close) => { close.onclick = () => dialog.remove(); });
      document.body.append(dialog);
    };
  });
  const carousel = dailyRoot.querySelector(".daily-carousel");
  if (carousel && cards.length > 1) {
    let pausedUntil = 0;
    carousel.addEventListener("pointerdown", () => { pausedUntil = Date.now() + 9000; });
    carousel.addEventListener("scroll", () => { if (carousel.matches(":hover")) pausedUntil = Date.now() + 5000; }, { passive: true });
    dailyRotationTimer = setInterval(() => {
      if (document.visibilityState !== "visible" || Date.now() < pausedUntil) return;
      const next = carousel.scrollLeft + carousel.clientWidth * 0.86;
      if (next >= carousel.scrollWidth - carousel.clientWidth - 8) carousel.scrollTo({ left: 0, behavior: "smooth" });
      else carousel.scrollTo({ left: next, behavior: "smooth" });
    }, 4000);
  }
  const checkinButton = dailyRoot.querySelector("#checkin");
  checkinButton.onclick = async () => {
    const button = checkinButton;
    try {
      const x = await withActionFeedback(button, () => api("/v1/daily-ad/check-in", { method: "POST", body: JSON.stringify({ campaignId: r.campaign.id }) }), {busy:"簽到處理中…",success:"簽到完成"});
      const pointText = x.pointResult?.awarded ? "，點數已入帳" : x.pointResult?.duplicate ? "，點數已確認入帳" : x.pointResult?.reason === "no_active_rule" ? "，但後台尚未啟用「每日簽到」點數規則" : "";
      alert(x.duplicate ? `今天已簽到${pointText}` : `簽到成功${pointText || "，點數已依規則處理"}`);
      daily(targetSelector);
    } catch (e) {
      alert(e.message);
    }
  };
}
async function watchCreative(creative, card, refresh = daily) {
  const button = card?.querySelector(".watch-button");
  button.disabled = true;
  const status = card?.querySelector(".watch-status");
  try {
    const s = await api("/v1/daily-ad/view-sessions", {
      method: "POST",
      body: JSON.stringify({ creativeId: creative.id, campaignId: state.daily?.campaign?.id || state.dailyCampaignId }),
    });
    const required = Math.max(0, Number(creative.required_watch_seconds) || 0);
    const requiredRatio = creative.creative_type === "video" ? Math.max(0, Math.min(1, Number(creative.required_completion_ratio) || 0)) : 0;
    let watchedSeconds = 0;
    let settled = false;
    const timer = setInterval(async () => {
      if (settled) return;
      const media = card?.querySelector(".daily-media");
      const visiblyPlaying = document.visibilityState === "visible" && (creative.creative_type !== "video" || (media && !media.paused && !media.ended));
      if (visiblyPlaying) watchedSeconds += 1;
      const seconds = watchedSeconds;
      const ratio =
        creative.creative_type === "video" && media?.duration
          ? Math.min(1, media.currentTime / media.duration)
          : 1;
      const percent = Math.round(ratio * 100);
      status.textContent = creative.creative_type === "video" ? `觀看中 ${Math.min(seconds, required)} / ${required} 秒，影片 ${percent}% / ${Math.round(requiredRatio*100)}%` : `觀看中 ${Math.min(seconds, required)} / ${required} 秒`;
      if (seconds < required || ratio < requiredRatio || !visiblyPlaying) return;
      settled = true;
      try {
        const p = await api(`/v1/daily-ad/view-sessions/${s.token}/progress`, {
          method: "POST",
          body: JSON.stringify({
            watchedSeconds: seconds,
            completionRatio: ratio,
            pageVisible: true,
          }),
        });
        clearInterval(timer);
        if (p.qualified) {
          status.textContent = "此項完成，準備下一項…";
          setTimeout(refresh, 700);
        } else {
          settled = false;
          status.textContent = "請繼續觀看";
          button.disabled = false;
        }
      } catch (e) {
        clearInterval(timer);
        status.textContent = e.message;
        button.disabled = false;
      }
    }, 1000);
    if (creative.creative_type === "video")
      card?.querySelector(".daily-media")
        ?.play()
        .catch(() => {});
    setTimeout(() => clearInterval(timer), 600000);
  } catch (e) {
    status.textContent = e.message;
    button.disabled = false;
  }
}
function cardPublicUrl(cardId, card = null) {
  const url = new URL(`/c/${encodeURIComponent(cardId)}`, location.origin);
  if (card?.shareInvite) url.searchParams.set("invite", card.shareInvite);
  return url.toString();
}
function cardSharePickerUrl(cardId, card = null) {
  const liffId = state.config?.cardShareLiffId || state.config?.liffId;
  if (!liffId) return cardPublicUrl(cardId, card);
  const url = new URL(`https://liff.line.me/${encodeURIComponent(liffId)}/r/card-share`);
  url.searchParams.set("shareCardId", cardId);
  url.searchParams.set("share", "1");
  if (card?.shareInvite) url.searchParams.set("invite", card.shareInvite);
  return url.toString();
}
function cardLineShareUrl(cardId, card = null) {
  const name = String(card?.displayName || "A-KAFFIT TEAM 會員").trim();
  const text = `電子名片｜${name}\n${cardPublicUrl(cardId, card)}`;
  return `https://line.me/R/share?text=${encodeURIComponent(text)}`;
}
function cardActionItems(card) {
  const actions = [];
  const push = (label, type, value) => { if (value) actions.push({ label, type, value }); };
  push("撥打電話", "phone", card.mobile ? `tel:${card.mobile.replace(/[\s()-]/g, "")}` : "");
  push("寄送 Email", "email", card.email ? `mailto:${card.email}` : "");
  push("公司網站", "url", card.websiteUrl);
  push("加入 LINE", "line", card.lineUrl);
  push("查看地圖", "map", card.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(card.address)}` : "");
  (card.buttons || []).forEach((button) => push(button.label, button.type, button.value));
  const seen = new Set();
  return actions.filter((item) => item.label && item.value && !seen.has(`${item.label}:${item.value}`) && (seen.add(`${item.label}:${item.value}`), true));
}
const cardVersionMeta = {
  standard: { label:"標準", aspect:"20:13", className:"standard" },
  full: { label:"滿版", aspect:"2:3", className:"full" },
  square: { label:"正方", aspect:"1:1", className:"square" },
};
function activeCardVersion(card) {
  const id = card.selectedVersion && cardVersionMeta[card.selectedVersion] ? card.selectedVersion : "standard";
  return { id, ...(card.versions?.[id] || {}), ...(cardVersionMeta[id] || cardVersionMeta.standard) };
}
function cardWithVersion(card, id) {
  const version = { ...(card.versions?.[id] || {}), ...(cardVersionMeta[id] || cardVersionMeta.standard) };
  return { ...card, selectedVersion:id, coverUrl:version.coverUrl || "", buttons:version.buttons || [], serviceDescription:version.description || card.serviceDescription, serviceTextAlign:version.serviceTextAlign || card.serviceTextAlign || "left", descriptionTextAlign:version.descriptionTextAlign || card.descriptionTextAlign || "left", versionTitle:version.title || card.displayName, version };
}
function cardFlex(card) {
  const action = (label, uri, color = "#B96072") => ({ type:"button", style:"primary", height:"sm", color, action:{ type:"uri", label:String(label).slice(0,20), uri } });
  const version = activeCardVersion(card);
  const metaFields = [
    card.companyName,
    [card.jobTitle, card.department].filter(Boolean).join("｜"),
  ].filter(Boolean).join("\n");
  const serviceAlign = ({ left:"start", center:"center", right:"end" })[card.descriptionTextAlign || card.serviceTextAlign] || "start";
  const bodyContents = [
    { type:"text", text:card.versionTitle || card.displayName || "A-KAFFIT TEAM 會員", weight:"bold", size:"xl", color:"#2A2030", align:"center", wrap:true },
    ...(card.englishName ? [{ type:"text", text:card.englishName, size:"sm", color:"#857581", margin:"sm", align:"center", wrap:true }] : []),
    ...(metaFields ? [{ type:"text", text:metaFields, size:"sm", color:"#5E5260", align:"center", wrap:true, margin:"md", maxLines:2 }] : []),
    ...(card.serviceDescription ? [{ type:"text", text:card.serviceDescription, size:"sm", color:"#5E5260", align:serviceAlign, wrap:true, margin:"md", maxLines:4 }] : []),
  ];
  // 分享 Flex 的按鈕必須與「底部按鈕設定」完全同一份資料，
  // 不再混入系統自動產生的聯絡按鈕，避免預覽和實際訊息不同。
  const actions = (card.buttons || []).filter((button) => button?.enabled !== false && button?.label && button?.value).slice(0, 4);
  return {
    type:"bubble", size:version.id === "full" ? "giga" : "mega",
    ...(card.coverUrl ? { hero:{ type:"image", url:card.coverUrl, size:"full", aspectRatio:version.aspect, aspectMode:"cover", action:{type:"uri",uri:FIXED_CARD_IMAGE_LINK} } } : {}),
    header:{ type:"box", layout:"horizontal", justifyContent:"space-between", alignItems:"center", paddingAll:"8px", contents:[
      { type:"box", layout:"vertical", flex:1, contents:[] },
      { type:"box", layout:"vertical", justifyContent:"center", backgroundColor:"#EF4444", width:"65px", height:"25px", cornerRadius:"25px", contents:[
        { type:"text", text:"分享", weight:"bold", align:"center", color:"#FFFFFF", size:"xs" }
      ], action:{ type:"uri", uri:cardSharePickerUrl(card.id, card) } }
    ] },
    body:{ type:"box", layout:"vertical", paddingAll:"18px", contents:bodyContents },
    footer:{ type:"box", layout:"vertical", spacing:"sm", contents:
      actions.map((item) => action(item.label, item.value, item.color || "#B96072")),
    },
  };
}
function collectedCardFlex(card, shareUrl, hasImage = false) {
  const selectedId = cardVersionMeta[card.selectedVersion] ? card.selectedVersion : "standard";
  const selected = cardWithVersion(card, selectedId);
  card = { ...card, ...selected, coverUrl:selected.coverUrl, buttons:selected.buttons };
  const clean = (value, max = 300) => String(value || "").trim().slice(0, max);
  const validWebUrl = (value) => /^https:\/\//i.test(clean(value, 2048)) ? clean(value, 2048) : "";
  const button = (label, uri, color = "#B96072") => ({
    type:"button", style:"primary", height:"sm", color,
    action:{ type:"uri", label:String(label).slice(0,20), uri },
  });
  const displayName = clean(card.displayName, 80) || "未命名名片";
  const position = [clean(card.jobTitle, 80), clean(card.department, 80)].filter(Boolean).join("｜");
  const contactLines = [
    card.mobile ? `手機｜${clean(card.mobile, 50)}` : "",
    card.email ? `Email｜${clean(card.email, 120)}` : "",
    card.address ? `地址｜${clean(card.address, 160)}` : "",
  ].filter(Boolean).join("\n");
  const bodyContents = [
    { type:"text", text:displayName, weight:"bold", size:"xl", color:"#2A2030", wrap:true, margin:"sm" },
    ...(card.englishName ? [{ type:"text", text:clean(card.englishName, 80), size:"sm", color:"#857581", wrap:true, margin:"xs" }] : []),
    ...(card.companyName ? [{ type:"text", text:clean(card.companyName, 120), weight:"bold", size:"md", color:"#493E48", wrap:true, margin:"md" }] : []),
    ...(position ? [{ type:"text", text:position, size:"sm", color:"#5E5260", wrap:true, margin:"xs" }] : []),
    ...(card.serviceDescription ? [{ type:"text", text:clean(card.serviceDescription, 500), size:"sm", color:"#5E5260", wrap:true, margin:"md", maxLines:4 }] : []),
    ...(contactLines ? [{ type:"separator", margin:"lg" }, { type:"text", text:contactLines, size:"xs", color:"#6F626D", wrap:true, margin:"lg", maxLines:5 }] : []),
  ];
  const actions = [
    { label:"查看完整名片", uri:shareUrl, color:"#B96072" },
    ...(card.buttons || []).filter((item) => item?.enabled !== false && item.label && item.value).map((item) => ({ label:item.label, uri:item.value, color:item.color || "#B96072" })),
  ].slice(0, 4);
  let imageUrl = "";
  if (hasImage) {
    try {
      const token = new URL(shareUrl).pathname.split("/").filter(Boolean).pop();
      if (token) imageUrl = `${location.origin}/v1/card-collection/shared/${encodeURIComponent(token)}/image`;
    } catch {}
  }
  return {
    type:"bubble", size:"mega",
  ...((card.coverUrl || imageUrl) ? { hero:{ type:"image", url:card.coverUrl || imageUrl, size:"full", aspectRatio:selectedId === "full" ? "2:3" : selectedId === "square" ? "1:1" : "20:13", aspectMode:"cover", action:{type:"uri",uri:shareUrl} } } : {}),
    body:{ type:"box", layout:"vertical", paddingAll:"20px", contents:bodyContents },
    footer:{ type:"box", layout:"vertical", spacing:"sm", contents:actions.map((item) => button(item.label, item.uri, item.color)) },
  };
}
function rememberPendingCollectedShare(card, current = card) {
  state.pendingCollectedShare = { id:card.id, hasImage:Boolean(card.hasImage), card:{ ...current, note:"" } };
  sessionStorage.setItem("klinkweb_pending_collected_share", JSON.stringify(state.pendingCollectedShare));
}
function clearPendingCollectedShare() {
  state.pendingCollectedShare = null;
  sessionStorage.removeItem("klinkweb_pending_collected_share");
  sessionStorage.removeItem("klinkweb_collected_share_reauth");
}
async function beginCollectedCardShare(card, current) {
  rememberPendingCollectedShare(card, current);
  await resumePendingCollectedShare();
}
async function resumePendingCollectedShare() {
  const pending = state.pendingCollectedShare;
  if (!pending?.id) return;
  let keepPending = false;
  try {
    await initLiffOnce();
    if (!liff.isLoggedIn()) {
      keepPending = true;
      markLiffLoginPending();
      liff.login({ redirectUri:liffLoginRedirectUrl() });
      return;
    }
    if (!liff.isApiAvailable?.("shareTargetPicker")) throw new Error("ShareTargetPicker is not allowed in this LIFF app");
    const result = await api(`/v1/card-collection/${encodeURIComponent(pending.id)}/share`, { method:"POST", body:"{}" });
    const card = pending.card || {};
    const shared = await liff.shareTargetPicker([{
      type:"flex",
      altText:`電子名片｜${String(card.displayName || result.share.displayName || "未命名名片").slice(0,100)}`,
      contents:collectedCardFlex(card, result.share.url, pending.hasImage),
    }]);
    if (shared !== false) alert("電子名片已分享");
  } catch (error) {
    const permissionError = /not allowed|not available|shareTargetPicker/i.test(String(error?.message || ""));
    const alreadyRetried = sessionStorage.getItem("klinkweb_collected_share_reauth") === "1";
    if (permissionError && !alreadyRetried) {
      keepPending = true;
      sessionStorage.setItem("klinkweb_collected_share_reauth", "1");
      markLiffLoginPending();
      alert("LINE 分享權限已更新，將重新登入並自動繼續分享。");
      try { if (liff.isLoggedIn()) liff.logout(); } catch {}
      location.replace(cleanLiffRedirectUrl());
      return;
    }
    if (permissionError) alert("仍無法使用 LINE 分享。請確認 LIFF 已啟用 Share Target Picker，並已同意其使用條款。");
    else if (!/cancel/i.test(String(error?.message || ""))) alert(error.message || "名片分享失敗");
  } finally {
    if (!keepPending) clearPendingCollectedShare();
  }
}
async function compressCardImage(file) {
  if (!file?.type?.startsWith("image/")) throw new Error("請選擇圖片檔案");
  const source = await createImageBitmap(file);
  try {
    let smallest = null;
    for (const maxSide of [1600, 1280, 1024, 800, 640, 512]) {
      const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(source.width * scale));
      canvas.height = Math.max(1, Math.round(source.height * scale));
      const context = canvas.getContext("2d");
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.84, 0.72, 0.60, 0.48, 0.36]) {
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
        if (!blob) continue;
        if (!smallest || blob.size < smallest.size) smallest = blob;
        // 優先保留畫質：可達原本目標時即停止；否則仍使用最小壓縮結果上傳。
        if (blob.size <= 900 * 1024) return new File([blob], "card-cover.webp", { type:"image/webp" });
      }
    }
    if (!smallest) throw new Error("圖片壓縮失敗，請改用其他圖片");
    return new File([smallest], "card-cover.webp", { type:"image/webp" });
  } finally {
    source.close?.();
  }
}
async function uploadCardImage(file) {
  const compressed = await compressCardImage(file);
  const form = new FormData(); form.append("image", compressed);
  const response = await fetch("/v1/cards/me/media", { method:"POST", headers:state.token ? { authorization:`Bearer ${state.token}` } : {}, body:form });
  const body = await response.json(); if (!response.ok) throw new Error(body.error || "圖片上傳失敗"); return body.url;
}
let cardCropper = null;
function ensureCardCropperModal() {
  let modal = $("#cardCropperModal");
  if (modal) return modal;
  document.body.insertAdjacentHTML("beforeend", `<div class="card-cropper-modal" id="cardCropperModal" role="dialog" aria-modal="true"><div class="card-cropper-sheet"><div class="card-cropper-head"><strong>裁切封面圖片</strong><button type="button" id="closeCardCropper">×</button></div><div class="card-cropper-stage"><img id="cardCropperImage" alt="裁切圖片"></div><div class="card-cropper-tools"><button type="button" data-crop-action="zoom-out">縮小</button><button type="button" data-crop-action="zoom-in">放大</button><button type="button" data-crop-action="rotate">旋轉</button><button type="button" data-crop-action="reset">重設</button></div><div class="card-cropper-actions"><button type="button" class="btn alt" id="cancelCardCropper">取消</button><button type="button" class="btn" id="confirmCardCropper">確認裁切</button></div></div></div>`);
  return $("#cardCropperModal");
}
async function openCardCropper(file, versionId, afterUpload = null) {
  if (!window.Cropper) throw new Error("裁切器載入失敗，請確認網路後重新開啟頁面");
  if (!file?.type?.startsWith("image/")) throw new Error("請選擇圖片檔案");
  const modal = ensureCardCropperModal(); const image = $("#cardCropperImage");
  modal.querySelector(".card-cropper-head strong").textContent="裁切封面圖片";
  const ratio = cardVersionMeta[versionId]?.aspect || "20:13"; const [width,height] = ratio.split(":").map(Number);
  const close = () => { cardCropper?.destroy(); cardCropper=null; URL.revokeObjectURL(image.src); modal.classList.remove("open"); };
  $("#closeCardCropper").onclick = close; $("#cancelCardCropper").onclick = close;
  modal.classList.add("open"); image.src = URL.createObjectURL(file);
  await new Promise((resolve,reject) => { image.onload=resolve; image.onerror=reject; });
  cardCropper?.destroy(); cardCropper = new Cropper(image, { aspectRatio:width / height, viewMode:1, dragMode:"move", autoCropArea:.92, cropBoxMovable:true, cropBoxResizable:true, zoomable:true, zoomOnTouch:true, zoomOnWheel:true, movable:true, responsive:true, background:false, guides:true, center:true, highlight:false });
  modal.querySelectorAll("[data-crop-action]").forEach((button) => button.onclick = () => { const action=button.dataset.cropAction; if (action === "zoom-in") cardCropper.zoom(.1); if (action === "zoom-out") cardCropper.zoom(-.1); if (action === "rotate") cardCropper.rotate(90); if (action === "reset") cardCropper.reset(); });
  $("#confirmCardCropper").onclick = async () => { try { const button=$("#confirmCardCropper"); button.disabled=true; button.textContent="處理中"; const size = versionId === "full" ? {width:900,height:1350} : versionId === "square" ? {width:1000,height:1000} : {width:1200,height:780}; const canvas=cardCropper.getCroppedCanvas({ ...size, imageSmoothingEnabled:true, imageSmoothingQuality:"high" }); const blob=await new Promise((resolve)=>canvas.toBlob(resolve,"image/webp",.86)); if (!blob) throw new Error("圖片裁切失敗"); const imageUrl=await uploadCardImage(new File([blob],"card-cover.webp",{type:"image/webp"})); const coverInput=$("#my-v1-img-url") || $("#cardVersionCover"); coverInput.value=imageUrl; coverInput.dispatchEvent(new Event("input", { bubbles:true })); if (typeof afterUpload === "function") await afterUpload(imageUrl); close(); alert("圖片已裁切並儲存"); } catch(error) { alert(error.message); } finally { const button=$("#confirmCardCropper"); if (button) { button.disabled=false; button.textContent="確認裁切"; } } };
}
async function cropCollectionScanImage(file, sideLabel = "正面") {
  if (!window.Cropper) throw new Error("裁切器載入失敗，請確認網路後重新開啟頁面");
  if (!file?.type?.startsWith("image/")) throw new Error("請選擇圖片檔案");
  const modal=ensureCardCropperModal(); const image=$("#cardCropperImage"); const objectUrl=URL.createObjectURL(file);
  modal.querySelector(".card-cropper-head strong").textContent=`裁切名片${sideLabel}`;
  image.alt=`名片${sideLabel}裁切預覽`; modal.classList.add("open"); image.src=objectUrl;
  try { await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error("名片圖片讀取失敗"));}); }
  catch(error) { URL.revokeObjectURL(objectUrl);modal.classList.remove("open");throw error; }
  cardCropper?.destroy();
  cardCropper=new Cropper(image,{viewMode:1,dragMode:"move",autoCropArea:.9,cropBoxMovable:true,cropBoxResizable:true,zoomable:true,zoomOnTouch:true,zoomOnWheel:true,movable:true,responsive:true,background:false,guides:true,center:true,highlight:false});
  modal.querySelectorAll("[data-crop-action]").forEach((button)=>button.onclick=()=>{const action=button.dataset.cropAction;if(action==="zoom-in")cardCropper.zoom(.1);if(action==="zoom-out")cardCropper.zoom(-.1);if(action==="rotate")cardCropper.rotate(90);if(action==="reset")cardCropper.reset();});
  return new Promise((resolve)=>{
    let settled=false;
    const finish=(value)=>{if(settled)return;settled=true;cardCropper?.destroy();cardCropper=null;URL.revokeObjectURL(objectUrl);modal.classList.remove("open");resolve(value);};
    $("#closeCardCropper").onclick=()=>finish(null); $("#cancelCardCropper").onclick=()=>finish(null);
    $("#confirmCardCropper").onclick=async()=>{const button=$("#confirmCardCropper");try{button.disabled=true;button.textContent="裁切中…";const canvas=cardCropper.getCroppedCanvas({maxWidth:2000,maxHeight:2000,imageSmoothingEnabled:true,imageSmoothingQuality:"high"});const blob=await new Promise((done)=>canvas.toBlob(done,"image/webp",.9));if(!blob)throw new Error("名片裁切失敗");finish(new File([blob],`business-card-${sideLabel === "背面" ? "back" : "front"}.webp`,{type:"image/webp"}));}catch(error){alert(error.message||"名片裁切失敗");}finally{if(button.isConnected){button.disabled=false;button.textContent="確認裁切";}}};
  });
}
async function prepareCardLiff() {
  await initLiffOnce();
  if (!liff.isLoggedIn()) {
    liff.login({ redirectUri: cleanLiffRedirectUrl() });
    return false;
  }
  return true;
}
async function sharePersonalCard(card) {
  if (state.config?.cardShareLiffId && state.config.cardShareLiffId !== state.config.liffId && !state.cardShareMode) {
    location.assign(cardSharePickerUrl(card.id, card));
    return;
  }
  // PC 外部瀏覽器同樣由官方 SDK 透過 OTT 開啟通訊錄；
  // 不能以 isInClient() 判斷，也不能手動拼接分享網址。
  state.pendingCardShareId = card.id;
  sessionStorage.setItem("klinkweb_pending_card_share_id", card.id);
  await resumePendingCardShare();
}
function clearPendingCardShare() {
  state.pendingCardShareId = "";
  sessionStorage.removeItem("klinkweb_pending_card_share_id");
}
async function resumePendingCardShare() {
  let redirectedToLogin = false;
  try {
    await initLiffOnce();
    if (!liff.isLoggedIn()) {
      redirectedToLogin = true;
      liff.login({ redirectUri: cleanLiffRedirectUrl() });
      return;
    }
    if (!liff.isApiAvailable?.("shareTargetPicker")) throw new Error("此 LINE 環境未提供分享通訊錄。請在 LINE Developers 的 LIFF 設定啟用 shareTargetPicker，並從 LINE 開啟此 LIFF。");
    const result = await api(`/v1/cards/${encodeURIComponent(state.pendingCardShareId)}/public`);
    const shared = await liff.shareTargetPicker([{ type:"flex", altText:cardChatAltText(result.card), contents:cardFlex(result.card) }]);
    if (shared !== false) alert("名片已送出");
  } catch (error) {
    // 後台剛啟用 shareTargetPicker 時，舊的 LINE access token 仍可能沒有新權限。
    // 清除舊 token 後由下一次載入重新登入，讓 SDK 取得新的 OTT/權限。
    if (/not allowed|not available|shareTargetPicker/i.test(String(error?.message || ""))) {
      alert("LINE 分享權限已更新，將重新登入後再開啟通訊錄。");
      redirectedToLogin = true; // 保留 pendingCardShareId，重載後會自動續接分享。
      try { if (liff.isLoggedIn()) liff.logout(); } catch {}
      location.replace(cleanLiffRedirectUrl());
      return;
    }
    alert(error.message || "無法開啟名片分享通訊錄");
  } finally {
    if (!redirectedToLogin) clearPendingCardShare();
  }
}
function clearCardShareMode() {
  state.cardShareId = "";
  state.cardShareMode = false;
  sessionStorage.removeItem("klinkweb_card_share_id");
  sessionStorage.removeItem("klinkweb_card_share_mode");
  const url = new URL(location.href);
  url.searchParams.delete("shareCardId");
  url.searchParams.delete("share");
  history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}
async function shareCardFromHeader() {
  const cardId = state.cardShareId;
  let redirectedToLogin = false;
  let pickerFinished = false;
  let lineShareFallbackUrl = "";
  let publicCardResult = null;
  try {
    if (!await prepareCardLiff()) { redirectedToLogin = true; return; }
    publicCardResult = await api(`/v1/cards/${encodeURIComponent(cardId)}/public`);
    if (!liff.isApiAvailable?.("shareTargetPicker")) {
      lineShareFallbackUrl = cardLineShareUrl(cardId, publicCardResult.card);
      return;
    }
    await liff.shareTargetPicker([{ type:"flex", altText:cardChatAltText(publicCardResult.card), contents:cardFlex(publicCardResult.card) }]);
    pickerFinished = true; // 完成或取消都不要落回會員中心。
  } catch (error) {
    if (/not allowed|not available|shareTargetPicker/i.test(String(error?.message || ""))) {
      lineShareFallbackUrl = cardLineShareUrl(cardId, publicCardResult?.card);
      return;
    }
    alert(error.message || "無法開啟名片分享通訊錄");
  } finally {
    if (!redirectedToLogin) clearCardShareMode();
    if (lineShareFallbackUrl) {
      location.replace(lineShareFallbackUrl);
    } else if (pickerFinished) {
      // 手機 LINE：回到原聊天訊息；PC 外部瀏覽器：保留公開名片頁。
      if (liff.isInClient?.()) {
        try { liff.closeWindow(); } catch {}
      } else {
        state.publicCard = cardId;
        history.replaceState({}, "", `/c/${encodeURIComponent(cardId)}`);
        await publicCard();
      }
    }
  }
}
async function sendPersonalCardToChat(card) {
  if (!await prepareCardLiff()) return;
  if (!liff.isInClient?.()) throw new Error("請從 LINE 聊天室內開啟會員中心，才能直接傳送到目前聊天室");
  try {
    const permission = await liff.permission?.query?.("chat_message.write");
    if (permission?.state !== "granted") {
      await liff.permission?.requestAll?.();
      const refreshed = await liff.permission?.query?.("chat_message.write");
      if (refreshed?.state && refreshed.state !== "granted") throw new Error("未授權聊天室傳送權限");
    }
  } catch (error) {
    if (error.message) throw error;
  }
  if (typeof liff.sendMessages !== "function") throw new Error("此 LINE 環境不支援聊天室傳送");
  await liff.sendMessages([{ type:"flex", altText:cardChatAltText(card), contents:cardFlex(card) }]);
  alert("已傳送到目前聊天室");
}
function cardContactRows(card) {
  const fields = [
    ["公司名稱", card.companyName], ["職稱", card.jobTitle], ["部門", card.department],
    ["手機號碼", card.mobile], ["公司電話", card.companyPhone], ["電子郵件", card.email],
    ["公司網站", card.websiteUrl], ["LINE", card.lineUrl], ["公司地址", card.address], ["服務項目", card.serviceDescription],
  ].filter(([, value]) => value);
  return fields.length ? fields.map(([label,value]) => `<article class="business-card-field"><small>${esc(label)}</small><p>${esc(value)}</p></article>`).join("") : '<p class="muted">尚未填寫聯絡資料。</p>';
}
function customButtonEditor(button = {}, index = 0) {
  const color = /^#[0-9a-f]{6}$/i.test(button.color || "") ? button.color : "#B96072";
  return `<article class="card-button-editor" data-card-button-row><div class="card-button-editor-head"><strong>按鈕 ${index + 1}</strong><div><button type="button" data-move-card-button="-1" aria-label="上移">↑</button><button type="button" data-move-card-button="1" aria-label="下移">↓</button><button type="button" class="card-button-remove" data-remove-card-button>刪除</button></div></div><label>按鈕顏色<span class="card-colour-control"><input data-card-button-color-picker type="color" value="${esc(color)}"><input data-card-button-color value="${esc(color)}" placeholder="#B96072"></span></label><label>按鈕文字<input data-card-button-label placeholder="例如：加入 LINE 好友" value="${esc(button.label || "")}"></label><label>連結類型<select data-card-button-type><option value="url" ${button.type === "url" ? "selected" : ""}>網站連結</option><option value="phone" ${button.type === "phone" ? "selected" : ""}>電話</option><option value="email" ${button.type === "email" ? "selected" : ""}>Email</option><option value="line" ${button.type === "line" ? "selected" : ""}>LINE 連結</option><option value="map" ${button.type === "map" ? "selected" : ""}>地圖</option></select></label><label>網址／電話／LINE 連結<input data-card-button-value placeholder="https://... 或 tel:0927..." value="${esc(String(button.value || "").replace(/^(tel:|mailto:)/, ""))}"></label></article>`;
}
function collectCardButtons() {
  return Array.from(document.querySelectorAll("[data-card-button-row]")).map((row) => ({
    label: row.querySelector("[data-card-button-label]")?.value || "",
    type: row.querySelector("[data-card-button-type]")?.value || "url",
    value: row.querySelector("[data-card-button-value]")?.value || "",
    color: row.querySelector("[data-card-button-color]")?.value || "",
  })).filter((button) => button.label || button.value);
}
function bindCardButtonEditor(onChange = null) {
  const redraw = () => { if (typeof onChange === "function") onChange(); };
  document.querySelectorAll("[data-remove-card-button]").forEach((button) => button.onclick = () => { button.closest("[data-card-button-row]")?.remove(); redraw(); });
  document.querySelectorAll("[data-move-card-button]").forEach((button) => button.onclick = () => { const row=button.closest("[data-card-button-row]"); const sibling=Number(button.dataset.moveCardButton) < 0 ? row?.previousElementSibling : row?.nextElementSibling; if (row && sibling?.matches("[data-card-button-row]")) Number(button.dataset.moveCardButton) < 0 ? sibling.before(row) : sibling.after(row); redraw(); });
  document.querySelectorAll("[data-card-button-color-picker]").forEach((picker) => picker.oninput = () => { const field=picker.parentElement.querySelector("[data-card-button-color]"); if(field) field.value=picker.value; redraw(); });
  document.querySelectorAll("[data-card-button-row] input,[data-card-button-row] select").forEach((field) => field.oninput = redraw);
  $("#addCardButton")?.addEventListener("click", () => {
    const holder = $("#cardButtonRows");
    if (!holder || holder.querySelectorAll("[data-card-button-row]").length >= 4) return alert("最多可設定 4 個自訂按鈕");
    holder.insertAdjacentHTML("beforeend", customButtonEditor({}, holder.querySelectorAll("[data-card-button-row]").length));
    bindCardButtonEditor(onChange); redraw();
  });
}
function renderDigitalCardPreview(card, selected) {
  const holder = $("#cardLivePreview"); if (!holder) return;
  const coverUrl = $("#cardVersionCover")?.value.trim() || "";
  const title = $("#cardVersionTitle")?.value.trim() || card.displayName || "A-KAFFIT TEAM 會員";
  const description = $("#cardVersionDescription")?.value.trim() || card.serviceDescription || "";
  const buttons = collectCardButtons();
  holder.className = `ecard-preview-card ${esc(selected.className)}`;
  holder.innerHTML = `${coverUrl ? `<img src="${esc(coverUrl)}" alt="名片封面">` : `<div class="ecard-cover-placeholder">${avatar()}</div>`}<div class="ecard-preview-copy"><strong>${esc(title)}</strong><span>${esc(description)}</span></div>${buttons.length ? `<div class="ecard-preview-buttons">${buttons.slice(0,4).map((button) => `<span style="--button-color:${esc(button.color || "#B96072")}">${esc(button.label || "按鈕")}</span>`).join("")}</div>` : ""}`;
}
// Ported from LINE-/index.html + js/modules/mycard.js: the editor is deliberately
// kept as its own source-shaped block, with only storage calls adapted to A-KAFFIT TEAM.
function lineSourceEcardEditor(card, selected, options = {}) {
  const version = cardWithVersion(card, selected.id);
  const shareTools = options.collection
    ? `<div class="line-source-share"><p class="muted">收藏名片會使用同一組版型、裁切與按鈕設定。</p><button id="aiExpandContactContent" type="button">AI 擴寫內容</button><button id="shareCollectedCard" type="button">分享電子名片</button><button id="stopCollectedCardShare" type="button">停止既有分享</button></div>`
    : `<div class="line-source-share"><label>聊天室顯示文字<input id="cardChatAltText" maxlength="300" value="${esc(cardChatAltText(card))}"></label><button id="saveCardChatAltText" type="button">儲存顯示文字</button><input id="cardPublicUrl" readonly value="${esc(cardPublicUrl(card.id, card))}"><div id="cardPublicQr" class="qr"></div><button id="sharePersonalCard" type="button">分享名片</button><button id="sendPersonalCard" type="button">傳送至目前聊天室</button><button id="copyCardUrl" type="button">複製名片網址</button></div>`;
  return `<section id="my-ecard-edit-state" class="line-source-ecard line-source-ecard-canvas">
    <div class="line-source-ecard-top"><p>點擊名片中的封面、文字或按鈕即可直接編輯；每次確認會立即儲存。</p><div><button type="button" class="line-source-qr" id="showMyCardQr">顯示條碼</button></div></div>
    <input id="my-v1-img-url" type="hidden" value="${esc(version.coverUrl)}"><input id="lineSourceTitle" type="hidden" value="${esc(version.versionTitle || "")}"><textarea id="lineSourceDescription" hidden>${esc(version.serviceDescription || "")}</textarea><select id="lineSourceDescriptionAlign" hidden><option value="left" ${(version.descriptionTextAlign || "left") === "left" ? "selected" : ""}>靠左</option><option value="center" ${version.descriptionTextAlign === "center" ? "selected" : ""}>置中</option><option value="right" ${version.descriptionTextAlign === "right" ? "selected" : ""}>靠右</option></select><input id="lineSourceImageFile" type="file" accept="image/*" hidden>
    <div class="line-source-canvas-tools"><p class="line-source-label">名片版型</p><div class="line-source-layouts">${Object.entries(cardVersionMeta).map(([id, meta]) => `<label><input type="radio" name="my-ecard-layout" value="${id}" ${id === selected.id ? "checked" : ""}><span>${meta.label}</span></label>`).join("")}</div></div>
    <aside class="line-source-preview"><p>即時預覽</p><div id="my-ecard-preview-area"></div></aside>
    ${shareTools}
  </section>`;
}
function renderLineSourceButtons() {}
function ensureLineSourceCardEditor() {
  let modal = $("#lineSourceCardEditor");
  if (modal) return modal;
  document.body.insertAdjacentHTML("beforeend", `<div id="lineSourceCardEditor" class="line-source-editor-modal" role="dialog" aria-modal="true"><section class="line-source-editor-sheet"><header><h3 id="lineSourceEditorTitle">編輯名片</h3><button type="button" id="closeLineSourceEditor" aria-label="關閉">×</button></header><div id="lineSourceEditorBody"></div></section></div>`);
  modal = $("#lineSourceCardEditor");
  $("#closeLineSourceEditor").onclick = () => modal.classList.remove("open");
  return modal;
}
async function openContactContentSuggestions(context) {
  const modal = ensureLineSourceCardEditor(), title = $("#lineSourceEditorTitle"), body = $("#lineSourceEditorBody");
  title.textContent = "AI 擴寫內容";
  modal.classList.add("open");
  body.innerHTML = `<p class="line-source-editor-note">正在依名片已確認文字與公開網路資料產生候選內容…</p>`;
  try {
    const result = await api(`/v1/card-collection/${encodeURIComponent(context.card.id)}/content-suggestions`, { method:"POST", body:"{}" });
    body.innerHTML = `<p class="line-source-editor-note">選擇一條後會立即套用並儲存；不會覆蓋其他版型。</p><div class="line-source-suggestion-list">${result.items.map((item,index)=>`<button type="button" data-contact-content-suggestion="${index}">${esc(item)}</button>`).join("")}</div>`;
    document.querySelectorAll("[data-contact-content-suggestion]").forEach((button) => button.onclick = async () => {
      const item = result.items[Number(button.dataset.contactContentSuggestion)];
      if (!item) return;
      try {
        $("#lineSourceDescription").value = item;
        context.updatePreview();
        await persistLineSourceCard(context);
        modal.classList.remove("open");
        alert("內容已套用並儲存");
      } catch (error) { alert(error.message || "內容儲存失敗"); }
    });
  } catch (error) {
    body.innerHTML = `<p class="line-source-editor-note">${esc(error.message || "AI 擴寫失敗")}</p>`;
  }
}

async function persistLineSourceCard(context) {
  const { card, selected, buttons } = context;
  const id = selected.id;
  const versions = structuredClone(card.versions || {});
  const next = {
    ...(versions[id] || {}),
    // 掃描原圖在收藏名片編輯時以 blob 預覽，不可把短暫 blob URL 寫入資料庫。
    coverUrl: (() => { const value=$("#my-v1-img-url")?.value.trim() || ""; return value.startsWith("blob:") ? (versions[id]?.coverUrl || "") : value; })(),
    title: $("#lineSourceTitle")?.value.trim() || "",
    description: $("#lineSourceDescription")?.value.trim() || "",
    descriptionTextAlign: $("#lineSourceDescriptionAlign")?.value || selected.descriptionTextAlign || "left",
    buttons: buttons.filter((button) => button.label || button.value),
    buttonDefaultsSeeded:true
  };
  versions[id] = next;
  const chatAltText = cardChatAltText({ chatAltText:$("#cardChatAltText")?.value || card.chatAltText });
  const payload = { ...card, chatAltText, selectedVersion:id, versions, status:"published" };
  if (typeof context.persist === "function") await context.persist(payload);
  else await api("/v1/cards/me", { method:"PUT", body:JSON.stringify(payload) });
  card.chatAltText = chatAltText;
  card.versions = versions;
  Object.assign(selected, next);
}
function openLineSourceCardEditor(kind, context, index = -1) {
  const modal = ensureLineSourceCardEditor(), title = $("#lineSourceEditorTitle"), body = $("#lineSourceEditorBody");
  const { selected, buttons, updatePreview } = context;
  const close = () => modal.classList.remove("open");
  const apply = async () => {
    try {
      updatePreview();
      await persistLineSourceCard(context);
      close();
      alert("名片已儲存");
    } catch (error) {
      alert(error.message || "名片儲存失敗");
    }
  };
  modal.classList.add("open");
  if (kind === "cover") {
    title.textContent = "更換封面圖片";
    body.innerHTML = `<p class="line-source-editor-note">請選擇並裁切圖片；會依目前版型自動裁切。</p><div class="line-source-editor-actions"><button type="button" class="line-source-editor-primary" id="lineSourcePickImage">上傳裁切</button><button type="button" id="lineSourceCoverDone">完成</button></div>`;
    $("#lineSourcePickImage").onclick = () => $("#lineSourceImageFile")?.click();
    $("#lineSourceCoverDone").onclick = () => apply();
    return;
  }
  if (kind === "title") {
    title.textContent = "修改版面標題";
    body.innerHTML = `<label class="line-source-editor-field">版面標題<input id="lineSourceEditTitle" value="${esc($("#lineSourceTitle")?.value || "")}"></label><button type="button" class="line-source-editor-primary" id="lineSourceApplyTitle">套用</button>`;
    $("#lineSourceApplyTitle").onclick = async () => { $("#lineSourceTitle").value = $("#lineSourceEditTitle").value.trim(); await apply(); };
    return;
  }
  if (kind === "description") {
    title.textContent = "修改版面說明";
    const currentAlign = $("#lineSourceDescriptionAlign")?.value || "left";
    body.innerHTML = `<label class="line-source-editor-field">版面說明<textarea id="lineSourceEditDescription" rows="6">${esc($("#lineSourceDescription")?.value || "")}</textarea></label><label class="line-source-editor-field">文字對齊<select id="lineSourceEditDescriptionAlign"><option value="left" ${currentAlign === "left" ? "selected" : ""}>靠左</option><option value="center" ${currentAlign === "center" ? "selected" : ""}>置中</option><option value="right" ${currentAlign === "right" ? "selected" : ""}>靠右</option></select></label><button type="button" class="line-source-editor-primary" id="lineSourceApplyDescription">套用</button>`;
    $("#lineSourceApplyDescription").onclick = async () => { $("#lineSourceDescription").value = $("#lineSourceEditDescription").value.trim(); $("#lineSourceDescriptionAlign").value = $("#lineSourceEditDescriptionAlign").value; await apply(); };
    return;
  }
  if (kind === "button") {
    const isNew = index < 0;
    const button = isNew ? { label:"新按鈕", type:"url", value:"", color:"#B96072" } : (buttons[index] || { label:"", type:"url", value:"", color:"#B96072" });
    title.textContent = isNew ? "新增按鈕" : `設定按鈕 ${index + 1}`;
    body.innerHTML = `<label class="line-source-editor-field">按鈕文字<input id="lineSourceEditButtonLabel" value="${esc(button.label || "")}"></label><label class="line-source-editor-field">連結類型<select id="lineSourceEditButtonType"><option value="url" ${button.type === "url" ? "selected" : ""}>網站連結</option><option value="phone" ${button.type === "phone" ? "selected" : ""}>電話</option><option value="email" ${button.type === "email" ? "selected" : ""}>Email</option><option value="line" ${button.type === "line" ? "selected" : ""}>LINE 連結</option><option value="map" ${button.type === "map" ? "selected" : ""}>地圖</option></select></label><label class="line-source-editor-field">網址／電話／LINE 連結<input id="lineSourceEditButtonValue" value="${esc(String(button.value || "").replace(/^(tel:|mailto:)/,""))}"></label><label class="line-source-editor-field">按鈕顏色<input id="lineSourceEditButtonColor" type="color" value="${esc(button.color || "#B96072")}"></label><div class="line-source-editor-actions">${isNew ? "" : `<button type="button" class="line-source-editor-danger" id="lineSourceDeleteButton">刪除</button>`}<button type="button" class="line-source-editor-primary" id="lineSourceApplyButton">確認並儲存</button></div>`;
    $("#lineSourceApplyButton").onclick = async () => { const next={ label:$("#lineSourceEditButtonLabel").value.trim(), type:$("#lineSourceEditButtonType").value, value:$("#lineSourceEditButtonValue").value.trim(), color:$("#lineSourceEditButtonColor").value }; if (isNew) buttons.push(next); else buttons[index] = next; await apply(); };
    $("#lineSourceDeleteButton")?.addEventListener("click", async () => { buttons.splice(index, 1); await apply(); });
    return;
  }
  openLineSourceCardEditor("button", context, -1);
}
function renderLineSourcePreview(card, selected, buttons = []) {
  const preview = $("#my-ecard-preview-area"); if (!preview) return;
  const cover = $("#my-v1-img-url")?.value.trim() || "";
  const title = $("#lineSourceTitle")?.value.trim() || card.displayName;
  const desc = $("#lineSourceDescription")?.value.trim() || card.serviceDescription || "";
  const descriptionAlign = $("#lineSourceDescriptionAlign")?.value || selected.descriptionTextAlign || "left";
  const ratio = selected.id === "full" ? "2/3" : selected.id === "square" ? "1/1" : "20/13";
  preview.innerHTML = `<div class="line-source-preview-card"><div class="line-source-preview-share">分享</div><button type="button" class="line-source-preview-cover" data-ecard-edit="cover" aria-label="更換封面圖片">${cover ? `<img style="aspect-ratio:${ratio}" src="${esc(cover)}" alt="名片封面">` : `<div class="line-source-preview-placeholder" style="aspect-ratio:${ratio}">${avatar()}</div>`}</button><div class="line-source-preview-body"><button type="button" data-ecard-edit="title">${esc(title)}</button><button type="button" data-ecard-edit="description" style="text-align:${esc(descriptionAlign)}">${esc(desc)}</button></div><div class="line-source-preview-footer">${buttons.slice(0,4).map((button,index)=>`<button type="button" data-ecard-edit="button" data-ecard-button-index="${index}" style="background:${esc(button.color || "#B96072")}">${esc(button.label || "按鈕")}</button>`).join("")}<button type="button" class="line-source-preview-add-button" data-ecard-edit="add-button">＋ 新增按鈕</button></div></div>`;
}
function bindWysiwygCardCanvas(updatePreview, context) {
  const canvas = $("#my-ecard-preview-area"); if (!canvas) return;
  canvas.querySelector('[data-ecard-edit="cover"]')?.addEventListener("click", () => openLineSourceCardEditor("cover", context));
  canvas.querySelector('[data-ecard-edit="title"]')?.addEventListener("click", () => openLineSourceCardEditor("title", context));
  canvas.querySelector('[data-ecard-edit="description"]')?.addEventListener("click", () => openLineSourceCardEditor("description", context));
  canvas.querySelectorAll('[data-ecard-edit="button"]').forEach((button) => button.addEventListener("click", () => openLineSourceCardEditor("button", context, Number(button.dataset.ecardButtonIndex))));
  canvas.querySelector('[data-ecard-edit="add-button"]')?.addEventListener("click", () => openLineSourceCardEditor("add", context));
}
function lineGeneratedCardExample() {
  const description = [
    "🔬獨家工藝｜十年研發・酒釀循環發酵",
    "🌿純淨低敏｜零負擔咖啡・自在安心喝",
    "🏆大師把關｜SCA認證精品豆・大濾掛",
    "👉 追蹤我們，自在適合每一刻！",
  ].join("\n");
  const buttons = [
    { label:"粉絲專頁", type:"url", value:"https://facebook.com/qr?id=61565353201161", color:"#B95121", enabled:true },
    { label:"加LINE好友", type:"line", value:"https://line.me/R/ti/p/@307bxlka", color:"#06C755", enabled:true },
    { label:"官方網站", type:"url", value:"https://www.akaffit.com/index", color:"#713015", enabled:true },
  ];
  return {
    serviceDescription:description,
    lineUrl:"https://line.me/R/ti/p/@307bxlka",
    websiteUrl:"https://www.akaffit.com/index",
    selectedVersion:"standard",
    versions:{
      standard:{
        coverUrl:location.origin+"/akaffit-line-card-cover.png",
        description,
        descriptionTextAlign:"left",
        buttons,
        buttonDefaultsSeeded:true,
      },
    },
    status:"published",
  };
}
async function card() {
  const result = await api("/v1/cards/me");
  const myCard = result.card;
  if (!myCard) {
    collectionScanFiles = [];
    layout(`<section class="card card-empty personal-card-create"><h2>建立我的名片</h2><p class="muted">可以使用 LINE 會員資料快速建立，也可以拍照或上傳自己的實體名片，由 AI 辨識後帶入電子名片。</p><button class="btn" id="createMyCard">使用 LINE 資料建立名片</button><div class="personal-card-create-divider"><span>或掃描自己的名片</span></div><div class="card-scan-actions"><label>📷 拍照掃描<input id="personalCardCamera" type="file" accept="image/*" capture="environment" hidden></label><label>▧ 相簿上傳<input id="personalCardGallery" type="file" accept="image/*" multiple hidden></label></div><div id="personalCardScanDraft" class="scan-draft hidden"><strong id="personalCardScanDraftCount"></strong><label class="mini-btn">＋ 加入背面<input id="personalCardBack" type="file" accept="image/*" capture="environment" hidden></label><button class="btn" id="startPersonalCardOcr">辨識並建立</button></div><p class="muted personal-card-create-note">掃描結果會先讓你校正；正面圖片會成為標準版電子名片封面。此流程不會加入名片收藏，也不會產生收藏贈點。</p></section>`);
    $("#createMyCard").onclick = async () => { const button=$("#createMyCard"); try { await withActionFeedback(button,()=>api("/v1/cards/me", { method:"PUT", body:JSON.stringify(lineGeneratedCardExample()) }),{busy:"建立中…",success:"已建立"}); state.cardView = "contact"; await card(); } catch (error) { alert(error.message); } };
    bindPersonalCardScanInputs();
    return;
  }
  const view = state.cardView || "contact";
  const tabs = `<div class="business-card-tabs"><button data-card-tab="contact" class="${view === "contact" ? "active" : ""}">聯絡資料</button><button data-card-tab="edit" class="${view === "edit" ? "active" : ""}">編輯內容</button><button data-card-tab="digital" class="${view === "digital" ? "active" : ""}">數位名片</button></div>`;
  let panel = "";
  if (view === "contact") panel = `<div class="business-card-contact">${cardContactRows(myCard)}<div class="business-card-contact-actions">${cardActionItems(myCard).map((item) => `<a href="${esc(item.value)}" ${item.type === "url" || item.type === "line" || item.type === "map" ? 'target="_blank" rel="noopener"' : ""}>${esc(item.label)}</a>`).join("")}</div></div>`;
  if (view === "edit") panel = `<form id="cardForm" class="business-card-form"><label>姓名<input id="cardDisplayName" value="${esc(myCard.displayName)}" required></label><label>英文名<input id="cardEnglishName" value="${esc(myCard.englishName)}"></label><label>公司名稱<input id="cardCompanyName" value="${esc(myCard.companyName)}"></label><label>職稱<input id="cardJobTitle" value="${esc(myCard.jobTitle)}"></label><label>部門<input id="cardDepartment" value="${esc(myCard.department)}"></label><label>手機號碼<input id="cardMobile" value="${esc(myCard.mobile)}"></label><label>公司電話<input id="cardCompanyPhone" value="${esc(myCard.companyPhone)}"></label><label>電子郵件<input id="cardEmail" type="email" value="${esc(myCard.email)}"></label><label>公司網站<input id="cardWebsiteUrl" type="url" placeholder="https://" value="${esc(myCard.websiteUrl)}"></label><label>LINE 連結<input id="cardLineUrl" type="url" placeholder="https://lin.ee/..." value="${esc(myCard.lineUrl)}"></label><label>公司地址<input id="cardAddress" value="${esc(myCard.address)}"></label><label class="full">聊天室顯示文字<input id="cardChatAltTextBasic" maxlength="300" value="${esc(cardChatAltText(myCard))}"></label><label class="full">服務項目<textarea id="cardServiceDescription" rows="4">${esc(myCard.serviceDescription)}</textarea></label><label>服務文字對齊<select id="cardServiceTextAlign"><option value="left" ${myCard.serviceTextAlign === "left" ? "selected" : ""}>靠左</option><option value="center" ${myCard.serviceTextAlign === "center" ? "selected" : ""}>置中</option><option value="right" ${myCard.serviceTextAlign === "right" ? "selected" : ""}>靠右</option></select></label><label class="full">名片封面圖片網址<input id="cardCoverUrl" type="url" placeholder="https://..." value="${esc(myCard.coverUrl)}"></label><div class="full card-buttons-setting"><div class="row"><strong>自訂按鈕</strong><button type="button" class="mini-btn" id="addCardButton">新增按鈕</button></div><div id="cardButtonRows">${(myCard.buttons || []).map(customButtonEditor).join("")}</div></div><button class="btn full" type="submit">儲存名片</button></form>`;
  if (view === "digital") {
    const selected = state.cardVersion && cardVersionMeta[state.cardVersion]
      ? { id:state.cardVersion, ...(myCard.versions?.[state.cardVersion] || {}), ...cardVersionMeta[state.cardVersion] }
      : activeCardVersion(myCard);
    panel = lineSourceEcardEditor(myCard, selected);
  }
  layout(`<section class="business-card"><div class="business-card-title"><h2>名片詳細資料</h2></div>${tabs}${panel}</section>`);
  document.querySelectorAll("[data-card-tab]").forEach((button) => button.onclick = () => { state.cardView = button.dataset.cardTab; card(); });
  bindPortalActions();
  if (view === "edit") {
    bindCardButtonEditor();
    $("#cardForm").onsubmit = async (event) => { event.preventDefault(); const button=event.submitter||event.target.querySelector('[type="submit"]'); try {
      const updated = await withActionFeedback(button,()=>api("/v1/cards/me", { method:"PUT", body:JSON.stringify({
        displayName: $("#cardDisplayName").value, englishName: $("#cardEnglishName").value, companyName: $("#cardCompanyName").value,
        jobTitle: $("#cardJobTitle").value, department: $("#cardDepartment").value, mobile: $("#cardMobile").value,
        companyPhone: $("#cardCompanyPhone").value, email: $("#cardEmail").value, websiteUrl: $("#cardWebsiteUrl").value,
        lineUrl: $("#cardLineUrl").value, address: $("#cardAddress").value, chatAltText: $("#cardChatAltTextBasic").value, serviceDescription: $("#cardServiceDescription").value, serviceTextAlign: $("#cardServiceTextAlign").value,
        coverUrl: $("#cardCoverUrl").value, buttons: collectCardButtons(), versions:myCard.versions, selectedVersion:myCard.selectedVersion, status:"published"
      }) }),{busy:"儲存中…",success:"已儲存"});
      state.cardView = "contact"; alert("名片已儲存"); await card();
    } catch (error) { alert(error.message); } };
  }
  if (view === "digital") {
    const selected = state.cardVersion && cardVersionMeta[state.cardVersion]
      ? { id:state.cardVersion, ...(myCard.versions?.[state.cardVersion] || {}), ...cardVersionMeta[state.cardVersion] }
      : activeCardVersion(myCard);
    new QRCode($("#cardPublicQr"), { text:cardPublicUrl(myCard.id, myCard), width:190, height:190 });
    $("#copyCardUrl").onclick = async () => { await navigator.clipboard.writeText(cardPublicUrl(myCard.id, myCard)); alert("名片網址已複製"); };
    $("#sharePersonalCard").onclick = () => sharePersonalCard(myCard).catch((error) => alert(error.message));
    $("#sendPersonalCard").onclick = () => sendPersonalCardToChat(myCard).catch((error) => alert(error.message));
    document.querySelectorAll('input[name="my-ecard-layout"]').forEach((input) => input.onchange = () => { state.cardVersion=input.value; state.cardView="digital"; card(); });
    const versionButtons = structuredClone(myCard.versions?.[selected.id]?.buttons || []);
    const editorContext = { card:myCard, selected, buttons:versionButtons, updatePreview:null };
    const updatePreview = () => { renderLineSourcePreview(myCard, selected, versionButtons); bindWysiwygCardCanvas(updatePreview, editorContext); };
    editorContext.updatePreview = updatePreview;
    updatePreview();
    $("#saveCardChatAltText").onclick = async () => { const button=$("#saveCardChatAltText"); try { await withActionFeedback(button,()=>persistLineSourceCard(editorContext),{busy:"儲存中…",success:"已儲存"}); } catch(error) { alert(error.message || "聊天室顯示文字儲存失敗"); } };
    $("#my-v1-img-url")?.addEventListener("input", updatePreview);
    $("#lineSourceImageFile").onchange = async () => { try { const file=$("#lineSourceImageFile").files?.[0]; if(!file) return; await openCardCropper(file,selected.id, async () => { await persistLineSourceCard(editorContext); }); } catch(e) { alert(e.message); } };
    $("#showMyCardQr").onclick = () => $("#cardPublicQr")?.scrollIntoView({behavior:"smooth",block:"center"});
  }
}

function bindPersonalCardScanInputs() {
  const select = async (files) => {
    try {
      const selected = Array.from(files || []).slice(0, 2);
      const cropped = [];
      for (let index = 0; index < selected.length; index += 1) {
        const image = await cropCollectionScanImage(selected[index], index ? "背面" : "正面");
        if (!image) return;
        cropped.push(await compressCardImage(image));
      }
      collectionScanFiles = cropped;
      if (!collectionScanFiles.length) return;
      $("#personalCardScanDraft").classList.remove("hidden");
      $("#personalCardScanDraftCount").textContent = `已裁切 ${collectionScanFiles.length} 張（正面${collectionScanFiles.length > 1 ? "＋背面" : ""}）`;
    } catch (error) { alert(error.message || "名片圖片處理失敗"); }
  };
  $("#personalCardCamera").onchange = (event) => select(event.target.files);
  $("#personalCardGallery").onchange = (event) => select(event.target.files);
  $("#personalCardBack").onchange = async (event) => {
    try {
      const file = event.target.files?.[0];
      if (!file) return;
      const cropped = await cropCollectionScanImage(file, "背面");
      if (!cropped) return;
      collectionScanFiles[1] = await compressCardImage(cropped);
      $("#personalCardScanDraftCount").textContent = "已裁切 2 張（正面＋背面）";
    } catch (error) { alert(error.message || "名片背面處理失敗"); }
  };
  $("#startPersonalCardOcr").onclick = async () => {
    const button = $("#startPersonalCardOcr");
    try {
      await withActionFeedback(button, async () => {
        const form = new FormData();
        form.append("front", collectionScanFiles[0]);
        if (collectionScanFiles[1]) form.append("back", collectionScanFiles[1]);
        const upload = await fetch("/v1/cards/me/imports", { method:"POST", headers:{ authorization:`Bearer ${state.token}` }, body:form });
        const uploaded = await upload.json();
        if (!upload.ok) throw new Error(uploaded.error || "名片上傳失敗");
        const recognized = await api(`/v1/card-collection/imports/${encodeURIComponent(uploaded.import.id)}/recognize`, { method:"POST", body:"{}" });
        collectionScanFiles = [];
        showPersonalCardReview(recognized.eventId, recognized.card, recognized.confidence);
      }, { busy:"AI 辨識中…", success:"辨識完成" });
    } catch (error) { alert(error.message || "名片辨識失敗"); }
  };
}

function showPersonalCardReview(eventId, cardData, confidence) {
  layout(`<section class="card collection-review personal-card-review"><button class="back-card" id="cancelPersonalCardReview" aria-label="返回">‹</button><h2>確認我的名片資料</h2><p class="muted">AI 辨識信心 ${Math.round(Number(confidence || 0) * 100)}%。請校正後建立；正面圖片會設為電子名片封面。</p><form id="personalCardReviewForm">${collectionForm(cardData, "personalScan")}<button class="btn" type="submit">建立我的電子名片</button></form></section>`);
  $("#cancelPersonalCardReview").onclick = () => card();
  $("#personalCardReviewForm").onsubmit = async (event) => {
    event.preventDefault();
    const button = event.submitter;
    try {
      await withActionFeedback(button, () => api(`/v1/cards/me/imports/${encodeURIComponent(eventId)}/confirm`, {
        method:"POST",
        body:JSON.stringify({ card:readCollectionForm("personalScan") }),
      }), { busy:"建立中…", success:"已建立" });
      state.cardView = "edit";
      alert("已從掃描名片建立電子名片，請確認資料與版面。");
      await card();
    } catch (error) { alert(error.message || "建立電子名片失敗"); }
  };
}

let collectionCards = [];
let collectionScanFiles = [];
let collectionIndustryOptions = [];
let collectionRankingEnabled = false;
let collectionRefreshTimer = null;
const collectionFields = [
  ["displayName","姓名","text"],["englishName","英文姓名","text"],["companyName","公司","text"],["jobTitle","職稱","text"],
  ["department","部門","text"],["mobile","手機","tel"],["companyPhone","公司電話","tel"],["email","Email","email"],
  ["websiteUrl","網站","text"],["lineUrl","LINE 連結","url"],["address","地址","text"],["serviceDescription","服務說明","textarea"],["note","私人備註","textarea"],
];
const collectionWideFields = new Set(["companyName","mobile","companyPhone","email","websiteUrl","lineUrl","address"]);
function collectionForm(card = {}, prefix = "contact") {
  return `<div class="contact-card-form">${collectionFields.map(([key,label,type])=>{
    const full=type==="textarea" || collectionWideFields.has(key);
    const extras=key==="websiteUrl" ? ' inputmode="url" autocomplete="url" placeholder="https://"' : "";
    return `<label class="${full ? "full" : ""}">${label}${type === "textarea" ? `<textarea id="${prefix}-${key}" rows="4">${esc(card[key])}</textarea>` : `<input id="${prefix}-${key}" type="${type}" value="${esc(card[key])}"${extras}>`}</label>`;
  }).join("")}</div>`;
}
function normalizeCollectionWebsiteValue(value){
  const raw=String(value || "").trim();
  return !raw || /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, "")}`;
}
function bindCollectionWebsiteNormalizer(prefix="contact"){
  const input=$(`#${prefix}-websiteUrl`);if(!input)return;
  const normalize=()=>{input.value=normalizeCollectionWebsiteValue(input.value)};
  input.addEventListener("blur",normalize);input.addEventListener("change",normalize);
}
function readCollectionForm(prefix = "contact") {
  const values=Object.fromEntries(collectionFields.map(([key])=>[key,$(`#${prefix}-${key}`)?.value || ""]));
  values.websiteUrl=normalizeCollectionWebsiteValue(values.websiteUrl);
  const website=$(`#${prefix}-websiteUrl`);if(website)website.value=values.websiteUrl;
  return values;
}
const collectionCrmProfileFields=[
  ["family","F・家庭 Family","例如：家庭成員、關係、關心的家庭議題"],
  ["occupation","O・事業 Occupation","例如：工作現況、職涯目標、工作上的困擾"],
  ["recreation","R・休閒 Recreation","例如：興趣、假日活動、喜歡的社交方式"],
  ["money","M・收入／財務 Money","例如：收入期待、理財觀念、想改善的財務目標"],
  ["health","H・健康 Health","例如：本人主動分享的生活習慣與健康需求"],
  ["dream","D・夢想 Dream","例如：未來想完成的生活、家庭或事業目標"],
];
function collectionCrmProfileForm(card={}) {
  const profile=card.crmProfile || {};
  return `<fieldset class="collection-crm-profile"><legend>業務暖身線索</legend><p>互動中逐步補充；只供你的私人 CRM 與 AI 分析使用，不會顯示在對外分享名片。</p><div class="collection-crm-basics"><label>生日<input id="contact-crm-birthday" type="date" value="${esc(profile.birthday || "")}" max="${new Date().toISOString().slice(0,10)}"></label><label>性別<select id="contact-crm-gender"><option value="">尚未取得</option><option value="female" ${profile.gender==="female"?"selected":""}>女性</option><option value="male" ${profile.gender==="male"?"selected":""}>男性</option><option value="other" ${profile.gender==="other"?"selected":""}>其他</option></select></label></div><div class="collection-formhd">${collectionCrmProfileFields.map(([key,label,placeholder])=>`<label><b>${label}</b><textarea id="contact-crm-${key}" rows="3" maxlength="800" placeholder="${placeholder}">${esc(profile[key] || "")}</textarea></label>`).join("")}</div><small>請只記錄對方主動提供、且你有正當業務用途的資訊；AI 不會自行補造未填內容。</small></fieldset>`;
}
function collectionEditSection(title,summary,content,open=false){
  return `<details class="collection-edit-section" ${open ? "open" : ""}><summary><span><b>${title}</b><small>${summary}</small></span><i aria-hidden="true">⌄</i></summary><div class="collection-edit-section-body">${content}</div></details>`;
}
function readCollectionCrmProfile(){
  return {birthday:$("#contact-crm-birthday")?.value || "",gender:$("#contact-crm-gender")?.value || "",...Object.fromEntries(collectionCrmProfileFields.map(([key])=>[key,$(`#contact-crm-${key}`)?.value || ""]))};
}
function collectionIndustryForm(card = {}) {
  const selectedPrimary=card.industry?.primary || "待分類";
  const selectedSecondary=new Set(card.industry?.secondary || []);
  return `<fieldset class="collection-industry-editor"><legend>行業分類</legend><p>首次由 AI 分類；手動調整並儲存後，系統不會自動覆蓋。</p><label>主行業<select id="contact-industry-primary"><option value="待分類">待分類</option>${collectionIndustryOptions.map((industry)=>`<option value="${esc(industry)}" ${industry===selectedPrimary?"selected":""}>${esc(industry)}</option>`).join("")}</select></label><div class="collection-industry-secondary"><strong>次行業（最多 2 個）</strong>${collectionIndustryOptions.map((industry)=>`<label><input type="checkbox" name="contact-industry-secondary" value="${esc(industry)}" ${selectedSecondary.has(industry)?"checked":""}>${esc(industry)}</label>`).join("")}</div></fieldset>`;
}
function readCollectionIndustry() {
  const primary=$("#contact-industry-primary")?.value || "待分類";
  const secondary=Array.from(document.querySelectorAll('input[name="contact-industry-secondary"]:checked')).map((input)=>input.value).filter((value)=>value!==primary).slice(0,2);
  return {primary,secondary};
}
function bindCollectionIndustryEditor() {
  const primary=$("#contact-industry-primary");
  const boxes=Array.from(document.querySelectorAll('input[name="contact-industry-secondary"]'));
  const sync=()=>{
    const checked=boxes.filter((box)=>box.checked);
    boxes.forEach((box)=>{box.disabled=box.value===primary?.value || (!box.checked && checked.length>=2);if(box.value===primary?.value)box.checked=false;});
  };
  primary?.addEventListener("change",sync);
  boxes.forEach((box)=>box.addEventListener("change",sync));
  sync();
}

async function authorizedImageUrl(card) {
  if (!card.hasImage) return "";
  try { const response=await fetch(`/v1/card-collection/${encodeURIComponent(card.id)}/image`,{headers:{authorization:`Bearer ${state.token}`}}); if(!response.ok)return ""; return URL.createObjectURL(await response.blob()); } catch { return ""; }
}
async function attachCollectionImages() {
  await Promise.all(collectionCards.map(async(card)=>{const image=$(`[data-contact-image="${CSS.escape(card.id)}"]`);if(!image)return;const src=await authorizedImageUrl(card);if(src)image.src=src;}));
}

function bindScanInputs() {
  const select = async (files) => {
    try {
      const selected=Array.from(files || []).slice(0,2); const cropped=[];
      for(let index=0;index<selected.length;index+=1){const image=await cropCollectionScanImage(selected[index],index ? "背面" : "正面");if(!image)return;cropped.push(await compressCardImage(image));}
      collectionScanFiles = cropped;
      if (!collectionScanFiles.length) return;
      $("#scanDraft").classList.remove("hidden");
      $("#scanDraftCount").textContent = `已裁切 ${collectionScanFiles.length} 張（正面${collectionScanFiles.length > 1 ? "＋背面" : ""}）`;
    } catch(error) { alert(error.message); }
  };
  $("#cardCamera").onchange = (event)=>select(event.target.files);
  $("#cardGallery").onchange = (event)=>select(event.target.files);
  $("#cardBack").onchange = async(event)=>{try{const file=event.target.files?.[0];if(file){const cropped=await cropCollectionScanImage(file,"背面");if(!cropped)return;collectionScanFiles[1]=await compressCardImage(cropped);$("#scanDraftCount").textContent="已裁切 2 張（正面＋背面）";}}catch(error){alert(error.message)}};
  $("#startCardOcr").onclick = async()=>{
    const button=$("#startCardOcr");
    try { await withActionFeedback(button,async()=>{
      const form=new FormData();form.append("front",collectionScanFiles[0]);if(collectionScanFiles[1])form.append("back",collectionScanFiles[1]);
      const upload=await fetch("/v1/card-collection/imports",{method:"POST",headers:{authorization:`Bearer ${state.token}`},body:form});const uploaded=await upload.json();if(!upload.ok)throw new Error(uploaded.error||"名片上傳失敗");
      const submitted=await api(`/v1/card-collection/imports/${encodeURIComponent(uploaded.import.id)}/submit`,{method:"POST",body:"{}"});
      collectionScanFiles=[]; await cardCollection();
      if(submitted.reward?.status==="pending_validation")alert("名片辨識完成並確認不是重複收藏後，將自動贈送 10 K點。");
    },{busy:"送出中…",success:"已送出，AI 分析中"}); } catch(error){alert(error.message);}
  };
}

function showCollectionReview(eventId, card, confidence) {
  layout(`<section class="card collection-review"><button class="back-card" id="cancelCollectionReview" aria-label="返回">‹</button><h2>確認名片資料</h2><p class="muted">AI 辨識信心 ${Math.round(Number(confidence || 0)*100)}%。請先校正再收藏，避免錯誤資料。</p>${collectionForm(card,"scan")}<button class="btn" id="saveScannedCard">儲存至名片收藏</button></section>`);
  $("#cancelCollectionReview").onclick=()=>cardCollection();
  $("#saveScannedCard").onclick=async()=>{const button=$("#saveScannedCard");try{await withActionFeedback(button,async()=>{
    const save=async(action="")=>{const response=await fetch(`/v1/card-collection/imports/${encodeURIComponent(eventId)}/confirm`,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${state.token}`},body:JSON.stringify({card:readCollectionForm("scan"),duplicateAction:action})});const body=await response.json();return {response,body};};
    let result=await save();if(result.response.status===409&&result.body.code==="duplicate_contact"&&confirm(`收藏名單已有「${result.body.duplicate?.displayName || "相同名片"}」，要用這次資料更新嗎？更新既有名片不會重複贈點。`))result=await save("update");if(!result.response.ok)throw new Error(result.body.error||"名片儲存失敗");
    collectionScanFiles=[];await cardCollection();
    if(result.body.updated)alert("已更新既有名片；重複收藏不贈點。");
    else if(result.body.reward?.status==="completed")alert("收藏成功，已贈送 10 K點。");
    else alert("收藏成功，10 K點正在入帳，系統會自動重試。");
  },{busy:"儲存中…",success:"已收藏"});}catch(error){alert(error.message)}};
}

function aiCardCrmSection(card) {
  if(card.sourceType !== "private_import")return "";
  const crm=card.aiCrm || {};
  const status=crm.status || "";
  if(status==="queued" || status==="processing")return `<section class="ai-card-crm-result pending"><h3>AI 智慧名片 CRM</h3><p>正在二次辨識名片，並用姓名、公司、電話、地址、Email 與政府公開資料交叉查證。</p><button class="btn alt" type="button" data-retry-ai-crm>立即重新辨識與補全</button></section>`;
  if(status==="failed")return `<section class="ai-card-crm-result pending"><h3>AI 智慧名片 CRM</h3><p>公司資料補全暫時失敗：${esc(crm.error || "系統將自動重試")}。</p><button class="btn alt" type="button" data-retry-ai-crm>重新辨識與補全</button></section>`;
  if(status!=="ready")return `<section class="ai-card-crm-result pending"><h3>AI 智慧名片 CRM</h3><p>這張舊名片尚未完成公司與社群資料補全。</p><button class="btn alt" type="button" data-retry-ai-crm>開始辨識與補全</button></section>`;
  const company=crm.company || {};
  const items=[["官網",company.website,true],["Google Map",company.googleMap,true],["Facebook",company.facebook,true],["Instagram",company.instagram,true],["YouTube",company.youtube,true],["LinkedIn",company.linkedin,true],["地址",company.address,false],["電話",company.phone,false],["Email",company.email,false],["統編",company.taxId,false]].filter(([,value])=>value);
  const info=items.map(([label,value,link])=>`<div><small>${label}</small>${link?`<a href="${esc(value)}" target="_blank" rel="noopener noreferrer">開啟連結 ↗</a>`:`<strong>${esc(value)}</strong>`}</div>`).join("");
  const news=(crm.news || []).map((item)=>`<li>${item.url?`<a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.title)}</a>`:`<strong>${esc(item.title)}</strong>`}<p>${esc(item.summary || "")}</p></li>`).join("");
  const awards=(crm.awards || []).map((item)=>`<li>${item.url?`<a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.title)}</a>`:`<strong>${esc(item.title)}</strong>`}${item.year?`<span>${esc(item.year)}</span>`:""}</li>`).join("");
  const knowledge=crm.knowledgeCard || {};
  return `<section class="ai-card-crm-result"><div class="ai-card-crm-result-title">${company.logoUrl?`<img src="${esc(company.logoUrl)}" alt="公司 Logo" loading="lazy" referrerpolicy="no-referrer">`:""}<div><small>AI 智慧名片 CRM</small><h3>${esc(card.companyName || card.displayName || "公司知識卡")}</h3></div><button class="mini-btn" type="button" data-retry-ai-crm>重新辨識與補全</button></div>${company.description?`<p class="ai-card-crm-company-description">${esc(company.description)}</p>`:""}${info?`<div class="ai-card-crm-info">${info}</div>`:""}<div class="ai-card-crm-knowledge"><h4>公司知識卡</h4><p>${esc(knowledge.summary || "尚無公司摘要")}</p>${knowledge.services?.length?`<div>${knowledge.services.map((item)=>`<span>${esc(item)}</span>`).join("")}</div>`:""}${knowledge.contactAngles?.length?`<ul>${knowledge.contactAngles.map((item)=>`<li>${esc(item)}</li>`).join("")}</ul>`:""}</div>${news?`<details><summary>新聞紀錄（${crm.news.length}）</summary><ul class="ai-card-crm-links">${news}</ul></details>`:""}${awards?`<details><summary>得獎紀錄（${crm.awards.length}）</summary><ul class="ai-card-crm-links">${awards}</ul></details>`:""}<article class="ai-card-crm-task"><small>第一個任務${crm.firstTask?.eventId?"・已加入個人行程":""}</small><h4>${esc(crm.firstTask?.title || "首次跟進")}</h4><p>${esc(crm.firstTask?.description || "")}</p></article></section>`;
}
function crmInsightSection(card) {
  const insight=card.aiInsights || {};
  const status=insight.status || "";
  const labels={personality:"個性",interests:"興趣",wealth:"財富",health:"健康",career:"事業"};
  if(status==="queued" || status==="processing") return `<section class="crm-insights crm-insights-pending"><h3>✧ 五大標籤</h3><p>正在分析名片內容，完成後會自動更新個性、興趣、財富、健康、事業五項標籤。</p><button class="btn alt" type="button" data-retry-insights>立即重新分析</button></section>`;
  if(status==="failed") return `<section class="crm-insights crm-insights-pending"><h3>✧ 五大標籤</h3><p>這張名片暫時無法完成分析：${esc(insight.error || "請稍後重試")}。</p><button class="btn alt" type="button" data-retry-insights>重新分析</button></section>`;
  if(status!=="ready") return `<section class="crm-insights crm-insights-pending"><h3>✧ 五大標籤</h3><p>尚未建立五大標籤。</p><button class="btn alt" type="button" data-retry-insights>開始分析</button></section>`;
  const cards=Object.entries(labels).map(([key,label],index)=>{
    const value=insight.cards?.[key] || "尚無分析內容";
    return `<details class="crm-insight-card crm-insight-${key}" ${index===0 ? "open" : ""}><summary><span><b>${label}</b><small>${esc(value)}</small></span><i aria-hidden="true">⌄</i></summary><div class="crm-insight-detail"><p>${esc(value)}</p></div></details>`;
  }).join("");
  return `<section class="crm-insights"><div class="crm-insights-heading"><h3>✧ 五大標籤</h3><span>依名片公開文字分析，供 CRM 溝通與跟進參考</span></div><div class="crm-insights-grid">${cards}</div><button class="btn alt crm-insights-retry" type="button" data-retry-insights>重新分析</button></section>`;
}

function smartMatchHistorySection(history=[]) {
  return `<section class="contact-match-history"><div class="contact-match-history-heading"><div><small>智能配對</small><h3>配對紀錄</h3></div><span>${history.length} 筆</span></div>${history.length?`<div class="contact-match-history-list">${history.map((item)=>`<article><div class="contact-match-history-score"><strong>${format(item.score)}</strong><small>%</small></div><div><h4>${esc(item.query||"智能配對需求")}</h4><p>${esc(item.reason||"")}</p><footer><span>推薦第 ${Number(item.rank)||1} 名</span><time>${new Date(item.createdAt).toLocaleString("zh-TW",{year:"numeric",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"})}</time></footer></div></article>`).join("")}</div>`:`<p class="muted">這張名片尚無智能配對紀錄。完成配對後，需求、分數與推薦理由會保留在這裡。</p>`}</section>`;
}

async function showContactEditor(card) {
  const requestedView = state.collectionCardView || "contact";
  const view = ["contact", "edit", "insights"].includes(requestedView) ? requestedView : "contact";
  const selected = state.collectionCardVersion && cardVersionMeta[state.collectionCardVersion]
    ? { id:state.collectionCardVersion, ...(card.versions?.[state.collectionCardVersion] || {}), ...cardVersionMeta[state.collectionCardVersion] }
    : activeCardVersion(card);
  const tabs = `<div class="business-card-tabs"><button data-collection-card-tab="contact" class="${view === "contact" ? "active" : ""}">聯絡資料</button><button data-collection-card-tab="edit" class="${view === "edit" ? "active" : ""}">編輯內容</button><button data-collection-card-tab="insights" class="${view === "insights" ? "active" : ""}">五大標籤</button></div>`;
  let panel = "";
  if (view === "contact") panel = `<div class="business-card-contact">${cardContactRows(card)}<div class="business-card-contact-actions">${cardActionItems(card).map((item) => `<a href="${esc(item.value)}" ${["url","line","map"].includes(item.type) ? 'target="_blank" rel="noopener"' : ""}>${esc(item.label)}</a>`).join("")}</div></div>`;
  if (view === "edit") panel = `<form id="collectionCardForm" class="business-card-form"><div class="collection-edit-sections full">${collectionEditSection("行業分類","主行業與次行業",collectionIndustryForm(card))}${collectionEditSection("聯絡資料","姓名、公司、電話與地址",collectionForm(card,"contact"))}${collectionEditSection("業務暖身線索","生日、性別與 FORMHD",collectionCrmProfileForm(card))}</div><p class="collection-verification-note full">人工修改內容會直接儲存；系統將在背景重新辨識並搜尋公開資料補強，舊 OCR 或 AI 查核不會否決你的修正。</p><button class="btn full" type="submit">儲存修改</button><button class="btn danger full" type="button" id="deleteContact">刪除名片</button></form>`;
  if (view === "digital") panel = lineSourceEcardEditor(card, selected, { collection:true });
  if (view === "insights") {
    const viewed = cardWithVersion(card, selected.id);
    const photoUrl = card.hasImage ? await authorizedImageUrl(card) : viewed.coverUrl;
    let matchingHistory = [];
    try { matchingHistory = (await api(`/v1/card-collection/${encodeURIComponent(card.id)}/matching-history`)).history || []; }
    catch (error) { console.warn("Smart matching history unavailable", error); }
    panel = `${photoUrl ? `<section class="crm-insight-reference"><img class="crm-insight-reference-image" src="${esc(photoUrl)}" alt="${esc(card.displayName || "名片")}"></section>` : ""}${aiCardCrmSection(card)}${crmInsightSection(card)}${smartMatchHistorySection(matchingHistory)}`;
  }
  layout(`<section class="business-card collection-editor"><div class="business-card-title"><button class="back-card" id="backCollection" aria-label="返回">←</button><h2>名片詳細資料</h2></div>${tabs}${panel}</section>`);
  $("#backCollection").onclick=()=>{ state.collectionCardView=""; state.collectionCardVersion=""; cardCollection(); };
  document.querySelectorAll("[data-collection-card-tab]").forEach((button) => button.onclick = () => { state.collectionCardView=button.dataset.collectionCardTab; showContactEditor(card); });
  $("[data-retry-ai-crm]")?.addEventListener("click", async (event) => {
    try {
      await withActionFeedback(event.currentTarget, () => api(`/v1/card-collection/${encodeURIComponent(card.id)}/recalculate-ai-crm`, { method:"POST", body:"{}" }), { busy:"查證排程中…", success:"已開始重新辨識與查證" });
      card.aiCrm = { ...(card.aiCrm || {}), status:"queued", error:"" };
      showContactEditor(card);
    } catch (error) { alert(error.message); }
  });
  $("[data-retry-insights]")?.addEventListener("click", async (event) => {
    try {
      await withActionFeedback(event.currentTarget, () => api(`/v1/card-collection/${encodeURIComponent(card.id)}/recalculate-insights`, { method:"POST", body:"{}" }), { busy:"分析排程中…", success:"已開始分析" });
      card.aiInsights = { ...(card.aiInsights || {}), status:"queued", error:"" };
      showContactEditor(card);
    } catch (error) { alert(error.message); }
  });
  if (view === "insights" && (["queued","processing"].includes(card.aiInsights?.status) || ["queued","processing"].includes(card.aiCrm?.status))) {
    setTimeout(async () => {
      if (state.collectionCardView !== "insights") return;
      try {
        const fresh = (await api("/v1/card-collection")).cards?.find((item) => item.id === card.id);
        if (fresh) { Object.assign(card, fresh); showContactEditor(card); }
      } catch (error) { console.warn("Five-tag refresh unavailable", error); }
    }, 2500);
  }
  if (view === "edit") {
    bindCollectionIndustryEditor();
    bindCollectionWebsiteNormalizer("contact");
    $("#collectionCardForm").onsubmit=async(event)=>{event.preventDefault();const button=event.submitter;try{const updated=await withActionFeedback(button,()=>api(`/v1/card-collection/${encodeURIComponent(card.id)}`,{method:"PATCH",body:JSON.stringify({ ...readCollectionForm(), crmProfile:readCollectionCrmProfile(), industry:readCollectionIndustry(), selectedVersion:card.selectedVersion, versions:card.versions, chatAltText:card.chatAltText })}),{busy:"儲存中…",success:"已儲存，AI 將在背景補強"});Object.assign(card,updated.card);state.collectionCardView="contact";showContactEditor(card);}catch(error){alert(error.message)}};
    $("#deleteContact").onclick=async()=>{if(!confirm(`確定刪除「${card.displayName}」？圖片也會一併刪除並釋放空間。`))return;try{const result=await api(`/v1/card-collection/${encodeURIComponent(card.id)}`,{method:"DELETE"});alert(result.reversedPoints?`已刪除，已扣回 ${result.reversedPoints} 點`:"已刪除");state.collectionCardView="";cardCollection();}catch(error){alert(error.message)}};
    return;
  }
  if (view !== "digital") return;
  document.querySelectorAll('input[name="my-ecard-layout"]').forEach((input) => input.onchange = () => { state.collectionCardVersion=input.value; showContactEditor(card); });
  const versionButtons=structuredClone(card.versions?.[selected.id]?.buttons || []);
  const editorContext={ card, selected, buttons:versionButtons, updatePreview:null, persist:async(payload)=>{
    const saved=await api(`/v1/card-collection/${encodeURIComponent(card.id)}`,{method:"PATCH",body:JSON.stringify(payload)});Object.assign(card,saved.card);
  }};
  const updatePreview=()=>{renderLineSourcePreview(card,selected,versionButtons);bindWysiwygCardCanvas(updatePreview,editorContext);}; editorContext.updatePreview=updatePreview;
  if (!selected.coverUrl && card.hasImage) { const source=await authorizedImageUrl(card); if(source) $("#my-v1-img-url").value=source; }
  updatePreview();
  $("#lineSourceImageFile").onchange=async()=>{try{const file=$("#lineSourceImageFile").files?.[0];if(file)await openCardCropper(file,selected.id,async()=>persistLineSourceCard(editorContext));}catch(error){alert(error.message)}};
  $("#aiExpandContactContent").onclick=()=>openContactContentSuggestions(editorContext);
  $("#shareCollectedCard").onclick=async()=>{try{await beginCollectedCardShare(card,card);}catch(error){alert(error.message||"名片分享失敗")}};
  $("#stopCollectedCardShare").onclick=async()=>{if(!confirm("確定停止這張名片目前的公開分享？舊網址將立即失效。"))return;try{await api(`/v1/card-collection/${encodeURIComponent(card.id)}/share`,{method:"DELETE"});alert("已停止分享");}catch(error){alert(error.message)}};
  $("#showMyCardQr").onclick=()=>alert("公開連結會在分享電子名片時建立。");
}

function renderPublicEcard(card, versionId) {
  const selectedId = cardVersionMeta[versionId] ? versionId : (card.selectedVersion || "standard");
  const viewed = cardWithVersion(card, selectedId);
  const ratio = selectedId === "full" ? "2/3" : selectedId === "square" ? "1/1" : "20/13";
  const actions = (viewed.buttons || []).filter((item) => item?.enabled !== false && item.label && item.value).slice(0, 4);
  const title = viewed.versionTitle || viewed.displayName || "未命名名片";
  const description = viewed.serviceDescription || "";
  return { selectedId, html:`<section class="line-source-public"><div class="line-source-preview-card"><div class="line-source-preview-share">分享</div>${viewed.coverUrl || card.imageUrl ? `<div class="line-source-preview-cover"><img style="aspect-ratio:${ratio}" src="${esc(viewed.coverUrl || card.imageUrl)}" alt="${esc(title)} 的名片"></div>` : `<div class="line-source-preview-placeholder" style="aspect-ratio:${ratio}">${esc(title.slice(0,1))}</div>`}<div class="line-source-preview-body"><div class="line-source-public-title">${esc(title)}</div>${description ? `<div class="line-source-public-description" style="text-align:${esc(viewed.descriptionTextAlign || viewed.serviceTextAlign || "left")}">${esc(description)}</div>` : ""}</div>${actions.length ? `<div class="line-source-preview-footer">${actions.map((item) => `<a href="${esc(item.value)}" ${["url","line","map"].includes(item.type) ? 'target="_blank" rel="noopener"' : ""} style="background:${esc(item.color || "#B96072")}">${esc(item.label)}</a>`).join("")}</div>` : ""}</div></section>` };
}

async function publicSharedContact(){
  try {
    const result = await api(`/v1/card-collection/shared/${encodeURIComponent(state.sharedContact)}`);
    const card = result.card;
    const renderVersion = (versionId) => {
      const view = renderPublicEcard(card, versionId);
      $("#app").innerHTML = `<section class="public-card-page"><div class="public-card-version-tabs" aria-label="名片版型">${Object.entries(cardVersionMeta).map(([id,meta])=>`<button type="button" data-shared-contact-version="${id}" class="${id===view.selectedId?"active":""}">${meta.label}</button>`).join("")}</div>${view.html}</section>`;
      document.querySelectorAll("[data-shared-contact-version]").forEach((button) => button.onclick = () => renderVersion(button.dataset.sharedContactVersion));
    };
    renderVersion(card.selectedVersion || "standard");
  } catch(error) { $("#app").innerHTML=`<section class="center">${esc(error.message||"分享名片不存在或已停止分享")}</section>`; }
}

const SMART_MATCH_SCOPE_MESSAGE = "智能配對僅提供性格互補與事業夥伴篩選，其他問題不在此功能的回應範圍。";
function isSupportedSmartMatchQuery(value = "") {
  const query = String(value || "").trim().slice(0, 300);
  return /(性格|個性|人格|互補|合拍|契合|默契|相處|溝通風格|工作風格|事業|商務|商業|合作|合夥|夥伴|伙伴|人脈|創業|團隊|引薦|供應商|廠商|通路|經銷|顧問|教練|行銷|業務|設計|法律|律師|會計|攝影|影片|工程|技術|人才|專業服務)/.test(query);
}

async function smartMatch() {
  state.tab = "smartMatch";
  layout(`<section class="card smart-match-card"><div class="smart-match-intro"><div><h2>智能人脈配對</h2><p class="muted">僅提供性格互補與事業夥伴篩選；系統只依收藏名片的公開資料與五大標籤，選出最多 3 位合適人選。</p></div></div><label for="smartMatchQuery">我想尋找</label><textarea id="smartMatchQuery" rows="4" maxlength="300" placeholder="例如：尋找性格互補、適合共同拓展市場的事業夥伴"></textarea><div class="smart-match-pool"><span id="smartMatchPool">正在讀取名片收藏…</span><small>電話、Email、地址與私人備註不會用於配對</small></div><button class="btn" id="startSmartMatch" disabled>開始智能配對</button></section><section id="smartMatchResults" class="smart-match-results"><div class="card collection-empty">輸入需求後，配對結果會顯示在這裡。</div></section>`);
  const button = $("#startSmartMatch");
  try {
    collectionCards = (await api("/v1/card-collection")).cards || [];
    $("#smartMatchPool").textContent = collectionCards.length ? `將從 ${collectionCards.length} 張收藏名片中配對` : "名片收藏尚無資料，請先上傳名片";
    button.disabled = !collectionCards.length;
  } catch (error) {
    $("#smartMatchPool").textContent = error.message || "名片收藏讀取失敗";
  }
  button.onclick = async () => {
    const query = $("#smartMatchQuery").value.trim();
    if (query.length < 2) return alert("請輸入至少 2 個字的配對需求");
    if (!isSupportedSmartMatchQuery(query)) {
      $("#smartMatchResults").innerHTML = `<div class="card collection-empty">${SMART_MATCH_SCOPE_MESSAGE}</div>`;
      return;
    }
    try {
      const result = await withActionFeedback(button, () => api("/v1/card-collection/match", { method:"POST", body:JSON.stringify({ query }) }), { busy:"AI 配對中…", success:"配對完成" });
      const matches = result.matches || [];
      $("#smartMatchResults").innerHTML = matches.length
        ? `<div class="smart-match-results-head"><h2>推薦人選</h2><span>${matches.length} 位${result.cached?"・已載入上次結果":""}</span></div>${matches.map(({card,score,reason},index)=>`<button class="card smart-match-result" data-match-card-id="${esc(card.id)}"><span class="smart-match-rank">${index+1}</span><span class="contact-thumb">${card.hasImage?`<img data-contact-image="${esc(card.id)}" alt="">`:esc((card.displayName||"名").slice(0,1))}</span><span class="smart-match-person"><strong>${esc(card.displayName||"未命名")}</strong><small>${esc([card.companyName,card.jobTitle].filter(Boolean).join("／")||"收藏名片")}</small><p>${esc(reason)}</p></span><b class="smart-match-score">${format(score)}<small>%</small></b></button>`).join("")}`
        : `<div class="card collection-empty">目前沒有足夠符合需求的人選，換一個更具體的需求再試試看。</div>`;
      document.querySelectorAll("[data-match-card-id]").forEach((row) => row.onclick = () => showContactEditor(collectionCards.find((card) => card.id === row.dataset.matchCardId)));
      attachCollectionImages();
    } catch (error) {
      $("#smartMatchResults").innerHTML = `<div class="card collection-empty">${esc(error.message || "智能配對失敗")}</div>`;
    }
  };
}

const cardCrmSteps = ["拍照","AI 校正圖片","OCR","AI 二次檢查","公司資料搜尋","社群資料補全","建立 CRM","建立公司知識卡","建立第一個任務"];
const cardCrmFields = ["官網","Google Map","Facebook","Instagram","YouTube","LinkedIn","新聞","得獎紀錄","公司介紹","Logo","地址","電話","Email","統編"];
const cardCrmIntro = `<details class="card ai-card-crm-intro"><summary><span><small>AI 智慧名片 CRM</small><strong>從拍照開始，自動完成所有建檔</strong></span><b>查看流程</b></summary><div class="ai-card-crm-body"><ol class="ai-card-crm-flow">${cardCrmSteps.map((step,index)=>`<li><i>${index+1}</i><span>${step}</span></li>`).join("")}</ol><section class="ai-card-crm-fields"><h3>AI 自動補全</h3><div>${cardCrmFields.map((field)=>`<span>${field}</span>`).join("")}</div><p>資料整理、CRM、公司知識卡與第一個任務，一次自動完成。</p></section></div></details>`;
async function cardCollection(search = "", industry = "", quiet = false) {
  state.tab="cardCollection";
  if(collectionRefreshTimer){clearTimeout(collectionRefreshTimer);collectionRefreshTimer=null;}
  if(!quiet){
    layout(`<section class="card card-scan-panel"><h2>▣ 掃描建立名片</h2><p class="muted">選擇照片後先裁切名片範圍，再上傳做 OCR 分析並建立 CRM 檔案；每張新名片贈 10 K點，相同名片不得重複上傳或領點。</p><div class="card-scan-actions"><label>📷 拍照掃描<input id="cardCamera" type="file" accept="image/*" capture="environment" hidden></label><label>▧ 相簿上傳<input id="cardGallery" type="file" accept="image/*" multiple hidden></label></div><div id="scanDraft" class="scan-draft hidden"><strong id="scanDraftCount"></strong><label class="mini-btn">＋ 加入背面<input id="cardBack" type="file" accept="image/*" capture="environment" hidden></label><button class="btn" id="startCardOcr">送出名片</button></div></section>${cardCrmIntro}<section class="collection-search"><input id="collectionSearch" value="${esc(search)}" placeholder="搜尋姓名、公司、電話或 Email…"><button class="mini-btn" id="runCollectionSearch">搜尋</button></section><nav id="collectionIndustryFilters" class="collection-industry-filters" aria-label="行業分類篩選"></nav><section class="card collection-list"><div class="collection-list-head"><h2>我的收藏名單</h2><div class="collection-list-tools"><button type="button" id="toggleCollectionRanking" class="${collectionRankingEnabled?"active":""}">配對排名</button><span id="collectionCount">載入中…</span></div></div><p class="muted collection-system-note">名片先完成 OCR 並寫入收藏；AI 五大標籤會在後台接續補齊，不影響收藏與贈點。</p><div id="collectionRows"><p class="muted">正在載入收藏名片…</p></div></section>`);
    bindScanInputs();
  }
  try {
    const result=await api(`/v1/card-collection?search=${encodeURIComponent(search)}&industry=${encodeURIComponent(industry)}`);
    collectionCards=result.cards;
    collectionIndustryOptions=result.industryOptions || collectionIndustryOptions;
    const filters=["",...collectionIndustryOptions,"待分類"];
    $("#collectionIndustryFilters").innerHTML=filters.map((value)=>`<button type="button" class="${value===industry?"active":""}" data-industry-filter="${esc(value)}">${esc(value || "全部")}</button>`).join("");
    document.querySelectorAll("[data-industry-filter]").forEach((button)=>button.onclick=()=>cardCollection(search,button.dataset.industryFilter));
    const analyzing=['queued','processing'].includes(result.rankingStatus) || collectionCards.some(card=>['queued','processing'].includes(card.aiInsights?.status) || ['queued','processing'].includes(card.memberMatch?.status));
    $("#collectionCount").textContent=`${collectionCards.length} 位`;
    const renderRows=()=>{
      const cards=collectionRankingEnabled ? [...collectionCards].sort((a,b)=>{
        const aReady=a.memberMatch?.status==="ready",bReady=b.memberMatch?.status==="ready";
        if(aReady!==bReady)return aReady?-1:1;
        return (Number(a.memberMatch?.rank)||9999)-(Number(b.memberMatch?.rank)||9999);
      }) : collectionCards;
      $("#toggleCollectionRanking").classList.toggle("active",collectionRankingEnabled);
      $("#collectionRows").innerHTML=cards.length?cards.map(card=>{
        const pending=['queued','processing'].includes(card.aiInsights?.status);
        const ocrPending=card.displayName==="名片 AI 分析中";
        const facts=[card.companyName,card.jobTitle].filter(Boolean).join("／") || card.mobile || card.email || "名片已收藏";
        const progress=ocrPending ? "正在進行 OCR 名片辨識…" : pending ? `${facts}｜五大標籤背景分析中` : facts;
        const industries=[card.industry?.primary,...(card.industry?.secondary || [])].filter(Boolean);
        const match=card.memberMatch || {};
        const matchText=match.status==="ready" ? `${match.score}%` : match.status==="failed" ? "暫無結果" : ['queued','processing'].includes(match.status) ? "配對中" : "待配對";
        const rankText=collectionRankingEnabled && match.status==="ready" ? `第 ${match.rank} 名` : "";
        return `<button class="contact-row" data-contact-id="${esc(card.id)}"><span class="contact-thumb">${card.hasImage?`<img data-contact-image="${esc(card.id)}" alt="">`:esc(card.displayName.slice(0,1))}</span><span><strong>${esc(card.displayName)}</strong><small>${esc(progress)}</small><span class="contact-industry-tags">${industries.map((label)=>`<i>${esc(label)}</i>`).join("")}</span></span><span class="contact-rank-summary">${rankText?`<small>${esc(rankText)}</small>`:""}<strong>${esc(matchText)}</strong><b>›</b></span></button>`;
      }).join(""):`<div class="collection-empty">尚未收藏名片，從上方拍照或相簿開始。</div>`;
      document.querySelectorAll("[data-contact-id]").forEach(button=>button.onclick=()=>showContactEditor(collectionCards.find(card=>card.id===button.dataset.contactId)));
      attachCollectionImages();
    };
    $("#toggleCollectionRanking").onclick=()=>{collectionRankingEnabled=!collectionRankingEnabled;renderRows();};
    renderRows();
    if(analyzing)collectionRefreshTimer=setTimeout(()=>{if(state.tab==="cardCollection")cardCollection(search,industry,true);},6500);
  } catch(error){if(!quiet)$("#collectionRows").innerHTML=`<p class="muted">${esc(error.message)}</p>`;}
  if(!quiet){const run=()=>cardCollection($("#collectionSearch").value.trim(),industry);$("#runCollectionSearch").onclick=run;$("#collectionSearch").onkeydown=(event)=>{if(event.key==="Enter")run()};}
}

async function publicCard() {
  try {
    const result = await api(`/v1/cards/${encodeURIComponent(state.publicCard)}/public`);
    const shared = result.card;
    const renderPublicVersion = (versionId) => {
      const view = renderPublicEcard(shared, versionId);
      $("#app").innerHTML = `<section class="public-card-page"><div class="public-card-version-tabs" aria-label="名片版型">${Object.entries(cardVersionMeta).map(([id, meta]) => `<button type="button" data-public-card-version="${id}" class="${id === view.selectedId ? "active" : ""}">${meta.label}</button>`).join("")}</div>${view.html}${state.token ? `<button class="btn public-card-collect" id="collectPublicCard">收藏此名片</button>` : ""}</section>`;
      document.querySelectorAll("[data-public-card-version]").forEach((button) => button.onclick = () => {
        state.publicCardVersion = button.dataset.publicCardVersion;
        renderPublicVersion(state.publicCardVersion);
      });
      $("#collectPublicCard")?.addEventListener("click", async () => {
        const button = $("#collectPublicCard");
        try {
          const collected = await withActionFeedback(button, () => api(`/v1/cards/${encodeURIComponent(shared.id)}/collect`, { method:"POST", body:"{}" }), {busy:"收藏中…",success:"已收藏"});
          if (collected.duplicate) alert("這張名片已在收藏名單中");
        } catch(error) { alert(error.message); }
      });
    };
    renderPublicVersion(state.publicCardVersion || shared.selectedVersion || "standard");
  } catch (error) {
    $("#app").innerHTML = `<section class="center">${esc(error.message || "找不到這張名片")}</section>`;
  }
}
async function syncAiWearMemberLineUrl(lineUrl) {
  await initLiffOnce();
  const idToken = liff.isLoggedIn() ? liff.getIDToken() : "";
  if (!idToken) throw new Error("LINE 登入已逾時，無法同步試戴聯絡網址");
  const response = await fetch(MLM_AI_WEAR_MEMBER_SETTINGS_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken, purchaseLineUrl: String(lineUrl || "").trim() }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.status !== "success") throw new Error(payload.message || "試戴聯絡網址同步失敗");
  return payload.data;
}
function birthdayPassword(value="") {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length !== 8) return digits.slice(0, 7);
  const rocYear = Number(digits.slice(0, 4)) - 1911;
  return rocYear > 0 ? `${String(rocYear).padStart(2, "0")}${digits.slice(4)}` : digits.slice(0, 7);
}
function socialLinkRow(link={}) {
  return `<div class="member-social-row"><input data-social-label value="${esc(link.label || "")}" placeholder="社群名稱，例如 LINE"><input data-social-url type="url" value="${esc(link.url || "")}" placeholder="https://"><button type="button" class="member-social-remove" aria-label="移除社群連結">×</button></div>`;
}
function bindSocialLinkRows(root = document) {
  root.querySelectorAll(".member-social-remove").forEach((button) => button.onclick = () => {
    button.closest(".member-social-row")?.remove();
    if (!root.querySelector(".member-social-row")) {
      root.querySelector("#memberSocialLinks")?.insertAdjacentHTML("beforeend", socialLinkRow());
      bindSocialLinkRows(root);
    }
  });
}
function openRosterMemberNumberLookup(dialog) {
  const memberType = dialog.querySelector("#memberType")?.value || "";
  if (!["association", "vendor"].includes(memberType)) return alert("請先選擇協會會員或廠商會員");
  const modal = document.createElement("div");
  modal.className = "ak-roster-lookup-dialog";
  modal.innerHTML = `<div class="ak-roster-lookup-backdrop"></div><section class="ak-roster-lookup-sheet" role="dialog" aria-modal="true" aria-labelledby="rosterLookupTitle"><button type="button" class="ak-roster-lookup-close" aria-label="關閉">×</button><h2 id="rosterLookupTitle">會員編號查詢</h2><p>輸入姓名／公司名稱，從 TDEA ${memberType === "vendor" ? "廠商" : "協會"}名冊查詢會員編號。</p><label>姓名／公司名稱<input id="rosterLookupName" maxlength="120" autocomplete="name" value="${esc(dialog.querySelector("#fullName")?.value || "")}"></label><button type="button" class="btn" id="rosterLookupSearch">查詢</button><div id="rosterLookupResult" class="ak-roster-lookup-result" aria-live="polite"></div></section>`;
  const close = () => modal.remove();
  modal.querySelector(".ak-roster-lookup-backdrop")?.addEventListener("click", close);
  modal.querySelector(".ak-roster-lookup-close")?.addEventListener("click", close);
  modal.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });
  const search = async () => {
    const button = modal.querySelector("#rosterLookupSearch");
    const name = modal.querySelector("#rosterLookupName")?.value.trim() || "";
    if (!name) return alert("請輸入姓名／公司名稱");
    const result = modal.querySelector("#rosterLookupResult");
    try {
      await withActionFeedback(button, async () => {
        const response = await api("/v1/roster/member-number-lookup", { method:"POST", body:JSON.stringify({ memberType, fullName:name }) });
        const match = response.match;
        result.innerHTML = `<p>查詢結果：${esc(match.rosterName || name)}</p><div><strong>${esc(match.memberNumber)}</strong><button type="button" class="btn alt" id="copyRosterMemberNumber">複製編號</button></div>`;
        modal.querySelector("#copyRosterMemberNumber")?.addEventListener("click", async () => {
          try { await navigator.clipboard.writeText(match.memberNumber); } catch { return alert("無法自動複製，請手動複製會員編號"); }
          modal.querySelector("#copyRosterMemberNumber").textContent = "已複製";
          dialog.querySelector("#rosterMemberNumber").value = match.memberNumber;
        });
      }, { busy:"查詢中…", success:"已查詢" });
    } catch (error) { result.textContent = error.message || "會員編號查詢失敗"; }
  };
  modal.querySelector("#rosterLookupSearch")?.addEventListener("click", search);
  document.body.append(modal);
  modal.querySelector("#rosterLookupName")?.focus();
}
function profileFormMarkup(required = false) {
  const links = Array.isArray(state.member.socialLinks) && state.member.socialLinks.length ? state.member.socialLinks : [{ label:"", url:"" }];
  const logo = state.member.pictureUrl
    ? `<img id="memberLogoPreview" src="${esc(state.member.pictureUrl)}" alt="會員 Logo">`
    : `<span id="memberLogoPreview">${esc((state.member.displayName || "會").slice(0,1))}</span>`;
  const rosterTypeLabel = state.member.memberType === "association" ? "協會會員" : state.member.memberType === "vendor" ? "廠商會員" : "一般會員";
  const bindingComplete = Boolean(state.member.rosterVerifiedAt && state.member.rosterSource);
  const rosterBindingStatus = bindingComplete
    ? state.member.memberType === "general"
      ? "✓ 母站註冊資料綁定完成｜一般會員"
      : `✓ 會員名冊綁定完成｜${rosterTypeLabel}｜編號 ${esc(state.member.rosterMemberNumber)}`
    : state.member.memberType === "general"
      ? "送出後將核對母站註冊資料（姓名、行動電話、生日）"
      : "送出後將由系統核對 TDEA 正式名冊";
  return `<div class="card profile-card member-registration-card">
    <h2 id="profileDialogTitle">${required ? "完成會員註冊" : "會員註冊資料"}</h2>
    <p class="muted">請補齊基本資料，完成後即可使用會員中心。</p>
    <div class="member-logo-upload"><div class="member-logo-preview">${logo}</div><div><strong>Logo 圖片</strong><label class="btn alt member-logo-button">選擇圖片<input id="memberLogoFile" type="file" accept="image/jpeg,image/png,image/webp" hidden></label><small>JPEG、PNG、WebP，最大 3MB</small></div></div>
    <label>顯示名稱</label><input id="displayName" value="${esc(state.member.displayName || "")}" maxlength="120" required>
    <label>會員類型</label><select id="memberType" required><option value="">請選擇</option><option value="general" ${state.member.memberType === "general" ? "selected" : ""}>一般會員</option><option value="association" ${state.member.memberType === "association" ? "selected" : ""}>協會會員</option><option value="vendor" ${state.member.memberType === "vendor" ? "selected" : ""}>廠商會員</option></select>
    <label>姓名／公司名稱</label><input id="fullName" value="${esc(state.member.fullName || "")}" maxlength="120" autocomplete="name" required>
    <label>行動電話</label><input id="phone" type="tel" inputmode="tel" autocomplete="tel" value="${esc(state.member.phone || "")}" placeholder="0912345678" maxlength="20" ${state.member.phone ? "readonly" : ""} required>
    <div id="rosterMemberNumberField"><div class="member-roster-heading"><label>會員編號</label><button type="button" id="lookupRosterMemberNumber">查詢會員編號</button></div><input id="rosterMemberNumber" value="${esc(state.member.rosterMemberNumber || "")}" maxlength="80" autocomplete="off"><small>協會會員與廠商會員必填，系統會到 TDEA 正式名冊核對。</small></div>
    <p id="rosterBindingStatus" class="member-registration-number">${rosterBindingStatus}</p>
    <label>生日密碼（民國年月日）</label><input id="birthday" type="text" inputmode="numeric" value="${esc(birthdayPassword(state.member.birthday))}" placeholder="例如 591021、390305" pattern="[0-9]{6,7}" maxlength="7" required>
    <label>性別</label><select id="gender" required><option value="">請選擇</option><option value="female" ${state.member.gender === "female" ? "selected" : ""}>女性</option><option value="male" ${state.member.gender === "male" ? "selected" : ""}>男性</option><option value="other" ${state.member.gender === "other" ? "selected" : ""}>其他</option><option value="prefer_not_to_say" ${state.member.gender === "prefer_not_to_say" ? "selected" : ""}>不透露</option></select>
    <div class="member-social-heading"><label>社群連結</label><button type="button" id="addSocialLink">＋ 新增</button></div>
    <div id="memberSocialLinks" class="member-social-list">${links.map(socialLinkRow).join("")}</div>
    <p class="member-registration-number">系統會員編號：${esc(state.member.memberNumber || "建立中")}</p>
    <button class="btn" id="save">${required ? "完成註冊" : "儲存會員資料"}</button>
    ${!required && state.member?.adminAccess?.canAccessAdmin ? `<a class="btn alt" href="/admin">營運管理後台</a>` : ""}
    ${required ? "" : `<button class="btn alt" id="logout">登出</button>`}
  </div>`;
}
function closeProfileDialog(dialog = document.querySelector(".ak-profile-dialog")) {
  dialog?.remove();
  if (!document.querySelector(".ak-profile-dialog")) document.body.classList.remove("ak-profile-open");
}
function bindProfileForm(dialog, required = false) {
  const q = (selector) => dialog.querySelector(selector);
  bindSocialLinkRows(dialog);
  const syncRosterRequirement = () => {
    const requiredRoster = ["association", "vendor"].includes(q("#memberType").value);
    const selectedType = q("#memberType").value;
    const normalizedInputNumber = q("#rosterMemberNumber").value.trim().toUpperCase().replace(/[\s\-_.()（）]+/g, "");
    const normalizedSavedNumber = String(state.member.rosterMemberNumber || "").trim().toUpperCase().replace(/[\s\-_.()（）]+/g, "");
    const sameVerifiedBinding = state.member.rosterVerifiedAt && state.member.rosterSource && state.member.memberType === selectedType && (!requiredRoster || normalizedInputNumber === normalizedSavedNumber);
    q("#rosterBindingStatus").textContent = sameVerifiedBinding
      ? selectedType === "general"
        ? "✓ 母站註冊資料綁定完成｜一般會員"
        : `✓ 會員名冊綁定完成｜${selectedType === "association" ? "協會會員" : "廠商會員"}｜編號 ${state.member.rosterMemberNumber}`
      : selectedType === "general"
        ? "送出後將核對母站註冊資料（姓名、行動電話、生日）"
        : "送出後將由系統核對 TDEA 正式名冊";
    q("#rosterMemberNumberField").hidden = !requiredRoster;
    q("#rosterMemberNumber").required = requiredRoster;
    if (!requiredRoster) q("#rosterMemberNumber").value = "";
  };
  q("#lookupRosterMemberNumber").onclick = () => openRosterMemberNumberLookup(dialog);
  q("#memberType").onchange = syncRosterRequirement;
  syncRosterRequirement();
  q("#addSocialLink").onclick = () => {
    if (dialog.querySelectorAll(".member-social-row").length >= 10) return alert("最多可新增 10 組社群連結");
    q("#memberSocialLinks").insertAdjacentHTML("beforeend", socialLinkRow());
    bindSocialLinkRows(dialog);
  };
  q("#memberLogoFile").onchange = () => {
    const file = q("#memberLogoFile").files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { q("#memberLogoFile").value=""; return alert("Logo 圖片不可超過 3MB"); }
    const preview = URL.createObjectURL(file);
    q(".member-logo-preview").innerHTML = `<img id="memberLogoPreview" src="${preview}" alt="Logo 預覽">`;
  };
  q("#save").onclick = async () => {
    const button = q("#save");
    const birthday = birthdayPassword(q("#birthday").value);
    if (!q("#displayName").value.trim()) return alert("請輸入顯示名稱");
    if (!q("#fullName").value.trim()) return alert("請輸入姓名／公司名稱");
    const phone = q("#phone").value.replace(/[^\d+]/g, "");
    if (!/^(?:\+886|0)9\d{8}$/.test(phone)) return alert("請輸入正確的台灣行動電話");
    if (!q("#memberType").value) return alert("請選擇會員類型");
    if (["association", "vendor"].includes(q("#memberType").value) && !q("#rosterMemberNumber").value.trim()) return alert("協會會員與廠商會員必須填寫會員編號");
    if (!/^\d{6,7}$/.test(birthday)) return alert("生日密碼請輸入民國年月日，例如 591021、390305");
    if (!q("#gender").value) return alert("請選擇性別");
    const socialLinks = [...dialog.querySelectorAll(".member-social-row")].map((row) => ({
      label: row.querySelector("[data-social-label]").value.trim(),
      url: row.querySelector("[data-social-url]").value.trim(),
    })).filter((item) => item.label || item.url);
    try {
      await withActionFeedback(button, async () => {
        const logoFile = q("#memberLogoFile").files?.[0];
        if (logoFile) {
          const form = new FormData();
          form.append("logo", logoFile);
          const response = await fetch("/v1/me/logo", { method:"POST", headers:{ authorization:`Bearer ${state.token}` }, body:form });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error || "Logo 上傳失敗");
          state.member = { ...state.member, ...payload.member, pictureUrl:`${payload.member.pictureUrl}?v=${Date.now()}` };
        }
        const lineUrl = socialLinks.find((item) => /^https:\/\/(lin\.ee|line\.me|liff\.line\.me)\//i.test(item.url))?.url || "";
        state.member = (await api("/v1/me", {
          method:"PATCH",
          body:JSON.stringify({
            displayName:q("#displayName").value,
            fullName:q("#fullName").value,
            phone,
            memberType:q("#memberType").value,
            memberNumber:q("#rosterMemberNumber").value,
            gender:q("#gender").value,
            birthday,
            socialLinks,
            lineUrl,
            companyMemberNumber:state.member.companyMemberNumber || "",
          }),
        })).member;
      }, { busy:"儲存中…", success:required ? "註冊完成" : "已儲存" });
      const bindingComplete = Boolean(state.member.rosterVerifiedAt && state.member.rosterSource);
      const bindingMessage = state.member.memberType === "general"
        ? "母站註冊資料綁定完成\n一般會員"
        : `會員名冊綁定完成\n${state.member.memberType === "association" ? "協會會員" : "廠商會員"}｜編號 ${state.member.rosterMemberNumber}`;
      alert(bindingComplete ? bindingMessage : "會員資料已儲存");
      const afterProfile = sessionStorage.getItem("klinkweb_after_profile");
      sessionStorage.removeItem("klinkweb_after_profile");
      closeProfileDialog(dialog);
      state.tab = state.courseSession ? "courses" : "home";
      await render();
      if (afterProfile === "zodiac") showZodiacDialog();
    } catch (error) { alert(error.message); }
  };
  q("#logout")?.addEventListener("click", async () => {
    try { await api("/v1/auth/logout", { method:"POST", body:"{}" }); } catch {}
    localStorage.removeItem("klinkweb_session");
    state.token = "";
    closeProfileDialog(dialog);
    renderLogin();
  });
}
async function showProfileDialog(required = false, { focusId = "" } = {}) {
  closeProfileDialog();
  const dialog = document.createElement("section");
  dialog.className = `ak-profile-dialog${required ? " is-required" : ""}`;
  dialog.innerHTML = `${required ? `<div class="ak-profile-backdrop"></div>` : `<div class="ak-profile-backdrop" data-close-profile></div>`}<article class="ak-profile-sheet" role="dialog" aria-modal="true" aria-labelledby="profileDialogTitle">${required ? "" : `<button type="button" class="ak-profile-close" data-close-profile aria-label="關閉會員資料">×</button>`}${profileFormMarkup(required)}</article>`;
  document.body.appendChild(dialog);
  document.body.classList.add("ak-profile-open");
  bindProfileForm(dialog, required);
  if (!required) {
    dialog.querySelectorAll("[data-close-profile]").forEach((node) => node.addEventListener("click", () => closeProfileDialog(dialog)));
    dialog.addEventListener("keydown", (event) => { if (event.key === "Escape") closeProfileDialog(dialog); });
  }
  const focusTarget = focusId ? dialog.querySelector(`#${focusId}`) : dialog.querySelector("input:not([readonly]), select, button");
  setTimeout(() => focusTarget?.focus(), 0);
}
async function profile(required = false) {
  if (!document.querySelector(".ak-dashboard")) await home();
  return showProfileDialog(required);
}

async function boot() {
  state.config = await (await fetch("/api/config")).json();
  await render();
  if (shouldAutoStartLineLogin()) await startLogin();
}boot().catch((e) => {
  $("#app").innerHTML =
    `<section class="center">系統載入失敗：${esc(e.message)}</section>`;
});
