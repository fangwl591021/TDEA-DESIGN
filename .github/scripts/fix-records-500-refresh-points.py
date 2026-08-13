from pathlib import Path
import re

# Backend: make activity-record identity lookup use the known-good verified identity query and fail safely.
p = Path('src/index.js')
s = p.read_text(encoding='utf-8')

helper_anchor = '  if (request.method === "GET" && url.pathname === "/v1/tdea-activity-records") {'
helper = '''  async function currentVerifiedLineUserId(platformUserId) {
    const identity = await env.DB.prepare(`
      SELECT provider_subject AS line_user_id
      FROM external_identities
      WHERE platform_user_id = ?
        AND provider = 'line_login'
        AND verification_status = 'verified'
      LIMIT 1
    `).bind(platformUserId).first();
    return String(identity?.line_user_id || '').trim();
  }

'''
if 'async function currentVerifiedLineUserId(' not in s:
    if helper_anchor not in s:
        raise SystemExit('activity records route anchor missing')
    s = s.replace(helper_anchor, helper + helper_anchor, 1)

get_pattern = re.compile(r'''  if \(request\.method === "GET" && url\.pathname === "/v1/tdea-activity-records"\) \{.*?\n  \}\n\n  if \(request\.method === "POST" && url\.pathname === "/v1/tdea-activity-records/cancel"\) \{''', re.S)
get_match = get_pattern.search(s)
if not get_match:
    raise SystemExit('activity records GET block missing')
new_get = '''  if (request.method === "GET" && url.pathname === "/v1/tdea-activity-records") {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    if (!env.TDEA_WORKER || typeof env.TDEA_WORKER.fetch !== "function") return json({ success: false, error: "TDEA activity service unavailable" }, 503);
    try {
      const lineUserId = await currentVerifiedLineUserId(member.userId);
      if (!lineUserId) return json({ success: false, error: "目前會員尚未綁定 LINE 身分" }, 409);
      const upstream = await env.TDEA_WORKER.fetch(`https://tdeawork.fangwl591021.workers.dev/api/native-registrations/me?lineUserId=${encodeURIComponent(lineUserId)}`, {
        headers: { accept: 'application/json' }
      });
      const text = await upstream.text();
      let payload = {};
      try { payload = text ? JSON.parse(text) : {}; } catch {}
      if (!upstream.ok || payload.success !== true) {
        console.error('TDEA activity records upstream failed', { status: upstream.status, body: text.slice(0, 500) });
        return json({ success: false, error: payload.message || payload.error || `活動紀錄讀取失敗（${upstream.status}）` }, upstream.status || 502);
      }
      return json({ success: true, data: Array.isArray(payload.data) ? payload.data : [] });
    } catch (error) {
      console.error('TDEA activity records failed', error);
      return json({ success: false, error: error?.message || "活動紀錄讀取失敗" }, 502);
    }
  }

  if (request.method === "POST" && url.pathname === "/v1/tdea-activity-records/cancel") {'''
s = s[:get_match.start()] + new_get + s[get_match.end():]

# Simplify the cancel route identity lookup and make service-binding failures readable.
cancel_start = s.find('  if (request.method === "POST" && url.pathname === "/v1/tdea-activity-records/cancel") {')
wallet_start = s.find('  if (request.method === "GET" && url.pathname === "/v1/points/wallet") {', cancel_start)
if cancel_start < 0 or wallet_start < 0:
    raise SystemExit('cancel/wallet boundaries missing')
cancel_block = s[cancel_start:wallet_start]
old_identity = re.compile(r'''    const identity = await env\.DB\.prepare\(`.*?LIMIT 1\n    `\)\.bind\(member\.userId\)\.first\(\);\n    const lineUserId = String\(identity\?\.line_user_id \|\| ''\)\.trim\(\);''', re.S)
cancel_block, count = old_identity.subn("    const lineUserId = await currentVerifiedLineUserId(member.userId);", cancel_block, count=1)
if count != 1 and 'currentVerifiedLineUserId(member.userId)' not in cancel_block:
    raise SystemExit('cancel identity block not replaced')
cancel_block = cancel_block.replace('https://tdeawork.internal/api/native-registrations/me?', 'https://tdeawork.fangwl591021.workers.dev/api/native-registrations/me?')
cancel_block = cancel_block.replace("'https://tdeawork.internal/api/native-registrations/cancel'", "'https://tdeawork.fangwl591021.workers.dev/api/native-registrations/cancel'")
s = s[:cancel_start] + cancel_block + s[wallet_start:]
p.write_text(s, encoding='utf-8', newline='')

# Frontend: refresh visible point balance immediately after successful checkin.
p = Path('public/app-20260803-123.js')
s = p.read_text(encoding='utf-8')
refresh_anchor = 'async function home() {'
refresh_helper = '''async function refreshVisibleTdeaPointBalance() {
  const snapshot = await api('/v1/points/wallet');
  const balance = Number(snapshot?.wallet?.balance || 0);
  document.querySelectorAll('.ak-point-card strong').forEach((node) => { node.textContent = format(balance); });
  return balance;
}

'''
if 'async function refreshVisibleTdeaPointBalance()' not in s:
    if refresh_anchor not in s:
        raise SystemExit('home anchor missing')
    s = s.replace(refresh_anchor, refresh_helper + refresh_anchor, 1)

# directDailyCheckin: refresh immediately after API success.
direct_pattern = re.compile(r'''(async function directDailyCheckin\(button = null\) \{.*?const result = await withActionFeedback\(button, \(\) => api\('/v1/daily-ad/check-in'.*?\);)(\n\s*const pointText)''', re.S)
if direct_pattern.search(s):
    s = direct_pattern.sub(r"\1\n    await refreshVisibleTdeaPointBalance().catch(() => null);\2", s, count=1)
elif 'async function directDailyCheckin' in s and 'refreshVisibleTdeaPointBalance().catch' not in s:
    raise SystemExit('directDailyCheckin refresh insertion failed')

# Legacy/card checkin handler still present: refresh after checkin request succeeds.
legacy_needle = 'const pointText = x.pointResult?.awarded ? "，點數已入帳"'
if legacy_needle in s:
    s = s.replace(legacy_needle, 'await refreshVisibleTdeaPointBalance().catch(() => null);\n      ' + legacy_needle, 1)

p.write_text(s, encoding='utf-8', newline='')
