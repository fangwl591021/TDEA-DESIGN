import app from './ad-reward-no-link-entry.js';

const clean = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store, no-cache, must-revalidate',
  },
});

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function requireAdmin(request, env, ctx) {
  const url = new URL(request.url);
  url.pathname = '/v1/admin/overview';
  url.search = '';
  const response = await app.fetch(new Request(url.toString(), {
    method: 'GET',
    headers: request.headers,
  }), env, ctx);
  return response.ok;
}

async function readTdea(env, path, label, timeoutMs = 3200) {
  if (!env.TDEA_WORKER || typeof env.TDEA_WORKER.fetch !== 'function') {
    throw new Error('TDEA service binding unavailable');
  }
  const response = await withTimeout(
    env.TDEA_WORKER.fetch(`https://tdea.internal${path}`, {
      headers: { accept: 'application/json' },
    }),
    timeoutMs,
    label,
  );
  const text = await withTimeout(response.text(), 1500, `${label} body`);
  const payload = JSON.parse(text || '{}');
  if (!response.ok || payload?.success === false) {
    throw new Error(clean(payload?.message || payload?.error, 240) || `${label} HTTP ${response.status}`);
  }
  return payload;
}

function activityRows(payload) {
  const rows = Array.isArray(payload?.data?.activities)
    ? payload.data.activities
    : Array.isArray(payload?.activities)
      ? payload.activities
      : [];
  const active = rows.filter((row) => {
    const status = clean(row?.status, 40).toLowerCase();
    if (!status) return true;
    return ['上架', 'published', 'active', 'open', '進行中'].includes(status);
  });
  return (active.length ? active : rows.filter((row) => !['封存', 'archived'].includes(clean(row?.status, 40).toLowerCase())))
    .slice(0, 20);
}

function registrationKeys(activity) {
  return [
    activity?.id,
    activity?.activityNo,
    activity?.formId,
    activity?.nativeFormId,
    activity?.googleFormId,
    activity?.opnformFormId,
    activity?.name,
  ]
    .map((value) => clean(value, 220))
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index)
    .slice(0, 10);
}

async function registrationRows(env, keys) {
  if (!keys.length) return [];
  const query = keys.map(encodeURIComponent).join(',');
  const payload = await readTdea(env, `/api/registrations/list?keys=${query}`, 'registrations', 3600);
  return Array.isArray(payload?.data) ? payload.data : [];
}

function checkedIn(row) {
  if (row?.checkedInAt) return true;
  const text = clean(row?.checkinStatusText, 80);
  return /已完成|已報到|已簽到|已核銷/.test(text);
}

function activityView(activity, rows = [], degraded = false) {
  const capacity = Math.max(0, Number(activity?.capacity) || 0);
  const registered = rows.length;
  const checked = rows.filter(checkedIn).length;
  return {
    id: clean(activity?.id, 180),
    activityNo: clean(activity?.activityNo, 100),
    title: clean(activity?.name || activity?.title || '未命名活動', 220),
    type: clean(activity?.typeLabel || activity?.type, 80),
    courseTime: clean(activity?.courseTime, 160),
    deadline: clean(activity?.deadline, 160),
    status: clean(activity?.status || '上架', 40),
    capacity,
    registered,
    checkedIn: checked,
    remaining: capacity ? Math.max(0, capacity - registered) : null,
    registrationRate: capacity ? Math.min(100, Math.round((registered / capacity) * 100)) : null,
    keys: registrationKeys(activity),
    degraded,
  };
}

async function opsDashboard(env) {
  const activitiesPayload = await readTdea(env, '/api/activities', 'activities');
  const activities = activityRows(activitiesPayload);
  const registrationResults = await Promise.allSettled(
    activities.map((activity) => registrationRows(env, registrationKeys(activity))),
  );
  const views = activities.map((activity, index) => {
    const result = registrationResults[index];
    return activityView(activity, result?.status === 'fulfilled' ? result.value : [], result?.status !== 'fulfilled');
  });
  return {
    success: true,
    generatedAt: new Date().toISOString(),
    summary: {
      activities: views.length,
      registrations: views.reduce((sum, item) => sum + item.registered, 0),
      checkedIn: views.reduce((sum, item) => sum + item.checkedIn, 0),
    },
    activities: views,
  };
}

