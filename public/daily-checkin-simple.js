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
    if (button) {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
    }
    try {
      const result = await api('/v1/daily-ad/check-in', { method:'POST', body:'{}' });
      alert(result.duplicate ? '您今日已經完成簽到' : '獲得點數1點');
    } catch (error) {
      alert(error.message || '每日簽到失敗');
    } finally {
      if (button) {
        button.disabled = false;
        button.removeAttribute('aria-busy');
      }
      busy = false;
    }
  }

  const apply = () => {
    // 不再隱藏或清空首頁主內容區，只接管「每日簽到」按鈕。
    const panel = document.querySelector('#homeDailyPanel');
    if (panel) {
      panel.hidden = false;
      panel.style.removeProperty('display');
      panel.removeAttribute('aria-hidden');
    }

    const homeButton = document.querySelector('[data-home-inline="daily"]');
    if (homeButton) {
      homeButton.disabled = false;
      homeButton.setAttribute('aria-label', '每日簽到');
      homeButton.dataset.simpleDailyCheckin = '1';
    }

    document.querySelectorAll('#checkin').forEach((button) => {
      button.disabled = false;
      button.dataset.simpleDailyCheckin = '1';
    });
  };

  // Capture 階段只攔首頁的每日簽到入口，避免主程式再執行舊的 daily() 流程。
  document.addEventListener('click', (event) => {
    const element = event.target instanceof Element ? event.target : null;
    const target = element?.closest('[data-home-inline="daily"]');
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    doCheckin(target);
  }, true);

  // 若其他頁面仍存在 #checkin，也沿用同一個簡單簽到規則。
  document.addEventListener('click', (event) => {
    const element = event.target instanceof Element ? event.target : null;
    const target = element?.closest('#checkin');
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    doCheckin(target);
  }, true);

  const observer = new MutationObserver(apply);
  observer.observe(document.documentElement, { childList:true, subtree:true });
  document.addEventListener('DOMContentLoaded', apply);
  apply();
})();