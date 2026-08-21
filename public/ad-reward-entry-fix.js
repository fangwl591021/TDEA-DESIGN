(() => {
  if (window.__tdeaAdRewardEntryFixInstalled) return;
  window.__tdeaAdRewardEntryFixInstalled = true;

  let busy = false;
  const sessionToken = () => localStorage.getItem('klinkweb_session') || '';

  function ensureStyles() {
    if (document.getElementById('tdea-ad-reward-notice-style')) return;
    const style = document.createElement('style');
    style.id = 'tdea-ad-reward-notice-style';
    style.textContent = `
      .tdea-ad-reward-notice{position:fixed;inset:0;z-index:2147483646;display:grid;place-items:center;padding:24px;background:rgba(39,24,18,.48);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);animation:tdeaAdRewardFade .18s ease-out}
      .tdea-ad-reward-notice-card{width:min(352px,calc(100vw - 40px));background:#fffaf7;border:1px solid #f1d5c8;border-radius:26px;padding:28px 24px 22px;text-align:center;box-shadow:0 24px 64px rgba(80,38,20,.24);animation:tdeaAdRewardPop .24s cubic-bezier(.2,.9,.28,1.1);font-family:system-ui,-apple-system,"Noto Sans TC",sans-serif}
      .tdea-ad-reward-icon{width:72px;height:72px;margin:0 auto 18px;border-radius:50%;display:grid;place-items:center;font-size:38px;font-weight:900}
      .tdea-ad-reward-notice.success .tdea-ad-reward-icon{background:#e8f7ef;color:#168253}
      .tdea-ad-reward-notice.done .tdea-ad-reward-icon{background:#fff2dd;color:#b86a00}
      .tdea-ad-reward-notice.error .tdea-ad-reward-icon{background:#feeceb;color:#c64840}
      .tdea-ad-reward-title{margin:0;color:#4a2b20;font-size:22px;line-height:1.3;font-weight:800}
      .tdea-ad-reward-points{margin-top:14px;color:#168253;font-size:42px;line-height:1;font-weight:900;letter-spacing:-.03em}
      .tdea-ad-reward-message{margin:14px 0 0;color:#7d6256;font-size:15px;line-height:1.65;white-space:pre-line}
      .tdea-ad-reward-balance{margin:16px auto 0;width:100%;padding:13px 16px;border-radius:14px;background:#fff1e8;color:#8e6756;font-size:14px}
      .tdea-ad-reward-balance strong{margin-left:6px;color:#b94e1d;font-size:17px}
      .tdea-ad-reward-confirm{width:100%;height:50px;margin-top:22px;border:0;border-radius:15px;background:#bd4f1d;color:#fff;font-size:16px;font-weight:800;cursor:pointer}
      .tdea-ad-reward-notice.done .tdea-ad-reward-confirm{background:#b86a00}
      .tdea-ad-reward-notice.error .tdea-ad-reward-confirm{background:#c64840}
      [data-direct-ad-reward][aria-busy="true"]{pointer-events:none;opacity:.62}
      @keyframes tdeaAdRewardFade{from{opacity:0}to{opacity:1}}
      @keyframes tdeaAdRewardPop{from{opacity:0;transform:scale(.92) translateY(10px)}to{opacity:1;transform:scale(1) translateY(0)}}
      @media (prefers-reduced-motion:reduce){.tdea-ad-reward-notice,.tdea-ad-reward-notice-card{animation:none}}
    `;
    document.head.appendChild(style);
  }

  function closeNotice() {
    document.querySelector('.tdea-ad-reward-notice')?.remove();
  }

  function showNotice({ type = 'success', title = '', points = null, message = '', balance = null }) {
    ensureStyles();
    closeNotice();

    const modal = document.createElement('div');
    modal.className = `tdea-ad-reward-notice ${type}`;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', title || '廣告贈點通知');

    const card = document.createElement('section');
    card.className = 'tdea-ad-reward-notice-card';

    const icon = document.createElement('div');
    icon.className = 'tdea-ad-reward-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = type === 'error' ? '!' : '✓';

    const heading = document.createElement('h2');
    heading.className = 'tdea-ad-reward-title';
    heading.textContent = title;
    card.append(icon, heading);

    if (points !== null && Number.isFinite(Number(points))) {
      const pointNode = document.createElement('div');
      pointNode.className = 'tdea-ad-reward-points';
      pointNode.textContent = `+${Number(points)} 點`;
      card.appendChild(pointNode);
    }

    const copy = document.createElement('p');
    copy.className = 'tdea-ad-reward-message';
    copy.textContent = message;
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
    confirm.textContent = '我知道了';
    confirm.addEventListener('click', closeNotice);
    card.appendChild(confirm);

    modal.appendChild(card);
    modal.addEventListener('click', (event) => { if (event.target === modal) closeNotice(); });
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

  function isMarqueeUrl(raw) {
    if (!raw) return false;
    try {
      const url = new URL(raw, location.href);
      return url.searchParams.has('marquee');
    } catch {
      return false;
    }
  }

  function isAdRewardControl(control) {
    if (!(control instanceof Element)) return false;
    if (control.dataset.directAdReward === '1') return true;
    if (control.matches('a[href]') && isMarqueeUrl(control.getAttribute('href') || '')) return true;
    const card = control.closest('.tdea-ad-card');
    return Boolean(card && /廣告贈點/.test(control.textContent || ''));
  }

  function prepareControl(control) {
    if (!isAdRewardControl(control)) return;
    control.dataset.directAdReward = '1';
    if (control.matches('a')) {
      control.removeAttribute('target');
      control.removeAttribute('rel');
      control.setAttribute('href', '#direct-ad-reward');
    }
    // 保留既有按鈕文字「開啟廣告贈點」，只改行為，不再導頁。
  }

  function prepareAll(root = document) {
    root.querySelectorAll?.('.tdea-ad-card a, .tdea-ad-card button, [data-direct-ad-reward]').forEach(prepareControl);
  }

  async function requestReward(control) {
    if (busy) return;
    const card = control.closest('.tdea-ad-card');
    const image = card?.querySelector('img');
    const imageUrl = control.dataset.imageUrl || image?.currentSrc || image?.src || '';
    const imageId = control.dataset.imageId || '';
    const title = control.dataset.adTitle || card?.querySelector('strong')?.textContent?.trim() || image?.alt?.trim() || 'TDEA 廣告贈點';

    if (!imageUrl && !imageId) {
      showNotice({ type: 'error', title: '贈點未完成', message: '找不到這則廣告資料，請重新整理後再試。' });
      return;
    }

    busy = true;
    control.setAttribute('aria-busy', 'true');
    const originalText = control.textContent;
    control.textContent = '贈點中...';

    try {
      const headers = { 'content-type': 'application/json' };
      const token = sessionToken();
      if (token) headers.authorization = `Bearer ${token}`;

      const response = await fetch('/v1/ad-reward', {
        method: 'POST',
        headers,
        credentials: 'same-origin',
        body: JSON.stringify({ imageUrl, imageId, title }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || payload.message || `廣告贈點失敗（HTTP ${response.status}）`);
      }

      const data = payload.data || {};
      const balance = Number(data.balance);
      updateVisibleBalance(balance);

      if (data.duplicate || data.awarded === false) {
        showNotice({
          type: 'done',
          title: '今日已領取',
          message: '這則廣告今天的贈點已領取，不會重複贈點。',
          balance,
        });
        return;
      }

      showNotice({
        type: 'success',
        title: '廣告贈點成功',
        points: Number(data.points || 0),
        message: '廣告贈點已立即入帳。',
        balance,
      });
    } catch (error) {
      showNotice({
        type: 'error',
        title: '贈點未完成',
        message: error?.message || '廣告贈點失敗',
      });
    } finally {
      control.removeAttribute('aria-busy');
      control.textContent = originalText || '開啟廣告贈點';
      busy = false;
    }
  }

  document.addEventListener('click', (event) => {
    const node = event.target instanceof Element ? event.target : null;
    const control = node?.closest('[data-direct-ad-reward], .tdea-ad-card a, .tdea-ad-card button');
    if (!isAdRewardControl(control)) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    prepareControl(control);
    requestReward(control);
  }, true);

  prepareAll();
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      record.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        if (node.matches?.('.tdea-ad-card a, .tdea-ad-card button, [data-direct-ad-reward]')) prepareControl(node);
        prepareAll(node);
      });
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
