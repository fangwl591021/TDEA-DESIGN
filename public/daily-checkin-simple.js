(() => {
  let busy = false;
  const nativeFetch = window.fetch.bind(window);
  const nativeAlert = window.alert.bind(window);

  // 舊主程式的 directDailyCheckin() 會先 GET /v1/daily-ad 找 campaign。
  // 簡化簽到已不需要活動，因此沒有 campaign 時提供一個只供相容的虛擬 campaign，
  // 讓舊流程直接進入新的「每日一次 +1」POST，不再跳「今天沒有可簽到活動」。
  window.fetch = async (input, init = {}) => {
    let requestUrl;
    let method = String(init?.method || '').toUpperCase();
    try {
      if (input instanceof Request) {
        requestUrl = new URL(input.url, location.origin);
        if (!method) method = String(input.method || 'GET').toUpperCase();
      } else {
        requestUrl = new URL(String(input), location.origin);
        if (!method) method = 'GET';
      }
    } catch {
      return nativeFetch(input, init);
    }

    if (requestUrl.origin === location.origin && requestUrl.pathname === '/v1/daily-ad' && method === 'GET') {
      const response = await nativeFetch(input, init);
      if (!response.ok) return response;
      const payload = await response.clone().json().catch(() => ({}));
      if (!payload?.campaign) {
        const fallback = {
          ...payload,
          success: true,
          campaign: {
            id: 'simple_daily_checkin',
            name: '每日簽到',
            requiredCreativeCount: 0,
            rotationMode: 'sequential',
          },
          campaigns: [{
            id: 'simple_daily_checkin',
            name: '每日簽到',
            requiredCreativeCount: 0,
            rotationMode: 'sequential',
          }],
          creatives: [],
          qualifiedCreativeCount: 0,
          qualifiedCreativeIds: [],
        };
        return new Response(JSON.stringify(fallback), {
          status: 200,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          },
        });
      }
      return response;
    }
    return nativeFetch(input, init);
  };

  // 舊主程式若仍先取得 click handler，只允許顯示使用者指定的兩種結果。
  window.alert = (message) => {
    const text = String(message ?? '');
    if (/^今天已簽到/.test(text)) return nativeAlert('您今日已經完成簽到');
    if (/^簽到成功/.test(text)) return nativeAlert('獲得點數1點');
    if (text === '今天沒有可簽到活動') return nativeAlert('每日簽到暫時無法完成');
    return nativeAlert(message);
  };

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

  const apply = () => {
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

  document.addEventListener('click', (event) => {
    const element = event.target instanceof Element ? event.target : null;
    const target = element?.closest('[data-home-inline="daily"]');
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    doCheckin(target);
  }, true);

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