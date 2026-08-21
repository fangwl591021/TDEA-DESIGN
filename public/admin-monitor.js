(() => {
  const token = localStorage.getItem('klinkweb_session') || '';
  let refreshTimer = null;
  const state = { hours: 24, eventType: '', q: '' };
  const eventNames = {
    session_start: '進入系統',
    page_view: '瀏覽頁面',
    click: '按鈕點擊',
    api_error: 'API 錯誤',
    js_error: 'JS 錯誤',
    unhandled_rejection: '程式例外',
  };

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = (value) => new Intl.NumberFormat('zh-TW').format(Number(value) || 0);
  const timeText = (value) => {
    const date = new Date(`${String(value || '').replace(' ', 'T')}Z`);
    return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('zh-TW', { timeZone:'Asia/Taipei', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false }).format(date) : String(value || '');
  };

  function injectStyles() {
    if (document.getElementById('admin-monitor-style')) return;
    const style = document.createElement('style');
    style.id = 'admin-monitor-style';
    style.textContent = `
      .monitor-metrics{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-bottom:18px}.monitor-metrics article{padding:18px;border:1px solid #dfe9e4;border-radius:16px;background:#fff}.monitor-metrics small{display:block;color:#7b8b83;margin-bottom:8px}.monitor-metrics strong{font-size:28px;color:#173d2c}.monitor-metrics article.error strong{color:#c7443e}.monitor-toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px}.monitor-toolbar select,.monitor-toolbar input{height:42px;border:1px solid #cfdcd5;border-radius:10px;background:#fff;padding:0 12px;font:inherit}.monitor-toolbar input{min-width:260px}.monitor-toolbar .auto{margin-left:auto;color:#527063;font-size:13px}.monitor-top-actions{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 18px}.monitor-chip{padding:7px 10px;border-radius:999px;background:#eef8f2;color:#2d6d4e;font-size:13px}.monitor-table-wrap{overflow:auto;border:1px solid #e0e8e4;border-radius:14px}.monitor-table{width:100%;border-collapse:collapse;min-width:1080px;background:#fff}.monitor-table th,.monitor-table td{padding:11px 12px;border-bottom:1px solid #edf1ef;text-align:left;vertical-align:top;font-size:13px}.monitor-table th{position:sticky;top:0;background:#f7faf8;color:#557064;z-index:1}.monitor-table tr.error-row{background:#fff6f5}.monitor-user b,.monitor-action b{display:block;color:#243b31}.monitor-user small,.monitor-action small,.monitor-path small{display:block;color:#8a9992;margin-top:3px}.monitor-event{display:inline-flex;padding:4px 8px;border-radius:999px;background:#eff5f2;color:#3c6552;font-weight:700}.monitor-event.error{background:#ffe7e5;color:#b83e38}.monitor-event.click{background:#e9f2ff;color:#37679b}.monitor-event.session{background:#e8f8ed;color:#287447}.monitor-empty{padding:36px;text-align:center;color:#7a8b83}.monitor-detail{max-width:300px;white-space:normal;word-break:break-word;color:#5c6d65}.monitor-live{display:inline-flex;align-items:center;gap:6px}.monitor-live i{width:8px;height:8px;border-radius:50%;background:#19b66a;box-shadow:0 0 0 4px #19b66a18}@media(max-width:1000px){.monitor-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.monitor-toolbar .auto{margin-left:0;width:100%}}
    `;
    document.head.appendChild(style);
  }

  function injectUI() {
    if (document.querySelector('[data-page="monitoring"]')) return;
    injectStyles();
    const firstNav = document.querySelector('.sidebar .side-nav');
    const button = document.createElement('button');
    button.className = 'nav-item';
    button.dataset.page = 'monitoring';
    button.innerHTML = '<span>◉</span> 行為監控';
    firstNav?.appendChild(button);

    const main = document.querySelector('.main');
    const section = document.createElement('section');
    section.className = 'page';
    section.dataset.content = 'monitoring';
    section.innerHTML = `
      <div class="monitor-metrics">
        <article><small>目前在線（10 分鐘）</small><strong id="monitorActive">–</strong></article>
        <article><small>進站人數</small><strong id="monitorVisitors">–</strong></article>
        <article><small>頁面瀏覽</small><strong id="monitorViews">–</strong></article>
        <article><small>按鈕點擊</small><strong id="monitorClicks">–</strong></article>
        <article class="error"><small>錯誤事件</small><strong id="monitorErrors">–</strong></article>
      </div>
      <section class="panel">
        <div class="panel-head"><div><h2>會員操作軌跡</h2><p>記錄進站、頁面瀏覽、按鈕點擊與前端/API 錯誤。只記操作，不記輸入欄位內容。</p></div><button class="secondary" type="button" id="monitorRefresh">立即刷新</button></div>
        <div class="monitor-toolbar">
          <select id="monitorHours"><option value="1">最近 1 小時</option><option value="24" selected>最近 24 小時</option><option value="168">最近 7 天</option><option value="720">最近 30 天</option></select>
          <select id="monitorType"><option value="">全部事件</option><option value="session_start">進入系統</option><option value="page_view">瀏覽頁面</option><option value="click">按鈕點擊</option><option value="api_error">API 錯誤</option><option value="js_error">JS 錯誤</option><option value="unhandled_rejection">程式例外</option></select>
          <input id="monitorSearch" type="search" placeholder="搜尋會員、會員編號、按鈕、頁面…">
          <span class="auto monitor-live"><i></i> 每 10 秒自動刷新</span>
        </div>
        <div id="monitorTopActions" class="monitor-top-actions"></div>
        <div class="monitor-table-wrap"><table class="monitor-table"><thead><tr><th>時間</th><th>會員／訪客</th><th>事件</th><th>操作</th><th>頁面</th><th>裝置／結果</th></tr></thead><tbody id="monitorRows"><tr><td colspan="6" class="monitor-empty">尚未載入監控資料</td></tr></tbody></table></div>
      </section>`;
    main?.appendChild(section);

    button.addEventListener('click', () => openMonitoring());
    section.querySelector('#monitorRefresh')?.addEventListener('click', loadMonitoring);
    section.querySelector('#monitorHours')?.addEventListener('change', (event) => { state.hours = Number(event.target.value || 24); loadMonitoring(); });
    section.querySelector('#monitorType')?.addEventListener('change', (event) => { state.eventType = event.target.value || ''; loadMonitoring(); });
    let searchTimer = null;
    section.querySelector('#monitorSearch')?.addEventListener('input', (event) => {
      state.q = event.target.value || '';
      clearTimeout(searchTimer);
      searchTimer = setTimeout(loadMonitoring, 350);
    });

    document.querySelectorAll('.sidebar [data-page]:not([data-page="monitoring"])').forEach((node) => node.addEventListener('click', stopAutoRefresh));
  }

  function openMonitoring() {
    document.querySelectorAll('[data-content]').forEach((node) => node.classList.toggle('active', node.dataset.content === 'monitoring'));
    document.querySelectorAll('.sidebar [data-page]').forEach((node) => node.classList.toggle('active', node.dataset.page === 'monitoring'));
    const title = document.querySelector('#pageTitle');
    const hint = document.querySelector('#pageHint');
    if (title) title.textContent = '行為監控中心';
    if (hint) hint.textContent = '即時追蹤進站會員、按鈕操作與錯誤事件';
    loadMonitoring();
    startAutoRefresh();
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    refreshTimer = setInterval(() => {
      if (document.visibilityState === 'visible' && document.querySelector('[data-content="monitoring"]')?.classList.contains('active')) loadMonitoring();
    }, 10000);
  }
  function stopAutoRefresh() { if (refreshTimer) clearInterval(refreshTimer); refreshTimer = null; }

  async function api(path) {
    const response = await fetch(path, { headers: { authorization: `Bearer ${token}` }, credentials:'same-origin' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || '監控資料讀取失敗');
    return payload;
  }

  function eventClass(type) {
    if (['api_error','js_error','unhandled_rejection'].includes(type)) return 'error';
    if (type === 'click') return 'click';
    if (type === 'session_start') return 'session';
    return '';
  }

  function eventDetail(event) {
    const meta = event.metadata || {};
    if (event.event_type === 'api_error') return `${event.label || 'API 錯誤'}${meta.durationMs ? `｜${meta.durationMs}ms` : ''}`;
    if (['js_error','unhandled_rejection'].includes(event.event_type)) return event.label || '程式錯誤';
    const bits = [meta.viewport, event.country ? `地區 ${event.country}` : '', event.cf_ray ? `Ray ${event.cf_ray}` : ''].filter(Boolean);
    return bits.join('｜');
  }

  function renderRows(events) {
    const tbody = document.querySelector('#monitorRows');
    if (!tbody) return;
    if (!events.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="monitor-empty">這個條件目前沒有監控紀錄</td></tr>';
      return;
    }
    tbody.innerHTML = events.map((event) => {
      const isError = ['api_error','js_error','unhandled_rejection'].includes(event.event_type);
      const userName = event.display_name || (event.platform_user_id ? '已登入會員' : '未登入訪客');
      const userSub = event.member_number || (event.platform_user_id ? event.platform_user_id : `Session ${String(event.session_id || '').slice(-10)}`);
      const device = /Mobile|Android|iPhone/i.test(event.user_agent || '') ? '手機' : '電腦';
      return `<tr class="${isError ? 'error-row' : ''}">
        <td>${esc(timeText(event.created_at))}</td>
        <td class="monitor-user"><b>${esc(userName)}</b><small>${esc(userSub)}</small></td>
        <td><span class="monitor-event ${eventClass(event.event_type)}">${esc(eventNames[event.event_type] || event.event_type)}</span></td>
        <td class="monitor-action"><b>${esc(event.label || event.action || '–')}</b><small>${esc(event.action || event.target || '')}</small></td>
        <td class="monitor-path"><b>${esc(event.path || '–')}</b><small>${esc(event.target || '')}</small></td>
        <td class="monitor-detail"><b>${esc(device)}</b><small>${esc(eventDetail(event))}</small></td>
      </tr>`;
    }).join('');
  }

  async function loadMonitoring() {
    const rows = document.querySelector('#monitorRows');
    if (rows && !rows.dataset.loaded) rows.innerHTML = '<tr><td colspan="6" class="monitor-empty">監控資料讀取中…</td></tr>';
    const params = new URLSearchParams({ hours:String(state.hours), limit:'300' });
    if (state.eventType) params.set('eventType', state.eventType);
    if (state.q.trim()) params.set('q', state.q.trim());
    try {
      const data = await api(`/v1/admin/monitoring?${params}`);
      document.querySelector('#monitorActive').textContent = fmt(data.summary.activeNow);
      document.querySelector('#monitorVisitors').textContent = fmt(data.summary.visitors);
      document.querySelector('#monitorViews').textContent = fmt(data.summary.pageViews);
      document.querySelector('#monitorClicks').textContent = fmt(data.summary.clicks);
      document.querySelector('#monitorErrors').textContent = fmt(data.summary.errors);
      const top = document.querySelector('#monitorTopActions');
      if (top) top.innerHTML = data.topActions?.length ? data.topActions.map((item) => `<span class="monitor-chip">${esc(item.label || item.action || '未命名按鈕')} × ${fmt(item.count)}</span>`).join('') : '<span class="monitor-chip">尚無按鈕操作統計</span>';
      renderRows(data.events || []);
      if (rows) rows.dataset.loaded = '1';
    } catch (error) {
      if (rows) rows.innerHTML = `<tr><td colspan="6" class="monitor-empty">${esc(error.message || '監控資料讀取失敗')}</td></tr>`;
    }
  }

  const boot = () => injectUI();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();
