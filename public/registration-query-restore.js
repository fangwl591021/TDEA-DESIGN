(() => {
  const FLAG = 'tdea_open_registration_records';

  function authHeaders() {
    const token = localStorage.getItem('klinkweb_session') || '';
    return {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'content-type': 'application/json',
    };
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
    if (label !== '課程紀錄') {
      sessionStorage.removeItem(FLAG);
      return;
    }
    sessionStorage.removeItem(FLAG);
    btn.click();
  }

  async function reportNativePayment(registrationId, queryCode, remittanceLast5, note = '') {
    const response = await fetch('/v1/tdea-activity-records/payment-report', {
      method: 'POST',
      headers: authHeaders(),
      credentials: 'same-origin',
      body: JSON.stringify({ registrationId, queryCode, remittanceLast5, note }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) throw new Error(data.error || '匯款回報失敗');
    return data;
  }

  function enhanceNativeRecord(card) {
    if (card.dataset.remittanceRestore === '1') return;
    if (card.querySelector('.tdea-record-payment,[data-tdea-payment-report]')) {
      card.dataset.remittanceRestore = '1';
      return;
    }

    const cancel = card.querySelector('[data-cancel-native-record]');
    const registrationId = String(card.dataset.nativeRecord || cancel?.dataset.cancelNativeRecord || '').trim();
    const queryCode = String(cancel?.dataset.queryCode || '').trim();
    if (!registrationId || !queryCode) return;

    card.dataset.remittanceRestore = '1';
    const wrap = document.createElement('section');
    wrap.className = 'tdea-record-payment course-remittance-restore';
    wrap.style.cssText = 'margin:14px 0;padding:14px;border:1px solid #f1d5c8;border-radius:12px;background:#fffaf7;display:grid;gap:8px';
    wrap.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
        <strong>匯款資料回填</strong>
        <span data-remit-status style="font-size:13px;color:#9a6b57">尚未回報</span>
      </div>
      <input data-remit-last5 inputmode="numeric" maxlength="5" pattern="[0-9]{5}" placeholder="輸入匯款帳號末五碼" style="min-height:44px;border:1px solid #dcc9c0;border-radius:10px;padding:8px 12px;font-size:16px;background:#fff">
      <input data-remit-note maxlength="120" placeholder="備註（選填）" style="min-height:44px;border:1px solid #dcc9c0;border-radius:10px;padding:8px 12px;font-size:16px;background:#fff">
      <button data-remit-submit type="button" class="btn">回報匯款</button>`;

    if (cancel?.parentElement) cancel.parentElement.insertBefore(wrap, cancel);
    else card.appendChild(wrap);

    const input = wrap.querySelector('[data-remit-last5]');
    const note = wrap.querySelector('[data-remit-note]');
    const status = wrap.querySelector('[data-remit-status]');
    const submit = wrap.querySelector('[data-remit-submit]');

    submit.addEventListener('click', async () => {
      const last5 = String(input.value || '').replace(/\D/g, '').slice(0, 5);
      if (last5.length !== 5) {
        status.textContent = '請輸入 5 碼';
        input.focus();
        return;
      }
      submit.disabled = true;
      submit.textContent = '送出中…';
      try {
        await reportNativePayment(registrationId, queryCode, last5, String(note.value || '').trim());
        status.textContent = '已回報，待核對';
        submit.textContent = '已送出';
        input.disabled = true;
        note.disabled = true;
      } catch (error) {
        status.textContent = error.message || '送出失敗';
        submit.disabled = false;
        submit.textContent = '回報匯款';
      }
    });
  }

  function restoreRemittanceFields() {
    document.querySelectorAll('.course-record-card.tdea-native-record').forEach(enhanceNativeRecord);
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
