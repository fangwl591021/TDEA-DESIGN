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
      button.textContent = '簽到中…';
    }
    try {
      const result = await api('/v1/daily-ad/check-in', { method:'POST', body:'{}' });
      if (result.duplicate) {
        alert('您今日已經完成簽到');
        if (button) button.textContent = '今日已簽到';
      } else {
        alert('獲得點數1點');
        if (button) button.textContent = '今日已簽到';
      }
    } catch (error) {
      alert(error.message || '每日簽到失敗');
      if (button) {
        button.disabled = false;
        button.textContent = original || '每日簽到';
      }
    } finally {
      busy = false;
    }
  }

  const clearNoCampaignMessage = () => {
    const panel = document.querySelector('#homeDailyPanel');
    if (!panel) return;
    const text = panel.textContent || '';
    if (/今天沒有(?:可簽到活動|輪播簽到活動)|目前沒有(?:可簽到活動|簽到活動)/.test(text)) {
      panel.innerHTML = '';
    }
  };

  const apply = () => {
    document.querySelectorAll('#checkin').forEach((button) => {
      button.disabled = false;
      button.textContent = '每日簽到';
      button.dataset.simpleDailyCheckin = '1';
    });
    const homeButton = document.querySelector('[data-home-inline="daily"]');
    if (homeButton) {
      homeButton.disabled = false;
      homeButton.setAttribute('aria-label', '每日簽到');
      homeButton.dataset.simpleDailyCheckin = '1';
    }
    clearNoCampaignMessage();
  };

  document.addEventListener('click', (event) => {
    const element = event.target instanceof Element ? event.target : null;
    const target = element?.closest('#checkin, [data-home-inline="daily"], .daily-top-tab[data-daily-panel="checkin"]');
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    doCheckin(target);
  }, true);

  const observer = new MutationObserver(apply);
  observer.observe(document.documentElement, { childList:true, subtree:true, characterData:true });
  document.addEventListener('DOMContentLoaded', apply);
  apply();
})();
