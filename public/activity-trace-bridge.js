(() => {
  const SESSION_KEY = 'tdea_usage_session_id';
  const TELEMETRY_URL = '/v1/telemetry/event';

  const clean = (value, max = 240) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

  function sessionId() {
    let id = sessionStorage.getItem(SESSION_KEY) || '';
    if (!id) {
      id = `web_${Date.now().toString(36)}_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  }

  function activityTitle(card, link) {
    return clean(
      card?.querySelector('img')?.getAttribute('alt') ||
      card?.querySelector('h1,h2,h3,strong')?.textContent ||
      link?.getAttribute('aria-label') ||
      'TDEA 活動',
      180,
    );
  }

  function recordOutbound(trace, title, href) {
    const token = localStorage.getItem('klinkweb_session') || '';
    const payload = {
      eventType: 'click',
      sessionId: trace,
      action: 'activity.registration.outbound',
      label: `進入活動報名：${title}`,
      path: `${location.pathname}${location.search}${location.hash}`.slice(0, 500),
      target: clean(href, 240),
      clientTime: new Date().toISOString(),
      metadata: {
        flow: 'activity_registration',
        behavior: 'cross_app_navigation',
        source: 'tdea-design',
        activityTitle: title,
      },
    };
    try {
      fetch(TELEMETRY_URL, {
        method: 'POST',
        credentials: 'same-origin',
        keepalive: true,
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      }).catch(() => {});
    } catch {}
  }

  document.addEventListener('click', (event) => {
    const node = event.target instanceof Element ? event.target : null;
    const link = node?.closest('.tdea-activity-card a[href]');
    if (!link) return;
    const rawHref = link.getAttribute('href') || '';
    let url;
    try { url = new URL(rawHref, location.href); } catch { return; }
    if (url.hostname !== 'liff.line.me' || !url.pathname.includes('2005868456-cfANNVou')) return;

    const trace = sessionId();
    const title = activityTitle(link.closest('.tdea-activity-card'), link);
    url.searchParams.set('tdeaTrace', trace);
    url.searchParams.set('tdeaActivityTitle', title);
    url.searchParams.set('tdeaSource', 'tdea-design');
    link.href = url.toString();
    recordOutbound(trace, title, url.toString());
  }, true);
})();
