(() => {
  const FLAG = 'tdea_open_registration_records';

  function authHeaders() {
    const token = localStorage.getItem('klinkweb_session') || '';
    return { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' };
  }

  function restoreDailyTab() {
    const tabs = document.querySelector('.daily-panel-tabs');
    if (!tabs || tabs.querySelector('[data-registration-query-restore]')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'daily-top-tab';
    btn.textContent = '報名查詢';
    btn.setAttribute('data-registration-query-restore', '1');
    btn.addEventListener('click', () => {
      sessionStorage.setItem(FLAG, '1');
      const url = new URL(location.href);
      url.searchParams.set('tab', 'courses');
      url.searchParams.delete('checkin');
      location.href = url.toString();
    });
    tabs.appendChild(btn);
  }

  function openCourseRecordsIfRequested() {
    if (sessionStorage.getItem(FLAG) !== '1') return;
    const btn = document.querySelector('.course-record-tag');
    if (!btn) return;
    const label = (btn.textContent || '').trim();
    if (label !== '課程紀錄') { sessionStorage.removeItem(FLAG); return; }
    sessionStorage.removeItem(FLAG);
    btn.click();
  }

  async function reportPayment(registrationId, queryCode, remittanceLast5, note = '') {
    const response = await fetch('/v1/tdea-activity-records/payment-report', {
      method: 'POST', headers: authHeaders(), credentials: 'same-origin',
      body: JSON.stringify({ registrationId, queryCode, remittanceLast5, note }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) throw new Error(data.error || '匯款回報失敗');
    return data;
  }

  function isNativeRecord(card) {
    if (card.classList.contains('tdea-native-record')) return true;
    const small = card.querySelector('.course-record-top small');
    return (small?.textContent || '').trim() === '活動紀錄';
  }

  function enhance(card) {
    if (!isNativeRecord(card)) return;
    if (card.dataset.remittanceRestore === '1') return;
    if (card.querySelector('.tdea-record-payment,[data-tdea-payment-report],.course-remittance-restore')) {
      card.dataset.remittanceRestore = '1';
      return;
    }

    const cancel = [...card.querySelectorAll('button')].find((b) => (b.textContent || '').includes('取消報名'));
    if (!cancel) return;

    card.dataset.remittanceRestore = '1';
    const wrap = document.createElement('section');
    wrap.className = 'course-remittance-restore';
    wrap.style.cssText = 'margin:12px 0 10px;padding:14px;border:1px solid #efcfbf;border-radius:12px;background:#fff8f3;display:grid;gap:9px';
    wrap.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:center"><strong>匯款資料回填</strong><span data-remit-status style="font-size:13px;color:#9a6b57">尚未回報</span></div>
      <input data-remit-last5 inputmode="numeric" maxlength="5" placeholder="輸入匯款帳號末五碼" style="width:100%;min-height:44px;border:1px solid #dcc9c0;border-radius:10px;padding:8px 12px;font-size:16px;background:#fff">
      <input data-remit-note maxlength="120" placeholder="備註（選填）" style="width:100%;min-height:44px;border:1px solid #dcc9c0;border-radius:10px;padding:8px 12px;font-size:16px;background:#fff">
      <button data-remit-submit type="button" class="btn" style="margin:0">回報匯款</button>`;
    cancel.parentElement.insertBefore(wrap, cancel);

    const input = wrap.querySelector('[data-remit-last5]');
    const note = wrap.querySelector('[data-remit-note]');
    const status = wrap.querySelector('[data-remit-status]');
    const submit = wrap.querySelector('[data-remit-submit]');

    submit.addEventListener('click', async () => {
      const registrationId = String(card.dataset.nativeRecord || cancel.dataset.cancelNativeRecord || '').trim();
      const queryCode = String(cancel.dataset.queryCode || '').trim();
      const last5 = String(input.value || '').replace(/\D/g, '').slice(0, 5);
      if (last5.length !== 5) { status.textContent = '請輸入完整 5 碼'; input.focus(); return; }
      if (!registrationId || !queryCode) { status.textContent = '缺少報名識別資料'; return; }
      submit.disabled = true; submit.textContent = '送出中…';
      try {
        await reportPayment(registrationId, queryCode, last5, String(note.value || '').trim());
        status.textContent = '已回報，待核對'; submit.textContent = '已送出'; input.disabled = true; note.disabled = true;
      } catch (error) {
        status.textContent = error.message || '送出失敗'; submit.disabled = false; submit.textContent = '回報匯款';
      }
    });
  }

  function run() {
    restoreDailyTab();
    openCourseRecordsIfRequested();
    document.querySelectorAll('.course-record-card').forEach(enhance);
  }

  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true });
  run();
})();
