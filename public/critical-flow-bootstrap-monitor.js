(() => {
  if (window.__tdeaCriticalFlowBootstrapInstalled) return;
  window.__tdeaCriticalFlowBootstrapInstalled = true;

  const originalFetch = window.fetch.bind(window);
  const TELEMETRY_URL = '/v1/telemetry/event';
  const SESSION_KEY = 'tdea_usage_session_id';
  let active = true;

  const clean = (value, max = 240) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  const sessionToken = () => localStorage.getItem('klinkweb_session') || '';
  const pagePath = () => `${location.pathname}${location.search}${location.hash}`.slice(0, 500);

  function getSessionId() {
    let id = sessionStorage.getItem(SESSION_KEY) || '';
    if (!id) {
      id = `web_${Date.now().toString(36)}_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
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
      metadata: {
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        language: navigator.language || '',
        online: navigator.onLine !== false,
        source: 'critical_flow_bootstrap',
        ...(detail.metadata || {}),
      },
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

  function courseSessionFromLocation() {
    const params = new URLSearchParams(location.search);
    if (params.get('courseSession')) return params.get('courseSession');
    const liffState = params.get('liff.state');
    if (!liffState) return '';
    try { return new URL(liffState, location.origin).searchParams.get('courseSession') || ''; }
    catch { return ''; }
  }

  function describeCriticalRequest(url, method) {
    const path = url.pathname;
    const registration = path.match(/^\/v1\/course-sessions\/([^/]+)\/register$/);
    if (registration && method === 'POST') {
      return {
        flow: 'activity_registration',
        action: `activity.register.${decodeURIComponent(registration[1])}`,
        startLabel: '送出活動報名',
        successLabel: '活動報名成功',
        errorLabel: '活動報名失敗',
        sessionId: decodeURIComponent(registration[1]),
      };
    }
    if (/\/v1\/(auth|session|member|profile|registration)/i.test(path) && method !== 'GET') {
      return {
        flow: 'member_registration',
        action: `${method} ${path}`,
        startLabel: '送出會員註冊／登入',
        successLabel: '會員註冊／登入成功',
        errorLabel: '會員註冊／登入失敗',
        sessionId: '',
      };
    }
    return null;
  }

  const linkedSessionId = courseSessionFromLocation();
  if (linkedSessionId) {
    sendEvent('click', {
      action: `activity.entry.${linkedSessionId}`,
      label: '從活動連結進入報名',
      target: 'courseSession',
      metadata: { flow: 'activity_registration', sessionId: linkedSessionId, behavior: 'entry_intent' },
    });
  }

  window.fetch = async (...args) => {
    const startedAt = performance.now();
    const input = args[0];
    const init = args[1] || {};
    const requestUrl = typeof input === 'string' ? input : input?.url || '';
    const method = String(init.method || input?.method || 'GET').toUpperCase();
    let url = null;
    try { url = new URL(requestUrl, location.origin); } catch {}
    const descriptor = active && url && url.origin === location.origin ? describeCriticalRequest(url, method) : null;

    if (descriptor) {
      sendEvent('form_submit', {
        action: descriptor.action,
        label: descriptor.startLabel,
        target: url.pathname,
        metadata: { flow: descriptor.flow, sessionId: descriptor.sessionId, behavior: 'startup_request' },
      });
    }

    try {
      const response = await originalFetch(...args);
      if (descriptor) {
        const durationMs = Math.round(performance.now() - startedAt);
        sendEvent(response.ok ? 'api_result' : 'api_error', {
          action: descriptor.action,
          label: response.ok ? descriptor.successLabel : `${descriptor.errorLabel}｜HTTP ${response.status}`,
          target: url.pathname,
          metadata: { flow: descriptor.flow, sessionId: descriptor.sessionId, status: response.status, durationMs },
        });
        if (durationMs >= 5000) {
          sendEvent('performance_warning', {
            action: descriptor.action,
            label: `${descriptor.startLabel}回應過慢｜${durationMs}ms`,
            target: url.pathname,
            metadata: { flow: descriptor.flow, sessionId: descriptor.sessionId, status: response.status, durationMs },
          });
        }
      }
      return response;
    } catch (error) {
      if (descriptor) {
        const durationMs = Math.round(performance.now() - startedAt);
        sendEvent('api_error', {
          action: descriptor.action,
          label: `${descriptor.errorLabel}｜${clean(error?.message || 'Network error', 160)}`,
          target: url?.pathname || '',
          metadata: { flow: descriptor.flow, sessionId: descriptor.sessionId, status: 0, durationMs },
        });
      }
      throw error;
    }
  };

  document.addEventListener('DOMContentLoaded', () => { active = false; }, { once: true });
})();
