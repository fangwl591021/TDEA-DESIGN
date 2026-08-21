(() => {
  const originalFetch = window.fetch.bind(window);
  const TELEMETRY_URL = '/v1/telemetry/event';
  const SESSION_KEY = 'tdea_usage_session_id';
  const START_KEY = 'tdea_usage_session_started';

  function getSessionId() {
    let id = sessionStorage.getItem(SESSION_KEY) || '';
    if (!id) {
      id = `web_${Date.now().toString(36)}_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  }

  function clean(value, max = 240) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function sessionToken() {
    return localStorage.getItem('klinkweb_session') || '';
  }

  function pagePath() {
    return `${location.pathname}${location.search}${location.hash}`.slice(0, 500);
  }

  function commonMetadata(extra = {}) {
    return {
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      language: navigator.language || '',
      online: navigator.onLine !== false,
      referrer: clean(document.referrer, 500),
      ...extra,
    };
  }

  function flowCategory(text = '') {
    const value = String(text || '').toLowerCase();
    if (/auth|login|登入|註冊|registerphone|phoneauth/.test(value)) return 'member_registration';
    if (/register|registration|報名|activity|course|session/.test(value)) return 'activity_registration';
    if (/daily-checkin|dailycheckin|每日簽到/.test(value)) return 'daily_checkin';
    if (/card|名片/.test(value)) return 'card';
    return '';
  }

  function isCriticalApiPath(path = '') {
    return /auth|login|register|registration|course|activity|session|daily-checkin/i.test(path);
  }

  const pageNames = {
    dashboard: '營運統計',
    members: '商脈 CRM',
    cards: '全站名片庫',
    points: '點數規則',
    courses: '課程／活動',
    calendar: '課程行事曆',
    carousel: '簽到內容管理',
    richmenu: '圖文選單',
    settings: '系統設定',
    monitoring: '問題監控',
  };

  const idLabels = {
    refresh: '重新同步營運資料',
    refreshMembers: '重新整理商脈 CRM',
    refreshAdminCards: '重新整理全站名片庫',
    exportAdminCards: '匯出名片備份',
    refreshRules: '重新整理點數規則',
    refreshCourses: '重新整理課程／活動',
    calendarRefresh: '重新整理課程行事曆',
    logout: '安全登出',
  };

  function semanticLabel(element, fallback = '') {
    const data = element?.dataset || {};
    if (data.page && pageNames[data.page]) return `進入${pageNames[data.page]}`;
    if (data.go && pageNames[data.go]) return `進入${pageNames[data.go]}`;
    if (element?.id && idLabels[element.id]) return idLabels[element.id];

    const href = element?.getAttribute?.('href') || '';
    if (/\/admin\/points\/stats/.test(href)) return '進入點數統計';
    if (href === '/' || href.startsWith('/?')) return '開啟會員前台';

    const raw = clean(fallback || element?.getAttribute?.('aria-label') || element?.textContent || element?.title || '', 180)
      .replace(/^[^\p{L}\p{N}]+/u, '')
      .trim();
    if (data.homeInline === 'daily' || data.homeAction === 'dailyCheckin') return '執行每日簽到';
    if (data.homeAction || data.homeInline) return raw ? `使用${raw}` : '使用首頁功能';
    if (data.dailyPanel) return raw ? `切換至${raw}` : `切換每日功能：${data.dailyPanel}`;
    if (data.register) return raw ? `活動報名：${raw}` : '執行活動報名';
    if (data.taskAction) return raw ? `AI 任務：${raw}` : `AI 任務：${data.taskAction}`;
    return raw || clean(fallback, 180) || '執行操作';
  }

  function semanticAction(element) {
    const data = element?.dataset || {};
    if (data.page) return `admin.page.${data.page}`;
    if (data.go) return `admin.go.${data.go}`;
    if (data.homeAction) return `home.${data.homeAction}`;
    if (data.homeInline) return `home.inline.${data.homeInline}`;
    if (data.dailyPanel) return `daily.panel.${data.dailyPanel}`;
    if (data.taskAction) return `task.${data.taskAction}`;
    if (data.register) return `activity.register.${data.register}`;
    if (element?.id) return element.id;
    return '';
  }

  function notifyRecorded(payload) {
    try {
      window.dispatchEvent(new CustomEvent('tdea:usage-recorded', { detail: { eventType: payload.eventType, action: payload.action, label: payload.label } }));
    } catch {}
  }

  function sendEvent(eventType, detail = {}) {
    const token = sessionToken();
    const payload = {
      eventType,
      sessionId: getSessionId(),
      action: clean(detail.action, 160),
      label: clean(detail.label, 240),
      path: clean(detail.path || pagePath(), 500),
      target: clean(detail.target, 240),
      clientTime: new Date().toISOString(),
      metadata: commonMetadata(detail.metadata || {}),
    };
    try {
      originalFetch(TELEMETRY_URL, {
        method: 'POST',
        credentials: 'same-origin',
        keepalive: true,
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      }).then((response) => {
        if (response.ok) notifyRecorded(payload);
      }).catch(() => {});
    } catch {}
  }

  function describeTarget(element) {
    if (!element) return { action: '', label: '', target: '' };
    const data = element.dataset || {};
    const action = semanticAction(element);
    let target = element.tagName?.toLowerCase() || '';
    if (element.id) target += `#${clean(element.id, 80)}`;
    if (data.page) target += `[page=${clean(data.page, 80)}]`;
    if (data.go) target += `[go=${clean(data.go, 80)}]`;
    if (data.homeAction) target += `[home=${clean(data.homeAction, 80)}]`;
    if (data.homeInline) target += `[inline=${clean(data.homeInline, 80)}]`;
    if (data.dailyPanel) target += `[daily=${clean(data.dailyPanel, 80)}]`;
    if (data.register) target += `[register=${clean(data.register, 80)}]`;
    if (element.getAttribute?.('href')) target += `[href=${clean(element.getAttribute('href'), 120)}]`;
    const rawLabel = element.getAttribute?.('aria-label') || element.textContent || element.title || action;
    const label = semanticLabel(element, rawLabel);
    return { action, label, target };
  }

  document.addEventListener('click', (event) => {
    const node = event.target instanceof Element ? event.target : null;
    const target = node?.closest('button,a,[role="button"],[data-page],[data-go],[data-home-action],[data-home-inline],[data-daily-panel],[data-task-action],[data-register]');
    if (!target) return;
    if (target.matches('[data-page="monitoring"]') || target.closest('[data-content="monitoring"]')) return;
    const described = describeTarget(target);
    const data = target.dataset || {};
    const behavior = data.page || data.go ? 'navigation' : data.register ? 'registration' : 'action';
    sendEvent('click', {
      ...described,
      metadata: {
        disabled: Boolean(target.disabled),
        pageTitle: clean(document.title, 160),
        behavior,
        logicalPage: data.page ? pageNames[data.page] || data.page : data.go ? pageNames[data.go] || data.go : '',
        flow: flowCategory(`${described.action} ${described.label} ${described.target}`),
      },
    });
  }, true);

  document.addEventListener('submit', (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form || form.closest('[data-content="monitoring"]')) return;
    const submitter = event.submitter instanceof Element ? event.submitter : form.querySelector('[type="submit"]');
    const described = describeTarget(submitter || form);
    const formName = clean(form.getAttribute('aria-label') || form.id || form.name || '表單', 160);
    const descriptor = `${formName} ${described.action} ${described.label}`;
    const flow = flowCategory(descriptor);
    const flowName = flow === 'member_registration' ? '會員註冊' : flow === 'activity_registration' ? '活動報名' : '';
    sendEvent('form_submit', {
      action: described.action || form.id || 'form_submit',
      label: flowName ? `送出${flowName}` : `送出${semanticLabel(submitter || form, described.label || formName)}`,
      target: `form#${clean(form.id || '', 80)}`,
      metadata: {
        form: formName,
        behavior: 'form_submit',
        flow,
      },
    });
  }, true);

  window.addEventListener('error', (event) => {
    sendEvent('js_error', {
      action: 'window.error',
      label: clean(event.message || 'JavaScript error', 240),
      metadata: {
        filename: clean(event.filename, 300),
        line: Number(event.lineno || 0),
        column: Number(event.colno || 0),
      },
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason?.message || event.reason || 'Unhandled promise rejection';
    sendEvent('unhandled_rejection', {
      action: 'unhandledrejection',
      label: clean(reason, 240),
    });
  });

  window.fetch = async (...args) => {
    const started = performance.now();
    let requestUrl = '';
    let method = 'GET';
    try {
      const input = args[0];
      const init = args[1] || {};
      requestUrl = typeof input === 'string' ? input : input?.url || '';
      method = String(init.method || input?.method || 'GET').toUpperCase();
      const response = await originalFetch(...args);
      const durationMs = Math.round(performance.now() - started);
      const url = new URL(requestUrl, location.origin);
      if (url.origin === location.origin && url.pathname.startsWith('/v1/') && url.pathname !== TELEMETRY_URL && url.pathname !== '/v1/admin/monitoring') {
        const action = `${method} ${url.pathname}`;
        const flow = flowCategory(action);
        if (!response.ok) {
          sendEvent('api_error', {
            action,
            label: `HTTP ${response.status}`,
            metadata: { status: response.status, durationMs, flow },
          });
        } else if (isCriticalApiPath(url.pathname)) {
          sendEvent('api_result', {
            action,
            label: `HTTP ${response.status}`,
            metadata: { status: response.status, durationMs, flow },
          });
        }
        if (durationMs >= 5000) {
          sendEvent('performance_warning', {
            action,
            label: `回應過慢 ${durationMs}ms`,
            metadata: { status: response.status, durationMs, flow },
          });
        }
      }
      return response;
    } catch (error) {
      const durationMs = Math.round(performance.now() - started);
      try {
        const url = new URL(requestUrl || location.href, location.origin);
        if (url.origin === location.origin && url.pathname !== TELEMETRY_URL && url.pathname !== '/v1/admin/monitoring') {
          const action = `${method} ${url.pathname}`;
          sendEvent('api_error', {
            action,
            label: clean(error?.message || 'Network error', 240),
            metadata: { status: 0, durationMs, flow: flowCategory(action) },
          });
        }
      } catch {}
      throw error;
    }
  };

  function recordEntry() {
    if (sessionStorage.getItem(START_KEY) !== '1') {
      sessionStorage.setItem(START_KEY, '1');
      sendEvent('session_start', {
        action: 'session_start',
        label: '進入系統',
        metadata: { pageTitle: clean(document.title, 160) },
      });
    }
    sendEvent('page_view', {
      action: 'page_view',
      label: location.pathname.startsWith('/admin') ? '進入營運管理中心' : clean(document.title || location.pathname, 240),
      metadata: { pageTitle: clean(document.title, 160) },
    });
  }

  if (location.pathname.startsWith('/admin')) {
    let monitorRefreshTimer = null;
    const refreshMonitorIfOpen = () => {
      if (!document.querySelector('[data-content="monitoring"]')?.classList.contains('active')) return;
      clearTimeout(monitorRefreshTimer);
      monitorRefreshTimer = setTimeout(() => document.querySelector('#monitorRefresh')?.click(), 350);
    };
    window.addEventListener('tdea:usage-recorded', refreshMonitorIfOpen);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshMonitorIfOpen(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', recordEntry, { once: true });
  else recordEntry();
})();
