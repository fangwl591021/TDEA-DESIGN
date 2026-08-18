(() => {
  const FLAG = 'tdea_open_registration_records';

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
    if (label !== '課程紀錄') {
      sessionStorage.removeItem(FLAG);
      return;
    }
    sessionStorage.removeItem(FLAG);
    btn.click();
  }

  async function remitApi(sessionId, options = {}) {
    const token = localStorage.getItem('klinkweb_session') || '';
    const headers = { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) };
    if (options.body) headers['content-type'] = 'application/json';
    const url = options.method === 'POST' ? '/v1/course-remittance' : `/v1/course-remittance?sessionId=${encodeURIComponent(sessionId)}`;
    const response = await fetch(url, { ...options, headers, credentials: 'same-origin' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) throw new Error(data.error || '匯款資料處理失敗');
    return data;
  }

  function statusText(status) {
    if (status === '匯款審核中') return '匯款審核中';
    if (status === '已完款' || status === '已繳費' || status === '已收款') return '已確認收款';
    return '未繳費';
  }

  async function enhanceRecordCard(card) {
    if (card.dataset.remittanceRestore === '1') return;
    if (card.querySelector('.course-status.cancelled')) return;
    const sessionId = (card.querySelector('.course-record-id')?.textContent || '').trim();
    if (!sessionId) return;
    card.dataset.remittanceRestore = '1';

    const wrap = document.createElement('div');
    wrap.className = 'course-remittance-restore';
    wrap.style.cssText = 'margin-top:14px;padding-top:14px;border-top:1px solid #eaded7;';
    wrap.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:8px">
        <strong style="font-size:14px">匯款資料回填</strong>
        <span data-remit-status style="font-size:13px;color:#9a6b57">讀取中…</span>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <input data-remit-last5 type="text" inputmode="numeric" maxlength="5" placeholder="請輸入匯款後五碼" style="min-width:0;flex:1;height:44px;border:1px solid #e6cfc4;border-radius:12px;padding:0 12px;font-size:15px;background:#fff" />
        <button data-remit-submit type="button" class="btn" style="width:auto;min-width:112px;height:44px;margin:0">送出審核</button>
      </div>`;

    const cancel = [...card.querySelectorAll('button')].find(b => (b.textContent || '').includes('取消報名'));
    if (cancel?.parentElement) cancel.parentElement.insertBefore(wrap, cancel);
    else card.appendChild(wrap);

    const input = wrap.querySelector('[data-remit-last5]');
    const status = wrap.querySelector('[data-remit-status]');
    const submit = wrap.querySelector('[data-remit-submit]');

    try {
      const data = await remitApi(sessionId);
      const remittance = data.remittance || {};
      input.value = remittance.last5Digits || '';
      status.textContent = statusText(remittance.paymentStatus);
      if (['已完款','已繳費','已收款'].includes(remittance.paymentStatus)) {
        input.disabled = true;
        submit.disabled = true;
        submit.textContent = '已確認';
      }
    } catch (error) {
      status.textContent = '未繳費';
    }

    submit.addEventListener('click', async () => {
      const last5Digits = String(input.value || '').replace(/\D/g, '').slice(0, 5);
      if (last5Digits.length < 4) {
        status.textContent = '請輸入正確後五碼';
        input.focus();
        return;
      }
      submit.disabled = true;
      const old = submit.textContent;
      submit.textContent = '送出中…';
      try {
        const data = await remitApi(sessionId, { method:'POST', body: JSON.stringify({ sessionId, last5Digits }) });
        input.value = data.remittance?.last5Digits || last5Digits;
        status.textContent = '匯款審核中';
        submit.textContent = '已送出';
      } catch (error) {
        status.textContent = error.message || '送出失敗';
        submit.disabled = false;
        submit.textContent = old;
      }
    });
  }

  function restoreRemittanceFields() {
    document.querySelectorAll('.course-record-card').forEach(enhanceRecordCard);
  }

  function run() {
    restoreDailyTab();
    openCourseRecordsIfRequested();
    restoreRemittanceFields();
  }

  const observer = new MutationObserver(run);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  run();
})();
