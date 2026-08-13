from pathlib import Path
import re

# Backend: proxy activity records through the existing authenticated TDEA session.
p = Path('src/index.js')
s = p.read_text(encoding='utf-8')
route_anchor = '  if (request.method === "GET" && url.pathname === "/v1/points/wallet") {'
backend = r'''  if (request.method === "GET" && url.pathname === "/v1/tdea-activity-records") {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    if (!env.TDEA_WORKER || typeof env.TDEA_WORKER.fetch !== "function") return json({ success: false, error: "TDEA activity service unavailable" }, 503);
    const identity = await env.DB.prepare(`
      SELECT provider_subject AS line_user_id
      FROM external_identities
      WHERE platform_user_id = ? AND provider = 'line_login' AND verification_status = 'verified'
      ORDER BY last_verified_at DESC, created_at DESC
      LIMIT 1
    `).bind(member.userId).first();
    const lineUserId = String(identity?.line_user_id || '').trim();
    if (!lineUserId) return json({ success: false, error: "目前會員尚未綁定 LINE 身分" }, 409);
    const upstream = await env.TDEA_WORKER.fetch(`https://tdeawork.internal/api/native-registrations/me?lineUserId=${encodeURIComponent(lineUserId)}`, { headers: { accept: 'application/json' } });
    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok || payload.success !== true) return json({ success: false, error: payload.message || payload.error || "活動紀錄讀取失敗" }, upstream.status || 502);
    return json({ success: true, data: Array.isArray(payload.data) ? payload.data : [] });
  }

  if (request.method === "POST" && url.pathname === "/v1/tdea-activity-records/cancel") {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    if (!env.TDEA_WORKER || typeof env.TDEA_WORKER.fetch !== "function") return json({ success: false, error: "TDEA activity service unavailable" }, 503);
    const identity = await env.DB.prepare(`
      SELECT provider_subject AS line_user_id
      FROM external_identities
      WHERE platform_user_id = ? AND provider = 'line_login' AND verification_status = 'verified'
      ORDER BY last_verified_at DESC, created_at DESC
      LIMIT 1
    `).bind(member.userId).first();
    const lineUserId = String(identity?.line_user_id || '').trim();
    if (!lineUserId) return json({ success: false, error: "目前會員尚未綁定 LINE 身分" }, 409);
    const body = (await readJson(request)) || {};
    const registrationId = String(body.registrationId || '').trim();
    const queryCode = String(body.queryCode || '').trim();
    if (!registrationId || !queryCode) return badRequest("缺少活動紀錄識別資料");
    const listResponse = await env.TDEA_WORKER.fetch(`https://tdeawork.internal/api/native-registrations/me?lineUserId=${encodeURIComponent(lineUserId)}`, { headers: { accept: 'application/json' } });
    const listPayload = await listResponse.json().catch(() => ({}));
    const owned = Array.isArray(listPayload.data) && listPayload.data.some((row) => String(row?.id || '') === registrationId && String(row?.queryCode || '') === queryCode);
    if (!listResponse.ok || listPayload.success !== true || !owned) return json({ success: false, error: "找不到可取消的本人活動紀錄" }, 404);
    const upstream = await env.TDEA_WORKER.fetch('https://tdeawork.internal/api/native-registrations/cancel', {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ registrationId, queryCode })
    });
    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok || payload.success !== true) return json({ success: false, error: payload.message || payload.error || "取消報名失敗" }, upstream.status || 502);
    return json({ success: true, data: payload.data || null });
  }

'''
if '/v1/tdea-activity-records' not in s:
    if route_anchor not in s:
        raise SystemExit('index route anchor not found')
    s = s.replace(route_anchor, backend + route_anchor, 1)
p.write_text(s, encoding='utf-8', newline='')

# Frontend: no daily checkin card, direct checkin action, inline activity records.
p = Path('public/app-20260803-123.js')
s = p.read_text(encoding='utf-8')
s = s.replace('  dailyPanel: "checkin",', '  dailyPanel: "ads",', 1)

old_tabs = 'const panelTabs = `<div class="daily-top-tabs daily-panel-tabs" role="tablist" aria-label="TDEA 服務"><button type="button" class="daily-top-tab ${state.dailyPanel === "checkin" ? "active" : ""}" data-daily-panel="checkin">每日簽到</button><button type="button" class="daily-top-tab ${state.dailyPanel === "activities" ? "active" : ""}" data-daily-panel="activities">活動報名</button><button type="button" class="daily-top-tab ${state.dailyPanel === "ads" ? "active" : ""}" data-daily-panel="ads">廣告贈點</button><button type="button" class="daily-top-tab" data-activity-records>活動紀錄</button></div>`;'
new_tabs = 'const panelTabs = `<div class="daily-top-tabs daily-panel-tabs" role="tablist" aria-label="TDEA 服務"><button type="button" class="daily-top-tab" data-direct-daily-checkin>每日簽到</button><button type="button" class="daily-top-tab ${state.dailyPanel === "activities" ? "active" : ""}" data-daily-panel="activities">活動報名</button><button type="button" class="daily-top-tab ${state.dailyPanel === "ads" ? "active" : ""}" data-daily-panel="ads">廣告贈點</button><button type="button" class="daily-top-tab ${state.dailyPanel === "records" ? "active" : ""}" data-activity-records>活動紀錄</button></div>`;'
if old_tabs in s:
    s = s.replace(old_tabs, new_tabs, 1)
elif 'data-direct-daily-checkin' not in s:
    raise SystemExit('daily panel tabs anchor not found')

