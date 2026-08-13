from pathlib import Path
import re

# Lightweight internal member lookup + compact point adjustment response.
p = Path('src/tdea-point-service.js')
s = p.read_text(encoding='utf-8')
anchor = "async function userIdFromRosterNumber(db, memberNo) {"
helper = '''async function memberProfileFromUserId(db, userId) {
  if (!userId) return null;
  return db.prepare(`
    SELECT mp.platform_user_id AS user_id, mp.display_name, mp.full_name, mp.phone, mp.email,
      mp.gender, mp.birthday, mp.member_number, mp.company_member_number, mp.member_type,
      mp.roster_member_number, mp.roster_verified_at, mp.roster_verified_name, mp.roster_source,
      mp.profile_completed_at
    FROM member_profiles mp
    JOIN platform_users pu ON pu.id = mp.platform_user_id AND pu.status = 'active'
    WHERE mp.platform_user_id = ? LIMIT 1
  `).bind(userId).first();
}

function publicMemberProfile(row) {
  if (!row) return null;
  return {
    userId: row.user_id || '', displayName: row.display_name || '', fullName: row.full_name || '',
    phone: row.phone || '', email: row.email || '', gender: row.gender || '', birthday: row.birthday || '',
    memberNumber: row.member_number || '', companyMemberNumber: row.company_member_number || '',
    memberType: row.member_type || 'general', rosterMemberNumber: row.roster_member_number || '',
    rosterVerifiedAt: row.roster_verified_at || '', rosterVerifiedName: row.roster_verified_name || '',
    rosterSource: row.roster_source || '', profileCompletedAt: row.profile_completed_at || ''
  };
}

'''
if 'async function memberProfileFromUserId' not in s:
    if anchor not in s: raise SystemExit('point service anchor missing')
    s = s.replace(anchor, helper + anchor, 1)
route_anchor = "  const balanceMatch = url.pathname.match(/^\\/internal\\/tdea\\/points\\/([^/]+)$/);"
member_route = '''  const memberMatch = url.pathname.match(/^\\/internal\\/tdea\\/member\\/([^/]+)$/);
  if (request.method === 'GET' && memberMatch) {
    const lineUserId = decodeURIComponent(memberMatch[1]);
    const userId = await userIdFromLineUid(env.DB, lineUserId);
    if (!userId) return json({ success: false, error: 'LINE member not found' }, 404);
    const member = publicMemberProfile(await memberProfileFromUserId(env.DB, userId));
    return json({ success: true, registered: Boolean(member?.profileCompletedAt), userId, lineUserId, member });
  }

'''
if '/internal/tdea/member/' not in s:
    if route_anchor not in s: raise SystemExit('balance route anchor missing')
    s = s.replace(route_anchor, member_route + route_anchor, 1)
old = "return json({ success: true, userId, lineUserId, result, wallet: await getWallet(env.DB, userId) });"
new = '''if (url.searchParams.get('compact') === '1') {
        const entry = result?.entry || {};
        return json({ success: true, userId, lineUserId, result, balance: Number(entry.balanceAfter ?? entry.balance_after ?? 0) });
      }
      return json({ success: true, userId, lineUserId, result, wallet: await getWallet(env.DB, userId) });'''
if old in s:
    s = s.replace(old, new, 1)
elif "url.searchParams.get('compact')" not in s:
    raise SystemExit('compact adjust anchor missing')
p.write_text(s, encoding='utf-8', newline='')

# Daily check-in is independent from ad watching.
p = Path('src/daily-ad.js')
s = p.read_text(encoding='utf-8')
pattern = re.compile(r'  const qualifying = await db.*?\n  const checkinId = newId\("dailycheckin"\);', re.S)
m = pattern.search(s)
if m:
    s = s[:m.start()] + '  const checkinId = newId("dailycheckin");' + s[m.end():]
elif 'watch_requirement_not_met' in s:
    raise SystemExit('daily qualification block not matched')
p.write_text(s, encoding='utf-8', newline='')

# Member UI: daily check-in direct; add activity records beside ad rewards.
p = Path('public/app-20260803-123.js')
s = p.read_text(encoding='utf-8')
old = 'const portalMenu = () => `<section class="portal-menu portal-menu-compact portal-menu-text" aria-label="會員功能"><button data-home-action="cardCollection"><span>名片收藏</span></button><button data-home-action="daily"><span>每日簽到</span></button><button data-home-action="smartMatch"><span>智能配對</span></button><button data-home-action="calendar"><span>個人行程</span></button></section>`;'
new = 'const portalMenu = () => `<section class="portal-menu portal-menu-compact portal-menu-text" aria-label="會員功能"><button data-home-action="cardCollection"><span>名片收藏</span></button><button data-home-action="dailyCheckin"><span>每日簽到</span></button><button data-home-action="smartMatch"><span>智能配對</span></button><button data-home-action="calendar"><span>個人行程</span></button></section>`;'
if old in s:
    s = s.replace(old, new, 1)
