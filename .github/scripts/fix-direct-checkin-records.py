from pathlib import Path

p = Path('public/app-20260803-123.js')
s = p.read_text(encoding='utf-8')

# 1. Activity records: bypass second LIFF entirely. Use the already signed-in LINE UID
# and open tdeawork directly so query parameters cannot be lost in LIFF state/redirect.
old = '''getDailyRoot()?.querySelector("[data-activity-records]")?.addEventListener("click", async () => {
      try {
        await initLiffOnce();
        const profile = liff.isLoggedIn() ? await liff.getProfile().catch(() => null) : null;
        const uid = String(profile?.userId || '').trim();
        const url = new URL('https://liff.line.me/2005868456-cfANNVou');
        url.searchParams.set('query', '1');
        if (uid) url.searchParams.set('lineUserId', uid);
        location.href = url.toString();
      } catch {
        location.href = 'https://liff.line.me/2005868456-cfANNVou?query=1';
      }
    });'''
new = '''getDailyRoot()?.querySelector("[data-activity-records]")?.addEventListener("click", async () => {
      try {
        await initLiffOnce();
        const profile = liff.isLoggedIn() ? await liff.getProfile().catch(() => null) : null;
        const uid = String(profile?.userId || '').trim();
        if (!uid) throw new Error('missing_line_uid');
        const url = new URL('https://tdeawork.fangwl591021.workers.dev/');
        url.searchParams.set('query', '1');
        url.searchParams.set('lineUserId', uid);
        location.href = url.toString();
      } catch {
        alert('目前會員身分無法讀取，請重新開啟會員中心後再試。');
      }
    });'''
if old in s:
    s = s.replace(old, new, 1)
elif "new URL('https://tdeawork.fangwl591021.workers.dev/')" not in s:
    raise SystemExit('activity records handler not found')

# 2. Any home/menu action named daily must be a direct check-in action, never open cards.
old = 'if(action==="dailyCheckin")return directDailyCheckin(button);'
new = 'if(action==="dailyCheckin"||action==="daily")return directDailyCheckin(button);'
if old in s:
    s = s.replace(old, new, 1)
elif 'action==="dailyCheckin"||action==="daily"' not in s:
    raise SystemExit('daily home action anchor not found')

# 3. Daily top tab itself becomes a direct action. Ads/activity tabs still render their panels.
old = 'getDailyRoot()?.querySelectorAll("[data-daily-panel]").forEach((button) => { button.onclick = () => { state.dailyPanel = button.dataset.dailyPanel || "checkin"; daily(targetSelector); }; });'
new = '''getDailyRoot()?.querySelectorAll("[data-daily-panel]").forEach((button) => { button.onclick = async () => {
      const panel = button.dataset.dailyPanel || "checkin";
      if (panel === "checkin") return directDailyCheckin(button);
      state.dailyPanel = panel;
      daily(targetSelector);
    }; });'''
if old in s:
    s = s.replace(old, new, 1)
elif 'if (panel === "checkin") return directDailyCheckin(button);' not in s:
    raise SystemExit('daily panel handler anchor not found')

# 4. If something still navigates to ?tab=daily, do not render the old check-in cards.
# Open the ads panel instead; daily check-in itself is now an action button only.
old = 'if (state.tab === "daily") return daily();'
new = '''if (state.tab === "daily") {
    state.dailyPanel = "ads";
    return daily();
  }'''
if old in s:
    s = s.replace(old, new, 1)
elif 'state.dailyPanel = "ads";' not in s:
    raise SystemExit('authenticated daily route anchor not found')

p.write_text(s, encoding='utf-8', newline='')