# Replace activity-record redirect handler with inline rendering; bind direct checkin.
pattern = re.compile(r'getDailyRoot\(\)\?\.querySelector\("\[data-activity-records\]"\)\?\.addEventListener\("click", async \(\) => \{.*?\n    \}\);', re.S)
replacement = '''getDailyRoot()?.querySelector("[data-direct-daily-checkin]")?.addEventListener("click", (event) => directDailyCheckin(event.currentTarget));
    getDailyRoot()?.querySelector("[data-activity-records]")?.addEventListener("click", () => { state.dailyPanel = "records"; daily(targetSelector); });'''
if pattern.search(s):
    s = pattern.sub(replacement, s, count=1)
elif 'state.dailyPanel = "records"; daily(targetSelector);' not in s:
    # Older hard redirect form.
    old = 'getDailyRoot()?.querySelector("[data-activity-records]")?.addEventListener("click", () => { location.href = "https://liff.line.me/2005868456-cfANNVou?query=1"; });'
    if old not in s:
        raise SystemExit('activity record bind anchor not found')
    s = s.replace(old, replacement, 1)

# Insert inline record renderer before daily().
anchor = 'async function daily(targetSelector = "") {'
helper = r'''function tdeaActivityStatus(row = {}) {
  if (row.status === 'cancelled') return '已取消';
  if (row.checkedInAt) return '已核銷';
  return '已報名';
}
function tdeaActivityRecordMarkup(rows = []) {
  if (!rows.length) return '<div class="card muted">目前沒有活動紀錄。</div>';
  return `<section class="course-records">${rows.map((row) => {
    const activity = row.activity || {};
    const title = activity.name || row.formId || '活動報名';
    const checkinUrl = row.checkinUrl || (row.checkinToken ? `https://liff.line.me/2005868456-cfANNVou?checkin=${encodeURIComponent(row.checkinToken)}` : '');
    const canCancel = row.status !== 'cancelled' && !row.checkedInAt;
    return `<article class="course-record-card tdea-native-record" data-native-record="${esc(row.id || '')}">
      <div class="course-record-top"><div><small>活動紀錄</small><h3>${esc(title)}</h3></div><span class="course-status">${esc(tdeaActivityStatus(row))}</span></div>
      <div class="course-record-details">
        ${activity.courseTime ? `<div><span>活動時間</span><b>${esc(activity.courseTime)}</b></div>` : ''}
        ${row.submittedAt ? `<div><span>報名時間</span><b>${esc(new Date(row.submittedAt).toLocaleString('zh-TW',{hour12:false}))}</b></div>` : ''}
        ${row.checkedInAt ? `<div><span>核銷時間</span><b>${esc(new Date(row.checkedInAt).toLocaleString('zh-TW',{hour12:false}))}</b></div>` : ''}
      </div>
      ${checkinUrl && !row.checkedInAt ? `<div class="tdea-record-qr" data-qr-url="${esc(checkinUrl)}"></div><small class="muted">活動核銷 QR</small>` : ''}
      ${canCancel ? `<button type="button" class="btn alt" data-cancel-native-record="${esc(row.id || '')}" data-query-code="${esc(row.queryCode || '')}">取消報名</button>` : ''}
    </article>`;
  }).join('')}</section>`;
}
async function showTdeaActivityRecords(targetSelector = '') {
  const target = targetSelector ? document.querySelector(targetSelector) : document.querySelector('[data-daily-records-area]');
  if (target) target.innerHTML = '<div class="card muted">活動紀錄讀取中…</div>';
  try {
    const result = await api('/v1/tdea-activity-records');
    const rows = Array.isArray(result.data) ? result.data : [];
    const host = targetSelector ? document.querySelector(targetSelector) : document.querySelector('[data-daily-records-area]');
    if (!host) return;
    host.innerHTML = tdeaActivityRecordMarkup(rows);
    host.querySelectorAll('[data-qr-url]').forEach((node) => {
      const value = node.dataset.qrUrl || '';
      if (!value || !window.QRCode) return;
      new QRCode(node, { text:value, width:180, height:180 });
    });
    host.querySelectorAll('[data-cancel-native-record]').forEach((button) => button.onclick = async () => {
      if (!confirm('確定取消這筆活動報名？')) return;
      try {
        await withActionFeedback(button, () => api('/v1/tdea-activity-records/cancel', {
          method:'POST', body:JSON.stringify({ registrationId:button.dataset.cancelNativeRecord, queryCode:button.dataset.queryCode })
        }), { busy:'取消中…', success:'已取消' });
        await showTdeaActivityRecords(targetSelector);
      } catch (error) { alert(error.message || '取消報名失敗'); }
    });
  } catch (error) {
    const host = targetSelector ? document.querySelector(targetSelector) : document.querySelector('[data-daily-records-area]');
    if (host) host.innerHTML = `<div class="card muted">${esc(error.message || '活動紀錄讀取失敗')}</div>`;
  }
}

'''
if 'async function showTdeaActivityRecords' not in s:
    if anchor not in s:
        raise SystemExit('daily function anchor missing')
    s = s.replace(anchor, helper + anchor, 1)

# Add records branch and hard-prevent legacy checkin-card branch.
needle = '  if (state.dailyPanel !== "checkin") {'
records_branch = '''  if (state.dailyPanel === "checkin") state.dailyPanel = "ads";
  if (state.dailyPanel === "records") {
    if (!renderDaily(`${panelTabs}<div data-daily-records-area><div class="card muted">活動紀錄讀取中…</div></div>`)) return;
    bindTabs();
    await showTdeaActivityRecords(targetSelector ? `${targetSelector} [data-daily-records-area]` : '[data-daily-records-area]');
    return;
  }
  if (state.dailyPanel !== "checkin") {'''
if needle in s:
    s = s.replace(needle, records_branch, 1)
elif 'state.dailyPanel === "records"' not in s:
    raise SystemExit('daily branch anchor missing')

p.write_text(s, encoding='utf-8', newline='')
