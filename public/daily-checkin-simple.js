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

  const apply = () => {
    document.querySelectorAll('#checkin').forEach((button) => {
      button.disabled = false;
      button.textContent = '每日簽到（+1 點）';
      button.dataset.simpleDailyCheckin = '1';
    });
  };

  document.addEventListener('click', async (event) => {
    const target = event.target instanceof Element ? event.target.closest('#checkin') : null;
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (busy) return;
    busy = true;
    const original = target.textContent;
    target.disabled = true;
    target.textContent = '簽到中…';
    try {
      const result = await api('/v1/daily-ad/check-in', { method:'POST', body:'{}' });
      if (result.duplicate) {
        alert('今天已經簽到過了，每日限一次。');
        target.textContent = '今日已簽到';
      } else {
        alert('簽到成功，已加贈 1 點。');
        target.textContent = '今日已簽到（+1 點）';
      }
    } catch (error) {
      alert(error.message || '每日簽到失敗');
      target.disabled = false;
      target.textContent = original || '每日簽到（+1 點）';
    } finally {
      busy = false;
    }
  }, true);

  const observer = new MutationObserver(apply);
  observer.observe(document.documentElement, { childList:true, subtree:true });
  document.addEventListener('DOMContentLoaded', apply);
  apply();
})();
