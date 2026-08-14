(() => {
  let busy = false;
  const nativeFetch = window.fetch.bind(window);
  const nativeAlert = window.alert.bind(window);

  const sessionToken = () => localStorage.getItem('klinkweb_session') || '';
  const api = async (path, options = {}) => {
    const headers = {
      ...(sessionToken() ? { authorization:`Bearer ${sessionToken()}` } : {}),
      'content-type':'application/json',
      ...(options.headers || {}),
    };
    const response = await nativeFetch(path, { credentials:'same-origin', ...options, headers });
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
      // 簡化規則：不查 campaign、不查素材，直接執行每日一次 +1。
      const result = await api('/v1/daily-ad/check-in', { method:'POST', body:'{}' });
      nativeAlert(result.duplicate ? '您今日已經完成簽到' : '獲得點數1點');
    } catch (error) {
      nativeAlert(error.message || '每日簽到失敗');
    } finally {
      if (button) {
        button.disabled = false;
        button.removeAttribute('aria-busy');
      }
      busy = false;
    }
  }

  function replaceHomeDailyButton() {
    const oldButton = document.querySelector('[data-home-inline="daily"]');
    if (!oldButton || oldButton.dataset.simpleDailyCheckin === '1') return;

    // home() 已先對原節點綁 openHomeDaily listener。
    // cloneNode 不會複製 addEventListener，因此直接換掉原節點，徹底移除舊流程。
    const button = oldButton.cloneNode(true);
    button.dataset.simpleDailyCheckin = '1';
    button.disabled = false;
    button.setAttribute('aria-label', '每日簽到');
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      doCheckin(button);
    });
    oldButton.replaceWith(button);
  }

  function replaceLegacyCheckinButtons() {
    document.querySelectorAll('#checkin').forEach((oldButton) => {
      if (oldButton.dataset.simpleDailyCheckin === '1') return;
      const button = oldButton.cloneNode(true);
      button.dataset.simpleDailyCheckin = '1';
      button.disabled = false;
      button.textContent = '每日簽到';
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        doCheckin(button);
      });
      oldButton.replaceWith(button);
    });
  }

  function apply() {
    // 不隱藏、不清空首頁內容；只替換帶有舊 listener 的簽到按鈕。
    const panel = document.querySelector('#homeDailyPanel');
    if (panel) {
      panel.hidden = false;
      panel.style.removeProperty('display');
      panel.removeAttribute('aria-hidden');
    }
    replaceHomeDailyButton();
    replaceLegacyCheckinButtons();
  }

  const observer = new MutationObserver(apply);
  observer.observe(document.documentElement, { childList:true, subtree:true });
  document.addEventListener('DOMContentLoaded', apply);
  apply();
})();