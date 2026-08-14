(() => {
  let busy = false;
  const sessionToken = () => localStorage.getItem('klinkweb_session') || '';

  async function dailyCheckin(button) {
    if (busy) return;
    busy = true;
    const originalDisabled = Boolean(button?.disabled);
    if (button) {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
    }
    try {
      const response = await fetch('/v1/daily-checkin', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          ...(sessionToken() ? { authorization: `Bearer ${sessionToken()}` } : {}),
        },
        body: '{}',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || '每日簽到失敗');
      }
      const data = payload.data || payload;
      alert(data.alreadyChecked ? '您今日已經完成簽到' : '獲得點數1點');

      if (data.balance !== undefined) {
        document.querySelectorAll('.ak-point-card strong').forEach((node) => {
          node.textContent = new Intl.NumberFormat('zh-TW').format(Number(data.balance) || 0);
        });
      }
    } catch (error) {
      alert(error?.message || '每日簽到失敗');
    } finally {
      if (button) {
        button.disabled = originalDisabled;
        button.removeAttribute('aria-busy');
      }
      busy = false;
    }
  }

  // Loaded before the main app. Capture phase guarantees that the old campaign-based
  // listener never receives a click on a daily check-in entry.
  document.addEventListener('click', (event) => {
    const element = event.target instanceof Element ? event.target : null;
    const button = element?.closest(
      '[data-home-inline="daily"], [data-home-action="dailyCheckin"], [data-direct-daily-checkin], #checkin'
    );
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    dailyCheckin(button);
  }, true);
})();