elif 'data-home-action="dailyCheckin"' not in s:
    raise SystemExit('portal menu anchor missing')
bind_anchor = 'function bindPortalActions(){document.querySelectorAll("[data-home-action]").forEach((button)=>(button.onclick=async()=>{const action=button.dataset.homeAction;'
bind_new = 'function bindPortalActions(){document.querySelectorAll("[data-home-action]").forEach((button)=>(button.onclick=async()=>{const action=button.dataset.homeAction;if(action==="dailyCheckin")return directDailyCheckin(button);'
if bind_anchor in s:
    s = s.replace(bind_anchor, bind_new, 1)
elif 'directDailyCheckin(button)' not in s:
    raise SystemExit('portal action anchor missing')
helper_anchor = 'async function daily(targetSelector = "") {'
direct_helper = '''async function directDailyCheckin(button = null) {
  try {
    const dailyInfo = await api('/v1/daily-ad');
    const campaignId = dailyInfo?.campaign?.id || dailyInfo?.campaigns?.[0]?.id || '';
    if (!campaignId) throw new Error('今天沒有可簽到活動');
    const result = await withActionFeedback(button, () => api('/v1/daily-ad/check-in', {
      method:'POST', body:JSON.stringify({ campaignId })
    }), { busy:'簽到中…', success:'簽到完成' });
    const pointText = result.pointResult?.awarded ? '，點數已入帳' : result.pointResult?.duplicate ? '，點數已確認' : '';
    alert(result.duplicate ? `今天已簽到${pointText}` : `簽到成功${pointText}`);
  } catch (error) { alert(error.message || '每日簽到失敗'); }
}

'''
if 'async function directDailyCheckin' not in s:
    if helper_anchor not in s: raise SystemExit('daily helper anchor missing')
    s = s.replace(helper_anchor, direct_helper + helper_anchor, 1)
old_tabs = 'const panelTabs = `<div class="daily-top-tabs daily-panel-tabs" role="tablist" aria-label="TDEA 服務"><button type="button" class="daily-top-tab ${state.dailyPanel === "checkin" ? "active" : ""}" data-daily-panel="checkin">每日簽到</button><button type="button" class="daily-top-tab ${state.dailyPanel === "activities" ? "active" : ""}" data-daily-panel="activities">活動報名</button><button type="button" class="daily-top-tab ${state.dailyPanel === "ads" ? "active" : ""}" data-daily-panel="ads">廣告贈點</button></div>`;'
new_tabs = 'const panelTabs = `<div class="daily-top-tabs daily-panel-tabs" role="tablist" aria-label="TDEA 服務"><button type="button" class="daily-top-tab ${state.dailyPanel === "checkin" ? "active" : ""}" data-daily-panel="checkin">每日簽到</button><button type="button" class="daily-top-tab ${state.dailyPanel === "activities" ? "active" : ""}" data-daily-panel="activities">活動報名</button><button type="button" class="daily-top-tab ${state.dailyPanel === "ads" ? "active" : ""}" data-daily-panel="ads">廣告贈點</button><button type="button" class="daily-top-tab" data-activity-records>活動紀錄</button></div>`;'
if old_tabs in s:
    s = s.replace(old_tabs, new_tabs, 1)
elif 'data-activity-records' not in s:
    raise SystemExit('daily tabs anchor missing')
bind_tabs_old = 'getDailyRoot()?.querySelectorAll("[data-daily-panel]").forEach((button) => { button.onclick = () => { state.dailyPanel = button.dataset.dailyPanel || "checkin"; daily(targetSelector); }; });'
bind_tabs_new = bind_tabs_old + '\n    getDailyRoot()?.querySelector("[data-activity-records]")?.addEventListener("click", () => { location.href = "https://liff.line.me/2005868456-cfANNVou?query=1"; });'
if bind_tabs_old in s and 'querySelector("[data-activity-records]")' not in s:
    s = s.replace(bind_tabs_old, bind_tabs_new, 1)
p.write_text(s, encoding='utf-8', newline='')
