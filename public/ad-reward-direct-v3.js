(() => {
  if (window.__tdeaAdRewardDirectV3Installed) return;
  window.__tdeaAdRewardDirectV3Installed = true;

  const TDEA_API = 'https://tdeawork.fangwl591021.workers.dev';
  const FALLBACK_LABEL = '點我贈點';
  let busy = false;
  let rewardLabel = FALLBACK_LABEL;
  let rewardPoints = null;

  const sessionToken = () => localStorage.getItem('klinkweb_session') || '';

  function cleanupLegacyHash() {
    if (location.hash !== '#direct-ad-reward') return;
    try {
      history.replaceState(history.state, '', `${location.pathname}${location.search}`);
    } catch {}
  }

  function ensureButtonStyle() {
    if (document.getElementById('tdea-ad-reward-v3-style')) return;
    const style = document.createElement('style');
    style.id = 'tdea-ad-reward-v3-style';
    style.textContent = `
      .tdea-ad-card button[data-direct-ad-reward]{
        -webkit-appearance:none;
        appearance:none;
        width:100%;
        cursor:pointer;
        font:inherit;
      }
      [data-tdea-ad-reward-busy="1"]{pointer-events:none;opacity:.62}
      .tdea-ad-reward-notice{position:fixed;inset:0;z-index:99999;display:grid;place-items:center;padding:24px;background:rgba(39,24,18,.48);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
      .tdea-ad-reward-notice-card{width:min(352px,calc(100vw - 40px));background:#fffaf7;border:1px solid #f1d5c8;border-radius:26px;padding:28px 24px 22px;text-align:center;box-shadow:0 24px 64px rgba(80,38,20,.24);font-family:system-ui,-apple-system,"Noto Sans TC",sans-serif}
      .tdea-ad-reward-icon{width:72px;height:72px;margin:0 auto 18px;border-radius:50%;display:grid;place-items:center;font-size:38px;font-weight:900}
      .tdea-ad-reward-notice.success .tdea-ad-reward-icon{background:#e8f7ef;color:#168253}
      .tdea-ad-reward-notice.done .tdea-ad-reward-icon{background:#fff2dd;color:#b86a00}
      .tdea-ad-reward-notice.error .tdea-ad-reward-icon{background:#feeceb;color:#c64840}
      .tdea-ad-reward-title{margin:0;color:#4a2b20;font-size:22px;line-height:1.3;font-weight:800}
      .tdea-ad-reward-points{margin-top:14px;color:#168253;font-size:42px;line-height:1;font-weight:900}
      .tdea-ad-reward-message{margin:14px 0 0;color:#7d6256;font-size:15px;line-height:1.65;white-space:pre-line}
      .tdea-ad-reward-balance{margin:16px auto 0;width:100%;padding:13px 16px;border-radius:14px;background:#fff1e8;color:#8e6756;font-size:14px}
      .tdea-ad-reward-balance strong{margin-left:6px;color:#b94e1d;font-size:17px}
      .tdea-ad-reward-confirm{width:100%;height:50px;margin-top:22px;border:0;border-radius:15px;background:#bd4f1d;color:#fff;font-size:16px;font-weight:800;cursor:pointer}
      .tdea-ad-reward-notice.done .tdea-ad-reward-confirm{background:#b86a00}
      .tdea-ad-reward-notice.error .tdea-ad-reward-confirm{background:#c64840}
    `;
    document.head.appendChild(style);
  }

  function closeNotice() {
    document.querySelector('.tdea-ad-reward-notice')?.remove();
  }

  function showNotice({ type = 'success', title, points = null, message = '', balance = null, buttonText = '我知道了' }) {
    ensureButtonStyle();
    closeNotice();

    const modal = document.createElement('div');
    modal.className = `tdea-ad-reward-notice ${type}`;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    const card = document.createElement('div');
    card.className = 'tdea-ad-reward-notice-card';

    const icon = document.createElement('div');
    icon.className = 'tdea-ad-reward-icon';
    icon.textContent = type === 'error' ? '!' : '✓';

    const heading = document.createElement('h2');
    heading.className = 'tdea-ad-reward-title';
    heading.textContent = title || '';
    card.append(icon, heading);

    if (points !== null) {
      const pointNode = document.createElement('div');
      pointNode.className = 'tdea-ad-reward-points';
      pointNode.textContent = `+${Number(points) || 0} 點`;
      card.appendChild(pointNode);
    }

    const copy = document.createElement('p');
    copy.className = 'tdea-ad-reward-message';
    copy.textContent = message || '';
    card.appendChild(copy);

    if (balance !== null && balance !== undefined && Number.isFinite(Number(balance))) {
      const balanceNode = document.createElement('div');
      balanceNode.className = 'tdea-ad-reward-balance';
      balanceNode.append('目前點數 ');
      const strong = document.createElement('strong');
      strong.textContent = `${new Intl.NumberFormat('zh-TW').format(Number(balance))} 點`;
      balanceNode.appendChild(strong);
      card.appendChild(balanceNode);
    }

    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'tdea-ad-reward-confirm';
    confirm.textContent = buttonText;
    confirm.addEventListener('click', closeNotice);
    card.appendChild(confirm);

    modal.appendChild(card);
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeNotice();
    });
    document.body.appendChild(modal);
    confirm.focus({ preventScroll: true });
  }

  function updateVisibleBalance(balance) {
    if (!Number.isFinite(Number(balance))) return;
    const formatted = new Intl.NumberFormat('zh-TW').format(Number(balance));
    document.querySelectorAll('.ak-point-card strong, [data-home-action="wallet"] strong').forEach((node) => {
      node.textContent = formatted;
    });
  }

  async function requestJson(path, options = {}) {
    const headers = {
      ...(sessionToken() ? { authorization: `Bearer ${sessionToken()}` } : {}),
      ...(options.headers || {}),
    };
    if (!(options.body instanceof FormData)) headers['content-type'] = 'application/json';
    const response = await fetch(path, { ...options, headers, credentials: 'same-origin' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) {
      throw new Error(payload.error || payload.message || '廣告贈點失敗');
    }
    return payload;
  }

  function updateRewardCopy(root = document) {
    root.querySelectorAll?.('.tdea-ad-card').forEach((card) => {
      const copy = card.querySelector('span');
      if (copy && Number.isFinite(Number(rewardPoints)) && Number(rewardPoints) > 0) {
        copy.textContent = `點擊廣告每日可獲 ${Number(rewardPoints)} 點`;
      }
    });
  }

  function replaceRewardControl(control) {
    if (!(control instanceof Element)) return null;
    if (!control.closest('.tdea-ad-card')) return null;

    if (control.tagName === 'BUTTON') {
      control.type = 'button';
      control.dataset.directAdReward = '1';
      control.textContent = rewardLabel;
      return control;
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = control.className;
    button.dataset.directAdReward = '1';
    button.textContent = rewardLabel;
    control.replaceWith(button);
    return button;
  }

  function normalizeRewardControls(root = document) {
    root.querySelectorAll?.('.tdea-ad-card a.btn, .tdea-ad-card button.btn, .tdea-ad-card [data-direct-ad-reward]').forEach(replaceRewardControl);
    updateRewardCopy(root);
  }

  async function loadRewardConfig() {
    try {
      const response = await fetch(`${TDEA_API}/api/marquee?_=${Date.now()}`, {
        cache: 'no-store',
        credentials: 'omit',
      });
      const payload = await response.json().catch(() => ({}));
      const left = payload?.data?.left || {};
      const nextLabel = String(left.label || '').trim();
      if (nextLabel) rewardLabel = nextLabel;
      if (Number.isFinite(Number(left.points)) && Number(left.points) > 0) rewardPoints = Number(left.points);
    } catch {}
    normalizeRewardControls(document);
  }

  async function adReward(control) {
    if (busy) return;
    cleanupLegacyHash();
    busy = true;

    const originalDisabled = Boolean(control.disabled);
    control.disabled = true;
    control.dataset.tdeaAdRewardBusy = '1';
    control.setAttribute('aria-busy', 'true');

    try {
      const result = await requestJson('/v1/daily-checkin', {
        method: 'POST',
        body: '{}',
      });
      const data = result?.data || {};
      const balance = Number(data.balance);
      updateVisibleBalance(balance);

      if (data.alreadyChecked || data.duplicate || data.awarded === false) {
        showNotice({
          type: 'done',
          title: '今日已完成贈點',
          message: '今天的贈點已領取，不會重複贈點。\n請明天再來。',
          balance,
          buttonText: '知道了',
        });
        return;
      }

      showNotice({
        type: 'success',
        title: '贈點成功',
        points: Number(data.points || rewardPoints || 0),
        message: '今日贈點已立即入帳。',
        balance,
        buttonText: '我知道了',
      });
    } catch (error) {
      showNotice({
        type: 'error',
        title: '贈點未完成',
        message: error?.message || '廣告贈點失敗',
        buttonText: '關閉',
      });
    } finally {
      control.disabled = originalDisabled;
      delete control.dataset.tdeaAdRewardBusy;
      control.removeAttribute('aria-busy');
      busy = false;
    }
  }

  function rewardControlFrom(target) {
    const element = target instanceof Element ? target : null;
    return element?.closest('[data-direct-ad-reward], .tdea-ad-card a.btn, .tdea-ad-card button.btn') || null;
  }

  function stopLegacyNavigation(event) {
    const control = rewardControlFrom(event.target);
    if (!control || !control.closest('.tdea-ad-card')) return;
    if (control.tagName === 'A') {
      control.removeAttribute('href');
      control.removeAttribute('target');
      control.removeAttribute('rel');
    }
  }

  document.addEventListener('pointerdown', stopLegacyNavigation, true);
  document.addEventListener('touchstart', stopLegacyNavigation, { capture: true, passive: true });

  document.addEventListener('click', (event) => {
    const original = rewardControlFrom(event.target);
    if (!original || !original.closest('.tdea-ad-card')) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const control = replaceRewardControl(original) || original;
    adReward(control);
  }, true);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches?.('.tdea-ad-card')) normalizeRewardControls(node.parentElement || node);
        else if (node.querySelector?.('.tdea-ad-card')) normalizeRewardControls(node);
      }
    }
  });

  ensureButtonStyle();
  cleanupLegacyHash();
  normalizeRewardControls(document);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  loadRewardConfig();
})();
