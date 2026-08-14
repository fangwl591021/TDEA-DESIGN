(() => {
  let busy = false;
  const sessionToken = () => localStorage.getItem('klinkweb_session') || '';
  const api = async (path, options = {}) => {
    const headers = {
      ...(sessionToken() ? { authorization:`Bearer ${sessionToken()}` } : {}),
      'content-type':'application/json',
      ...(options.headers || {}),
    };
    const response = await fetch(path, { credentials:'same-origin', ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || '每日簽到失敗');
    return payload;
  };

  async function doCheckin(button = null) {
    if (busy) return;
    busy = true;
    const original = button?.textContent || '';
    if (button) {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
    }
    try {
      const result = await api('/v1/daily-ad/check-in', { method:'POST', body:'{}' });
      if (result.duplicate) {
        alert('您今日已經完成簽到');
      } else {
        alert('獲得點數1點');
      }
    } catch (error) {
      alert(error.message || '每日簽到失敗');
    } finally {
      if (button) {
        button.disabled = false;
        button.removeAttribute('aria-busy');
        if (original) button.textContent = original;
      }
      busy = false;
    }
  }

  const suppressLegacyDailyPanel = () => {
    const panel = document.querySelector('#homeDailyPanel');
    if (!panel) return;
    panel.innerHTML = '';
    panel.hidden = true;
    panel.style.setProperty('display', 'none', 'important');
    panel.setAttribute('aria-hidden', 'true');
  };

  const apply = () => {
    suppressLegacyDailyPanel();

    const homeButton = document.querySelector('[data-home-inline="daily"]');
    if (homeButton) {
      homeButton.disabled = false;
      homeButton.setAttribute('aria-label', '每日簽到');
      homeButton.setAttribute('aria-pressed', 'false');
      homeButton.dataset.simpleDailyCheckin = '1';
    }

    document.querySelectorAll('#checkin').forEach((button) => {
      button.disabled = false;
      button.textContent = '每日簽到';
      button.dataset.simpleDailyCheckin = '1';
    });
  };

  document.addEventListener('click', (event) => {
    const element = event.target instanceof Element ? event.target : null;
    const target = element?.closest('[data-home-inline="daily"], #checkin, .daily-top-tab[data-daily-panel="checkin"]');
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    suppressLegacyDailyPanel();
    doCheckin(target);
  }, true);

  const observer = new MutationObserver(() => {
    apply();
  });
  observer.observe(document.documentElement, { childList:true, subtree:true });
  document.addEventListener('DOMContentLoaded', apply);
  apply();
})();
