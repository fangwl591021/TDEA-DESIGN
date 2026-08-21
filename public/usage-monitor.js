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
      }).catch(() => {});
    } catch {}
  }

  function describeTarget(element) {
    if (!element) return { action: '', label: '', target: '' };
    const data = element.dataset || {};
    const action = data.homeAction || data.homeInline || data.dailyPanel || data.taskAction || data.courseView || data.phoneAuthMode || element.id || '';
    let target = element.tagName?.toLowerCase() || '';
    if (element.id) target += `#${clean(element.id, 80)}`;
    if (data.homeAction) target += `[home=${clean(data.homeAction, 80)}]`;
    if (data.homeInline) target += `[inline=${clean(data.homeInline, 80)}]`;
    if (data.dailyPanel) target += `[daily=${clean(data.dailyPanel, 80)}]`;
    if (element.getAttribute?.('href')) target += `[href=${clean(element.getAttribute('href'), 120)}]`;
    return {
      action,
      label: clean(element.getAttribute?.('aria-label') || element.textContent || element.title || action, 240),
      target,
    };
  }

  document.addEventListener('click', (event) => {
    const node = event.target instanceof Element ? event.target : null;
    const target = node?.closest('button,a,[role="button"],[data-home-action],[data-home-inline],[data-daily-panel],[data-task-action]');
    if (!target) return;
    const described = describeTarget(target);
    sendEvent('click', {
      ...described,
      metadata: {
        disabled: Boolean(target.disabled),
        pageTitle: clean(document.title, 160),
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
      const url = new URL(requestUrl, location.origin);
      if (url.origin === location.origin && url.pathname.startsWith('/v1/') && url.pathname !== TELEMETRY_URL && !response.ok) {
        sendEvent('api_error', {
          action: `${method} ${url.pathname}`,
          label: `HTTP ${response.status}`,
          metadata: {
            status: response.status,
            durationMs: Math.round(performance.now() - started),
          },
        });
      }
      return response;
    } catch (error) {
      try {
        const url = new URL(requestUrl || location.href, location.origin);
        if (url.origin === location.origin && url.pathname !== TELEMETRY_URL) {
          sendEvent('api_error', {
            action: `${method} ${url.pathname}`,
            label: clean(error?.message || 'Network error', 240),
            metadata: { status: 0, durationMs: Math.round(performance.now() - started) },
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
