(() => {
  const PRIVATE_SELECTOR = [
    '[data-home-action="wallet"]',
    '[data-home-action="profile"]',
    '[data-home-action="zodiacPopup"]',
    '[data-home-inline="card"]',
    '[data-home-inline="cardCollection"]',
    '[data-home-inline="daily"]',
    '[data-home-inline="smartMatch"]',
    '[data-home-inline="calendar"]',
    '[data-home-inline="tasks"]'
  ].join(',');

  let loginPromise = null;

  function hasSession() {
    return Boolean(String(localStorage.getItem('klinkweb_session') || '').trim());
  }

  function inviteTokenFromLocation() {
    const params = new URLSearchParams(location.search);
    if (params.get('invite')) return params.get('invite') || '';
    const state = params.get('liff.state');
    if (!state) return '';
    try { return new URL(state, location.origin).searchParams.get('invite') || ''; }
    catch { return ''; }
  }

  async function ensureLineSession() {
    if (hasSession()) return true;
    if (loginPromise) return loginPromise;
    loginPromise = (async () => {
      if (!window.liff) throw new Error('LINE LIFF 尚未載入，請重新開啟會員中心');
      const configResponse = await fetch('/api/config', { credentials: 'same-origin', cache: 'no-store' });
      const config = await configResponse.json().catch(() => ({}));
      const liffId = String(config?.liffId || config?.LIFF_ID || '').trim();
      if (!liffId) throw new Error('尚未設定 LIFF_ID');
      await window.liff.init({ liffId });
      if (!window.liff.isLoggedIn()) {
        sessionStorage.setItem('klinkweb_liff_login_pending', '1');
        localStorage.setItem('klinkweb_liff_login_pending_at', String(Date.now()));
        window.liff.login({ redirectUri: location.href });
        return false;
      }
      const profile = await window.liff.getProfile().catch(() => null);
      const response = await fetch('/v1/auth/line/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          idToken: window.liff.getIDToken(),
          accessToken: window.liff.getAccessToken() || '',
          pictureUrl: profile?.pictureUrl || '',
          displayName: profile?.displayName || '',
          inviteToken: inviteTokenFromLocation()
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.sessionToken) throw new Error(payload?.error || 'LINE 身分驗證失敗');
      localStorage.setItem('klinkweb_session', payload.sessionToken);
      sessionStorage.removeItem('klinkweb_liff_login_pending');
      localStorage.removeItem('klinkweb_liff_login_pending_at');
      location.reload();
      return true;
    })().finally(() => { loginPromise = null; });
    return loginPromise;
  }

  document.addEventListener('click', (event) => {
    if (hasSession()) return;
    const target = event.target instanceof Element ? event.target.closest(PRIVATE_SELECTOR) : null;
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    ensureLineSession().catch((error) => {
      console.error('Member login gate failed', error);
      window.alert(error?.message || 'LINE 登入失敗，請稍後再試');
    });
  }, true);
})();
