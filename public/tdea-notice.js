(() => {
  const STYLE_ID = 'tdea-notice-style';
  const ROOT_ID = 'tdea-notice-root';
  const queue = [];
  let active = false;

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .tdea-notice-overlay{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:24px;background:rgba(16,20,24,.48);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);animation:tdeaNoticeFade .16s ease-out}
      .tdea-notice-card{width:min(352px,calc(100vw - 40px));overflow:hidden;border-radius:24px;background:#fff;box-shadow:0 24px 70px rgba(0,0,0,.22);text-align:center;transform-origin:center;animation:tdeaNoticePop .2s cubic-bezier(.2,.8,.2,1);font-family:system-ui,-apple-system,"Noto Sans TC",sans-serif;color:#1f2329}
      .tdea-notice-body{padding:28px 26px 20px}
      .tdea-notice-icon{width:58px;height:58px;margin:0 auto 16px;display:grid;place-items:center;border-radius:50%;font-size:30px;font-weight:800;line-height:1}
      .tdea-notice-card[data-type="success"] .tdea-notice-icon{background:#e8f7ef;color:#16a36a}
      .tdea-notice-card[data-type="warning"] .tdea-notice-icon{background:#fff4df;color:#d98a16}
      .tdea-notice-card[data-type="error"] .tdea-notice-icon{background:#fff0ef;color:#d94a44}
      .tdea-notice-card[data-type="info"] .tdea-notice-icon{background:#eef4ff;color:#4f75c8}
      .tdea-notice-title{margin:0;font-size:21px;line-height:1.3;font-weight:800;letter-spacing:.01em}
      .tdea-notice-message{margin:11px 0 0;color:#667085;font-size:15px;line-height:1.65;white-space:pre-line;overflow-wrap:anywhere}
      .tdea-notice-action{width:100%;min-height:54px;border:0;border-top:1px solid #edf0f3;background:#fff;color:#b95121;font:700 16px/1 system-ui,-apple-system,"Noto Sans TC",sans-serif;cursor:pointer}
      .tdea-notice-action:active{background:#faf6f3}
      @keyframes tdeaNoticeFade{from{opacity:0}to{opacity:1}}
      @keyframes tdeaNoticePop{from{opacity:.4;transform:scale(.92) translateY(8px)}to{opacity:1;transform:scale(1) translateY(0)}}
      @media (prefers-reduced-motion:reduce){.tdea-notice-overlay,.tdea-notice-card{animation:none}}
    `;
    document.head.appendChild(style);
  }

  function inferType(message) {
    const text = String(message || '');
    if (/(失敗|錯誤|無法|找不到|逾時|中斷|拒絕|invalid|error|failed)/i.test(text)) return 'error';
    if (/(請|尚未|不足|未完成|必須|確認|注意|警告|已經|已完成|不能|不可)/.test(text)) return 'warning';
    if (/(成功|已儲存|已建立|已完成|已送出|已更新|已刪除|登入成功|獲得|入帳)/.test(text)) return 'success';
    return 'info';
  }

  function titleFor(type, message) {
    const text = String(message || '');
    if (type === 'success') return /登入/.test(text) ? '登入成功' : '操作完成';
    if (type === 'error') return '操作未完成';
    if (type === 'warning') return '提醒';
    return 'TDEA 通知';
  }

  function iconFor(type) {
    if (type === 'success') return '✓';
    if (type === 'error') return '!';
    if (type === 'warning') return '!';
    return 'i';
  }

  function renderNext() {
    if (active || !queue.length || !document.body) return;
    active = true;
    ensureStyle();
    const item = queue.shift();
    const type = item.type || inferType(item.message);
    const title = item.title || titleFor(type, item.message);
    const overlay = document.createElement('div');
    overlay.id = ROOT_ID;
    overlay.className = 'tdea-notice-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', title);
    overlay.innerHTML = `
      <section class="tdea-notice-card" data-type="${type}">
        <div class="tdea-notice-body">
          <div class="tdea-notice-icon" aria-hidden="true">${iconFor(type)}</div>
          <h2 class="tdea-notice-title"></h2>
          <p class="tdea-notice-message"></p>
        </div>
        <button type="button" class="tdea-notice-action">確定</button>
      </section>`;
    overlay.querySelector('.tdea-notice-title').textContent = title;
    overlay.querySelector('.tdea-notice-message').textContent = String(item.message || '');
    const close = () => {
      overlay.remove();
      active = false;
      item.resolve?.();
      queueMicrotask(renderNext);
    };
    overlay.querySelector('.tdea-notice-action').addEventListener('click', close);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
    document.addEventListener('keydown', function escapeHandler(event) {
      if (event.key !== 'Escape' || !overlay.isConnected) return;
      document.removeEventListener('keydown', escapeHandler);
      close();
    });
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.querySelector('.tdea-notice-action')?.focus());
  }

  function show(message, options = {}) {
    return new Promise((resolve) => {
      queue.push({ message:String(message ?? ''), type:options.type, title:options.title, resolve });
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', renderNext, { once:true });
      } else renderNext();
    });
  }

  // Keep legacy call sites working while removing the browser/hostname native alert UI.
  window.alert = function tdeaAlert(message) {
    show(message);
  };
  window.tdeaNotice = show;
})();
