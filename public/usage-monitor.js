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
    const action = data.homeAction || data.homeInline || data.dailyPanel || data.taskAction || data.courseView || data.phoneAuthMode || data.register || element.id || '';
    let target = element.tagName?.toLowerCase() || '';
    if (element.id) target += `#${clean(element.id, 80)}`;
    if (data.homeAction) target += `[home=${clean(data.homeAction, 80)}]`;
    if (data.homeInline) target += `[inline=${clean(data.homeInline, 80)}]`;
    if (data.dailyPanel) target += `[daily=${clean(data.dailyPanel, 80)}]`;
    if (data.register) target += `[register=${clean(data.register, 80)}]`;
    if (element.getAttribute?.('href')) target += `[href=${clean(element.getAttribute('href'), 120)}]`;
    const label = clean(element.getAttribute?.('aria-label') || element.textContent || element.title || action, 240);
    return { action, label, target };
  }

  document.addEventListener('click', (event) => {
    const node = event.target instanceof Element ? event.target : null;
    const target = node?.closest('button,a,[role="button"],[data-home-action],[data-home-inline],[data-daily-panel],[data-task-action],[data-register]');
    if (!target) return;
    const described = describeTarget(target);
    sendEvent('click', {
      ...described,
      metadata: {
        disabled: Boolean(target.disabled),
        pageTitle: clean(document.title, 160),
        flow: flowCategory(`${described.action} ${described.label} ${described.target}`),
      },
    });
  }, true);

  document.addEventListener('submit', (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form) return;
    const submitter = event.submitter instanceof Element ? event.submitter : form.querySelector('[type="submit"]');
    const described = describeTarget(submitter || form);
    const formName = clean(form.getAttribute('aria-label') || form.id || form.name || '表單送出', 160);
    const descriptor = `${formName} ${described.action} ${described.label}`;
    sendEvent('form_submit', {
      action: described.action || form.id || 'form_submit',
      label: described.label || formName,
      target: `form#${clean(form.id || '', 80)}`,
      metadata: {
        form: formName,
        flow: flowCategory(descriptor),
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
      if (url.origin === location.origin && url.pathname.startsWith('/v1/') && url.pathname !== TELEMETRY_URL) {
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
        if (url.origin === location.origin && url.pathname !== TELEMETRY_URL) {
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
      label: clean(document.title || location.pathname, 240),
      metadata: { pageTitle: clean(document.title, 160) },
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', recordEntry, { once: true });
  else recordEntry();
})();
