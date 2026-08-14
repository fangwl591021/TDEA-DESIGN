(() => {
  const sessionToken = () => localStorage.getItem('klinkweb_session') || '';
  const api = async (path, options = {}) => {
    const headers = { ...(sessionToken() ? { authorization:`Bearer ${sessionToken()}` } : {}), ...(options.headers || {}) };
    if (!(options.body instanceof FormData)) headers['content-type'] = 'application/json';
    const response = await fetch(path, { credentials:'same-origin', ...options, headers });
    const payload = await response.json().catch(()=>({}));
    if (!response.ok) throw new Error(payload.error || '操作失敗');
    return payload;
  };
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let activeScanValue = '';
  let liffReady = null;

  function ensureStyle() {
    if (document.querySelector('#pointOperatorStyle')) return;
    const style = document.createElement('style');
    style.id = 'pointOperatorStyle';
    style.textContent = `
      .ak-wordmark{cursor:pointer}.point-op-layer{position:fixed;inset:0;z-index:99999;display:grid;place-items:center;padding:20px;background:#2f1d16aa}.point-op-sheet{width:min(440px,100%);max-height:90vh;overflow:auto;background:#fff;border-radius:24px;padding:22px;box-shadow:0 18px 50px #1f120d55;color:#3d2920}.point-op-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.point-op-head h2{margin:0;color:#b95121}.point-op-close{border:0;background:#b95121;color:#fff;width:42px;height:42px;border-radius:50%;font-size:25px}.point-op-member{display:grid;grid-template-columns:58px 1fr;gap:12px;align-items:center;margin:18px 0;padding:14px;border-radius:16px;background:#fff6f0}.point-op-member img,.point-op-avatar{width:58px;height:58px;border-radius:50%;object-fit:cover;background:#ead7cc;display:grid;place-items:center;font-weight:800}.point-op-balance{font-size:34px;color:#b95121;font-weight:900}.point-op-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px}.point-op-actions button,.point-op-form button{min-height:48px;border:0;border-radius:14px;font-weight:800}.point-op-grant{background:#e8f6ee;color:#137347}.point-op-deduct{background:#fff0ec;color:#b43b22}.point-op-form{display:grid;gap:12px;margin-top:16px}.point-op-form input,.point-op-form textarea{width:100%;padding:12px;border:1px solid #dcc8bd;border-radius:12px;font:inherit}.point-op-confirm{background:#b95121;color:#fff}.point-op-cancel{background:#f2ece8;color:#6a5044}.point-op-hint{font-size:13px;color:#80685d;line-height:1.55}.point-op-error{color:#b42318;background:#fff0ee;padding:12px;border-radius:12px}`;
    document.head.appendChild(style);
  }

  function closeModal() { document.querySelector('.point-op-layer')?.remove(); }
  function modal(markup) {
    closeModal(); ensureStyle();
    const layer = document.createElement('div'); layer.className = 'point-op-layer';
    layer.innerHTML = `<section class="point-op-sheet" role="dialog" aria-modal="true">${markup}</section>`;
    layer.addEventListener('click', e => { if (e.target === layer || e.target.closest('[data-point-op-close]')) closeModal(); });
    document.body.appendChild(layer); return layer;
  }

  async function initLiff() {
    if (!window.liff) throw new Error('請從 LINE LIFF 開啟 TDEA 後再使用掃碼');
    if (!liffReady) liffReady = (async()=>{
      const config = await fetch('/api/config', { credentials:'same-origin' }).then(r=>r.json());
      if (!config?.liffId) throw new Error('尚未設定 LIFF');
      await liff.init({ liffId:config.liffId });
    })().catch(e => { liffReady = null; throw e; });
    return liffReady;
  }

  function showMember(data) {
    const member = data.member || {}, wallet = data.wallet || {}, caps = data.capabilities || {};
    const layer = modal(`<div class="point-op-head"><div><small>TDEA 點數收銀台</small><h2>會員點數操作</h2></div><button class="point-op-close" data-point-op-close>×</button></div>
      <div class="point-op-member">${member.pictureUrl ? `<img src="${esc(member.pictureUrl)}" alt="">` : `<div class="point-op-avatar">${esc((member.displayName || '會').slice(0,1))}</div>`}<div><strong>${esc(member.displayName || '會員')}</strong><div>${esc(member.memberNumber || '')}</div></div></div>
      <div>目前點數</div><div class="point-op-balance">${Number(wallet.balance || 0).toLocaleString('zh-TW')} 點</div>
      <div class="point-op-actions">${caps.canCreditPoints ? '<button class="point-op-grant" data-point-action="grant">＋ 贈點</button>' : ''}${caps.canDebitPoints ? '<button class="point-op-deduct" data-point-action="deduct">－ 扣點</button>' : ''}</div>
      <p class="point-op-hint">交易成功後，本次 60 秒動態 QR 會立即失效。</p>`);
    layer.querySelectorAll('[data-point-action]').forEach(btn => btn.onclick = () => showForm(data, btn.dataset.pointAction));
  }

  function showForm(data, action) {
    const isDeduct = action === 'deduct';
    const layer = modal(`<div class="point-op-head"><div><small>${esc(data.member?.displayName || '會員')}</small><h2>${isDeduct ? '扣除點數' : '贈送點數'}</h2></div><button class="point-op-close" data-point-op-close>×</button></div>
      <p>目前餘額：<strong>${Number(data.wallet?.balance || 0).toLocaleString('zh-TW')} 點</strong></p>
      <form class="point-op-form"><label>點數<input name="points" type="number" min="1" max="1000000" step="1" required></label><label>${isDeduct ? '用途' : '原因'}<textarea name="reason" maxlength="500" required placeholder="例如：商品兌換、活動獎勵"></textarea></label><div class="point-op-hint" data-after-balance></div><button type="submit" class="point-op-confirm">確認${isDeduct ? '扣點' : '贈點'}</button><button type="button" class="point-op-cancel" data-back>返回</button></form>`);
    const form = layer.querySelector('form');
    const amount = form.elements.points;
    const after = layer.querySelector('[data-after-balance]');
    const refresh = () => { const n = Number(amount.value || 0); const current = Number(data.wallet?.balance || 0); after.textContent = n > 0 ? `完成後餘額：${(isDeduct ? current - n : current + n).toLocaleString('zh-TW')} 點` : ''; };
    amount.addEventListener('input', refresh);
    layer.querySelector('[data-back]').onclick = () => showMember(data);
    form.onsubmit = async e => {
      e.preventDefault();
      const points = Number(amount.value), reason = String(form.elements.reason.value || '').trim();
      if (!Number.isInteger(points) || points <= 0 || !reason) return;
      if (isDeduct && points > Number(data.wallet?.balance || 0)) return alert('扣除點數不可超過目前餘額');
      if (!confirm(`確認${isDeduct ? '扣除' : '贈送'} ${points} 點？`)) return;
      const button = form.querySelector('.point-op-confirm'); button.disabled = true; button.textContent = '處理中…';
      try {
        const result = await api('/v1/point-operator/adjust', { method:'POST', body:JSON.stringify({ value:activeScanValue, action, points, reason }) });
        modal(`<div class="point-op-head"><h2>${isDeduct ? '扣點成功' : '贈點成功'}</h2><button class="point-op-close" data-point-op-close>×</button></div><p>${esc(result.member?.displayName || '')}</p><div class="point-op-balance">${Number(result.wallet?.balance || 0).toLocaleString('zh-TW')} 點</div><p class="point-op-hint">本次 QR Code 已失效。</p>`);
      } catch (err) { alert(err.message); button.disabled = false; button.textContent = `確認${isDeduct ? '扣點' : '贈點'}`; }
    };
  }

  async function startScan() {
    try {
      const access = await api('/v1/point-operator/access');
      if (!access.capabilities?.canScanPoints) return alert('此功能僅限授權點數管理人員使用');
      await initLiff();
      if (typeof liff.scanCodeV2 !== 'function') throw new Error('目前 LIFF 不支援掃描，請確認 LIFF 為 Full 並啟用 Scan QR');
      const scanned = await liff.scanCodeV2();
      activeScanValue = String(scanned?.value || '').trim();
      if (!activeScanValue) return;
      const preview = await api('/v1/point-operator/preview', { method:'POST', body:JSON.stringify({ value:activeScanValue }) });
      showMember(preview);
    } catch (error) {
      if (/cancel/i.test(String(error?.message || ''))) return;
      alert(error.message || '掃碼失敗');
    }
  }

  document.addEventListener('click', event => {
    const wordmark = event.target.closest('.ak-wordmark');
    if (!wordmark) return;
    event.preventDefault(); startScan();
  });
})();
