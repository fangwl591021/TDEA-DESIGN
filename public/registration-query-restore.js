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

  function run() {
    restoreDailyTab();
    openCourseRecordsIfRequested();
  }

  const observer = new MutationObserver(run);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  run();
})();
