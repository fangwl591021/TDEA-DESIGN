from pathlib import Path

p = Path('public/app-20260803-123.js')
s = p.read_text(encoding='utf-8')
old = 'getDailyRoot()?.querySelector("[data-activity-records]")?.addEventListener("click", () => { location.href = "https://liff.line.me/2005868456-cfANNVou?query=1"; });'
new = '''getDailyRoot()?.querySelector("[data-activity-records]")?.addEventListener("click", async () => {
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
if old in s:
    s = s.replace(old, new, 1)
elif "url.searchParams.set('lineUserId', uid)" not in s:
    raise SystemExit('activity records handler anchor not found')
p.write_text(s, encoding='utf-8', newline='')
