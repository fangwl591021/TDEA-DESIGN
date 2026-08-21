(() => {
  if (window.__tdeaAdRewardEntryFixInstalled) return;
  window.__tdeaAdRewardEntryFixInstalled = true;

  const conflictKeys = [
    'register', 'query', 'checkin', 'redeem', 'redeemSession',
    'memberQr', 'calendar', 'motherRegister', 'mother_register',
  ];

  function isAdRewardLink(link) {
    if (!link) return false;
    const raw = link.getAttribute('href') || '';
    if (!raw) return false;
    try {
      const url = new URL(raw, location.href);
      return url.searchParams.get('marquee') === '1' || url.searchParams.has('marquee');
    } catch {
      return false;
    }
  }

  function cleanAdRewardUrl(link) {
    const url = new URL(link.getAttribute('href') || link.href, location.href);
    conflictKeys.forEach((key) => url.searchParams.delete(key));
    url.searchParams.set('marquee', '1');
    url.searchParams.set('adOnly', '1');
    url.searchParams.set('tdeaSource', 'tdea-design');
    return url;
  }

  document.addEventListener('click', (event) => {
    const node = event.target instanceof Element ? event.target : null;
    const link = node?.closest('a[href]');
    if (!isAdRewardLink(link)) return;

    let url;
    try { url = cleanAdRewardUrl(link); }
    catch { return; }

    event.preventDefault();
    link.removeAttribute('target');
    link.href = url.toString();

    try {
      if (window.liff?.isInClient?.() && typeof window.liff?.openWindow === 'function') {
        window.liff.openWindow({ url: url.toString(), external: false });
        return;
      }
    } catch {}
    location.assign(url.toString());
  }, true);
})();
