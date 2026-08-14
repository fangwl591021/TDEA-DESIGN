(() => {
  const POLL_MS = 3000;
  let timer = null;
  let running = false;
  let lastBalance = null;

  const token = () => localStorage.getItem('klinkweb_session') || '';
  const format = (value) => new Intl.NumberFormat('zh-TW').format(Number(value) || 0);

  function updateBalance(balance) {
    const next = Number(balance || 0);
    if (!Number.isFinite(next)) return;
    document.querySelectorAll('.ak-point-card strong').forEach((node) => {
      if (node.textContent !== format(next)) node.textContent = format(next);
    });
    lastBalance = next;
    window.dispatchEvent(new CustomEvent('tdea:point-balance', { detail: { balance: next } }));
  }

  async function refresh() {
    if (running || document.hidden || !token()) return;
    running = true;
    try {
      const response = await fetch('/v1/points/wallet', {
        method: 'GET',
        credentials: 'same-origin',
        headers: { authorization: `Bearer ${token()}`, accept: 'application/json' },
        cache: 'no-store',
      });
      if (!response.ok) return;
      const payload = await response.json().catch(() => null);
      const balance = Number(payload?.wallet?.balance);
      if (!Number.isFinite(balance)) return;
      if (lastBalance === null || balance !== lastBalance) updateBalance(balance);
    } catch (_) {
      // Network blips must not disturb the member UI.
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer) return;
    refresh();
    timer = setInterval(refresh, POLL_MS);
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else start();
  });
  window.addEventListener('focus', refresh);
  document.addEventListener('DOMContentLoaded', start);
  start();
})();
