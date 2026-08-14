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
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));
  let activeScanValue = '';
  let scanStarting = false;

  function closeModal() { document.querySelector('.point-op-layer')?.remove(); }
  function modal(markup) {
    closeModal();
    const layer = document.createElement('div');
    layer.className = 'point-op-layer';
    layer.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:20px;background:#2f1d16aa';
    layer.innerHTML = `<section style="width:min(440px,100%);max-height:90vh;overflow:auto;background:#fff;border-radius:24px;padding:22px;box-shadow:0 18px 50px #1f120d55;color:#3d2920">${markup}</section>`;
    layer.addEventListener('click', e => { if (e.target === layer || e.target.closest('[data-point-op-close]')) closeModal(); });
    document.body.appendChild(layer);
    return layer;
  }

  function showMember(data) {
    const member = data.member || {}, wallet = data.wallet || {}, caps = data.capabilities || {};
    const layer = modal(`<div style="display:flex;justify-content:space-between;align-items:center"><div><small>TDEA 點數收銀台</small><h2 style="margin:4px 0;color:#b95121">會員點數操作</h2></div><button data-point-op-close style="border:0;border-radius:50%;width:40px;height:40px;background:#b95121;color:white;font-size:24px">×</button></div><div style="margin:16px 0;padding:14px;border-radius:14px;background:#fff6f0"><strong>${esc(member.displayName || '會員')}</strong><div>${esc(member.memberNumber || '')}</div></div><div>目前點數</div><div style="font-size:34px;font-weight:900;color:#b95121">${Number(wallet.balance || 0).toLocaleString('zh-TW')} 點</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px">${caps.canCreditPoints ? '<button data-point-action="grant" style="min-height:48px;border:0;border-radius:14px;font-weight:800;background:#e8f6ee;color:#137347">＋ 贈點</button>' : ''}${caps.canDebitPoints ? '<button data-point-action="deduct" style="min-height:48px;border:0;border-radius:14px;font-weight:800;background:#fff0ec;color:#b43b22">－ 扣點</button>' : ''}</div>`);
    layer.querySelectorAll('[data-point-action]').forEach(btn => btn.onclick = () => showForm(data, btn.dataset.pointAction));
  }

  function showForm(data, action) {
    const isDeduct = action === 'deduct';
    const current = Number(data.wallet?.balance || 0);
    const layer = modal(`<div style="display:flex;justify-content:space-between;align-items:center"><h2 style="margin:0;color:#b95121">${isDeduct ? '扣除' : '贈送'}點數</h2><button data-point-op-close style="border:0;border-radius:50%;width:40px;height:40px;background:#b95121;color:white;font-size:24px">×</button></div><p>目前餘額：<b>${current.toLocaleString('zh-TW')} 點</b></p><label style="display:grid;gap:6px;margin:12px 0">點數<input name="points" type="number" min="1" step="1" style="padding:12px;border:1px solid #dcc8bd;border-radius:10px"></label><label style="display:grid;gap:6px;margin:12px 0">${isDeduct ? '用途' : '原因'}<textarea name="reason" rows="3" style="padding:12px;border:1px solid #dcc8bd;border-radius:10px"></textarea></label><button data-submit style="width:100%;min-height:48px;border:0;border-radius:14px;background:#b95121;color:#fff;font-weight:800">確認${isDeduct ? '扣點' : '贈點'}</button>`);
    layer.querySelector('[data-submit]').onclick = async () => {
      const points = Number(layer.querySelector('[name="points"]').value);
      const reason = String(layer.querySelector('[name="reason"]').value || '').trim();
      if (!Number.isInteger(points) || points <= 0) return alert('請輸入正整數點數');
      if (!reason) return alert('請輸入原因');
      if (isDeduct && points > current) return alert('扣除點數不可超過目前餘額');
      if (!confirm(`確認${isDeduct ? '扣除' : '贈送'} ${points} 點？`)) return;
      try {
        const result = await api('/v1/point-operator/adjust', { method:'POST', body:JSON.stringify({ value:activeScanValue, action, points, reason }) });
        modal(`<button data-point-op-close style="float:right;border:0;border-radius:50%;width:40px;height:40px;background:#b95121;color:white;font-size:24px">×</button><h2 style="color:#b95121">${isDeduct ? '扣點' : '贈點'}成功</h2><p>${esc(result.member?.displayName || '')}</p><div style="font-size:34px;font-weight:900;color:#b95121">${Number(result.wallet?.balance || 0).toLocaleString('zh-TW')} 點</div><p>本次 QR Code 已失效。</p>`);
      } catch (error) { alert(error.message || '點數操作失敗'); }
    };
  }

  async function startScan() {
    if (scanStarting) return;
    scanStarting = true;
    try {
      modal('<h2 style="color:#b95121">TDEA 點數掃碼</h2><p>正在檢查操作權限…</p>');
      const access = await api('/v1/point-operator/access');
      if (!access.capabilities?.canScanPoints) throw new Error('此功能僅限授權點數管理人員使用');
      if (!window.liff) throw new Error('LINE LIFF 尚未載入');
      if (typeof liff.scanCodeV2 !== 'function') throw new Error('目前 LIFF 不支援 Scan QR，請確認 LIFF 為 Full 並啟用 Scan QR');
      closeModal();
      const scanned = await liff.scanCodeV2();
      activeScanValue = String(scanned?.value || '').trim();
      if (!activeScanValue) return;
      modal('<h2 style="color:#b95121">已掃描</h2><p>正在讀取會員資料…</p>');
      const preview = await api('/v1/point-operator/preview', { method:'POST', body:JSON.stringify({ value:activeScanValue }) });
      showMember(preview);
    } catch (error) {
      closeModal();
      if (!/cancel/i.test(String(error?.message || ''))) alert(error.message || '掃碼失敗');
    } finally {
      scanStarting = false;
    }
  }

  function bindAvatar() {
    const avatar = document.querySelector('.ak-member-avatar');
    if (!avatar || avatar.dataset.pointScanBound === '1') return;
    avatar.dataset.pointScanBound = '1';
    avatar.dataset.homeAction = 'pointScan';
    avatar.setAttribute('aria-label', '掃描會員點數 QR Code');
    avatar.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      startScan();
      return false;
    };
  }

  const observer = new MutationObserver(bindAvatar);
  observer.observe(document.documentElement, { childList:true, subtree:true });
  document.addEventListener('DOMContentLoaded', bindAvatar);
  bindAvatar();
})();