import app from './index.js';

let cachedSubjects = [];
let cachedUntil = 0;
let refreshPromise = null;

function clean(value) {
  return String(value || '').trim();
}

async function lineUidForMemberNo(env, memberNo) {
  const number = clean(memberNo).toUpperCase();
  if (!number || !env.DB) return '';
  const row = await env.DB.prepare(`
    SELECT ei.provider_subject AS line_user_id
    FROM member_profiles mp
    JOIN external_identities ei
      ON ei.platform_user_id = mp.platform_user_id
     AND ei.provider = 'line_login'
     AND ei.verification_status = 'verified'
    JOIN platform_users pu
      ON pu.id = mp.platform_user_id
     AND pu.status = 'active'
    WHERE UPPER(mp.roster_member_number) = ?
       OR UPPER(mp.company_member_number) = ?
    ORDER BY ei.last_verified_at DESC
    LIMIT 1
  `).bind(number, number).first();
  return clean(row?.line_user_id);
}

async function subjectsFromPayload(env, payload) {
  const direct = Array.isArray(payload?.lineUserIds)
    ? payload.lineUserIds.map(clean).filter((uid) => /^U[0-9a-f]{32}$/i.test(uid))
    : [];
  const members = Array.isArray(payload?.members) ? payload.members : [];
  const resolved = await Promise.all(members.map(async (member) => {
    const directUid = clean(member?.lineUserId);
    if (/^U[0-9a-f]{32}$/i.test(directUid)) return directUid;
    return lineUidForMemberNo(env, member?.memberNo);
  }));
  return [...new Set([...direct, ...resolved].filter((uid) => /^U[0-9a-f]{32}$/i.test(uid)))];
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
      cachedSubjects = await subjectsFromPayload(env, payload);
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
