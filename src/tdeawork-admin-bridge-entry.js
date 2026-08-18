import app from './index.js';

let cachedSubjects = [];
let cachedUntil = 0;
let refreshPromise = null;

function clean(value) {
  return String(value || '').trim();
}

async function loadTdeaWorkerSubjects(env) {
  if (Date.now() < cachedUntil) return cachedSubjects;
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      if (!env.TDEA_WORKER?.fetch) return [];
      const response = await env.TDEA_WORKER.fetch(new Request(
        'https://tdea-permission.internal/api/internal/tdea-design/admin-subjects',
        { method: 'GET', headers: { accept: 'application/json' } },
      ));
      if (!response.ok) return [];
      const payload = await response.json().catch(() => null);
      const subjects = Array.isArray(payload?.lineUserIds)
        ? payload.lineUserIds.map(clean).filter((uid) => /^U[0-9a-f]{32}$/i.test(uid))
        : [];
      cachedSubjects = [...new Set(subjects)];
      cachedUntil = Date.now() + 10_000;
      return cachedSubjects;
    } catch (error) {
      console.warn('tdeawork admin subject bridge failed', error);
      return [];
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

function mergeSubjects(configured, bridged) {
  const all = [
    ...String(configured || '').split(',').map(clean).filter(Boolean),
    ...(Array.isArray(bridged) ? bridged : []),
  ];
  return [...new Set(all)].join(',');
}

export default {
  async fetch(request, env, ctx) {
    const bridgedSubjects = await loadTdeaWorkerSubjects(env);
    if (!bridgedSubjects.length) return app.fetch(request, env, ctx);

    const bridgedEnv = {
      ...env,
      ADMIN_LINE_SUBJECTS: mergeSubjects(env.ADMIN_LINE_SUBJECTS, bridgedSubjects),
    };
    return app.fetch(request, bridgedEnv, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof app.scheduled !== 'function') return;
    const bridgedSubjects = await loadTdeaWorkerSubjects(env);
    const bridgedEnv = bridgedSubjects.length
      ? { ...env, ADMIN_LINE_SUBJECTS: mergeSubjects(env.ADMIN_LINE_SUBJECTS, bridgedSubjects) }
      : env;
    return app.scheduled(controller, bridgedEnv, ctx);
  },
};
