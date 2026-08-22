(() => {
  const token = localStorage.getItem('klinkweb_session') || '';
  const $ = (selector) => document.querySelector(selector);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
  const format = (value) => new Intl.NumberFormat('zh-TW').format(Number(value) || 0);

  async function api(path) {
    const response = await fetch(path, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      credentials: 'same-origin',
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) throw new Error(payload.error || payload.message || '操作失敗');
    return payload;
  }

  function formatTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('zh-TW', {
      year:'numeric', month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit', hour12:false,
    }).format(date);
  }

  function activityCard(activity) {
    const capacityText = activity.capacity ? format(activity.capacity) : '不限';
    const progress = activity.registrationRate === null ? '' : `
      <div class="ops-progress-wrap">
        <div class="ops-progress-label"><span>報名進度</span><b>${activity.registrationRate}%</b></div>
        <div class="ops-progress"><i style="width:${Math.max(0, Math.min(100, Number(activity.registrationRate) || 0))}%"></i></div>
      </div>`;
    const detail = [activity.courseTime, activity.deadline ? `截止：${activity.deadline}` : ''].filter(Boolean).join('｜');
    const keys = encodeURIComponent((activity.keys || []).join(','));
    return `<article class="ops-activity">
      <div class="ops-activity-head">
        <div class="ops-activity-title">
          <h3>${esc(activity.title)}</h3>
          <p>${esc(detail || activity.type || '活動時間未設定')}</p>
        </div>
        <span class="ops-status">${esc(activity.status || '上架')}</span>
      </div>
      <div class="ops-metrics">
        <div><span>報名</span><strong>${format(activity.registered)}</strong></div>
        <div><span>容量</span><strong>${capacityText}</strong></div>
        <div><span>已報到</span><strong>${format(activity.checkedIn)}</strong></div>
      </div>
      ${progress}
      ${activity.degraded ? '<div class="ops-degraded">報名名單同步暫時較慢，數字可能稍後更新。</div>' : ''}
      <div class="ops-actions">
        <button type="button" data-ops-registration-keys="${keys}" data-ops-registration-title="${esc(activity.title)}">查看報名名單</button>
        ${activity.id ? `<a href="/admin?activity=${encodeURIComponent(activity.id)}">完整管理</a>` : '<a href="/admin">完整管理</a>'}
      </div>
    </article>`;
  }

  function closeSheet() {
    $('#opsRegistrations').hidden = true;
    document.body.style.overflow = '';
  }

  async function openRegistrations(button) {
    const keys = decodeURIComponent(button.dataset.opsRegistrationKeys || '');
    const title = button.dataset.opsRegistrationTitle || '報名名單';
    $('#opsSheetTitle').textContent = title;
    $('#opsRegistrationBody').innerHTML = '<div class="ops-sheet-loading">正在讀取報名名單…</div>';
    $('#opsRegistrations').hidden = false;
    document.body.style.overflow = 'hidden';
    try {
      const data = await api(`/v1/ops-registrations?keys=${encodeURIComponent(keys)}`);
      const rows = Array.isArray(data.data) ? data.data : [];
      $('#opsRegistrationBody').innerHTML = rows.length ? rows.map((row) => `
        <article class="ops-registration-row">
          <div>
            <strong>${esc(row.name || '未填姓名')}</strong>
            <small>${esc([row.memberNo, row.phone, row.submittedAt ? `報名 ${formatTime(row.submittedAt)}` : ''].filter(Boolean).join('｜'))}</small>
          </div>
          <span class="ops-registration-state ${row.checkedIn ? 'done' : ''}">${row.checkedIn ? '已報到' : '未報到'}</span>
        </article>`).join('') : '<div class="ops-sheet-empty">目前沒有報名資料。</div>';
    } catch (error) {
      $('#opsRegistrationBody').innerHTML = `<div class="ops-sheet-empty">${esc(error.message || '報名名單讀取失敗')}</div>`;
    }
  }

  function bindActivityButtons() {
    document.querySelectorAll('[data-ops-registration-keys]').forEach((button) => {
      button.addEventListener('click', () => openRegistrations(button));
    });
  }

  async function loadDashboard() {
    $('#opsLoading').hidden = false;
    $('#opsContent').hidden = true;
    $('#opsError').hidden = true;
    try {
      const data = await api('/v1/ops-dashboard');
      $('#opsActivityCount').textContent = format(data.summary?.activities);
      $('#opsRegistrationCount').textContent = format(data.summary?.registrations);
      $('#opsCheckinCount').textContent = format(data.summary?.checkedIn);
      const activities = Array.isArray(data.activities) ? data.activities : [];
      $('#opsActivityList').innerHTML = activities.length
        ? activities.map(activityCard).join('')
        : '<div class="ops-empty">目前沒有上架中的活動。</div>';
      $('#opsUpdatedAt').textContent = `最後更新：${formatTime(data.generatedAt)}`;
      bindActivityButtons();
      $('#opsLoading').hidden = true;
      $('#opsContent').hidden = false;
    } catch (error) {
      $('#opsLoading').hidden = true;
      $('#opsError').hidden = false;
      $('#opsErrorMessage').textContent = error.message || '營運資料暫時無法讀取';
    }
  }

  $('#opsRefresh').addEventListener('click', loadDashboard);
  $('#opsRetry').addEventListener('click', loadDashboard);
  document.querySelectorAll('[data-close-ops-sheet]').forEach((node) => node.addEventListener('click', closeSheet));
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeSheet(); });
  loadDashboard();
})();