function answerPick(answers, keys) {
  if (!answers || typeof answers !== 'object') return '';
  for (const key of keys) {
    const direct = answers[key];
    if (direct !== undefined && direct !== null && String(direct).trim()) return clean(direct, 220);
  }
  const entries = Object.entries(answers);
  for (const [key, value] of entries) {
    const normalized = String(key).toLowerCase().replace(/\s+/g, '');
    if (keys.some((candidate) => normalized.includes(String(candidate).toLowerCase().replace(/\s+/g, '')))) {
      if (value !== undefined && value !== null && String(value).trim()) return clean(value, 220);
    }
  }
  return '';
}

function registrationView(row) {
  const answers = row?.answers || row?.data || {};
  return {
    id: clean(row?.id || row?.registrationId, 180),
    name: answerPick(answers, ['name', '姓名', 'memberName']) || clean(row?.name, 120) || '未填姓名',
    memberNo: answerPick(answers, ['memberNo', '會員編號']) || clean(row?.memberNo, 80),
    phone: answerPick(answers, ['phone', 'mobile', '手機', '電話']) || clean(row?.phone, 80),
    submittedAt: clean(row?.submittedAt || row?.createdAt || row?.timestamp, 120),
    checkedInAt: clean(row?.checkedInAt, 120),
    checkedIn: checkedIn(row),
  };
}

async function serveOpsPage(request, env) {
  if (!env.ASSETS || typeof env.ASSETS.fetch !== 'function') return null;
  const url = new URL(request.url);
  url.pathname = '/ops.html';
  url.search = '';
  const response = await env.ASSETS.fetch(new Request(url.toString(), {
    method: 'GET',
    headers: request.headers,
  }));
  if (!response.ok) return response;
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-store, no-cache, must-revalidate');
  headers.delete('content-length');
  return new Response(response.body, { status: response.status, headers });
}

async function patchMainApp(request, env, ctx) {
  const response = await app.fetch(request, env, ctx);
  if (!response.ok) return response;
  const source = await response.text();
  const patched = source
    .split('href=\\"/admin\\">營運管理後台').join('href=\\"/ops\\">營運管理後台')
    .split('href="/admin">營運管理後台').join('href="/ops">營運管理後台');
  const headers = new Headers(response.headers);
  headers.set('content-type', 'text/javascript; charset=utf-8');
  headers.set('cache-control', 'no-store, no-cache, must-revalidate');
  headers.delete('content-length');
  return new Response(patched, { status: response.status, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/app-20260803-123.js') {
      return patchMainApp(request, env, ctx);
    }

    if (request.method === 'GET' && (url.pathname === '/ops' || url.pathname === '/ops.html')) {
      const page = await serveOpsPage(request, env);
      if (page) return page;
    }

    if (request.method === 'GET' && url.pathname === '/v1/ops-dashboard') {
      if (!await requireAdmin(request, env, ctx)) return json({ success: false, error: '沒有營運管理權限' }, 403);
      try {
        return json(await opsDashboard(env));
      } catch (error) {
        console.error('Mobile ops dashboard failed', { error: String(error) });
        return json({ success: false, error: '營運資料暫時無法讀取' }, 502);
      }
    }

    if (request.method === 'GET' && url.pathname === '/v1/ops-registrations') {
      if (!await requireAdmin(request, env, ctx)) return json({ success: false, error: '沒有營運管理權限' }, 403);
      const keys = (url.searchParams.get('keys') || '')
        .split(',')
        .map((value) => clean(value, 220))
        .filter(Boolean)
        .slice(0, 10);
      if (!keys.length) return json({ success: false, error: '缺少活動識別資料' }, 400);
      try {
        const rows = await registrationRows(env, keys);
        return json({ success: true, total: rows.length, data: rows.map(registrationView) });
      } catch (error) {
        console.error('Mobile ops registrations failed', { error: String(error) });
        return json({ success: false, error: '報名名單暫時無法讀取' }, 502);
      }
    }

    return app.fetch(request, env, ctx);
  },
  scheduled(controller, env, ctx) {
    return app.scheduled?.(controller, env, ctx);
  },
};
