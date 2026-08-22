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

async function readActivities(env) {
  return readTdea(env, '/api/activities', 'tdea activities', 3600);
}

function activityRows(payload) {
  const rows = Array.isArray(payload?.data?.activities)
    ? payload.data.activities
    : Array.isArray(payload?.activities)
      ? payload.activities
      : Array.isArray(payload?.data)
        ? payload.data
        : [];

  return rows
    .filter((row) => {
      const status = clean(row?.status || row?.['狀態'], 40).toLowerCase();
      if (row?.archived === true || row?.deleted === true || clean(row?.deletedAt, 80)) return false;
      return !['已封存', '封存', 'archived'].includes(status);
    })
    .slice(0, 50);
}

function isLiveActivity(activity) {
  const status = clean(activity?.status || activity?.['狀態'], 40).toLowerCase();
  return status === '上架' || ['published', 'active', 'open', '進行中'].includes(status);
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
  const payload = await readTdea(env, `/api/registrations/list?keys=${query}`, 'tdea registrations', 4200);
  return Array.isArray(payload?.data) ? payload.data : [];
}

function checkedIn(row) {
  if (row?.checkedInAt) return true;
  const text = clean(row?.checkinStatusText, 80);
  return /已完成|已報到|已簽到|已核銷/.test(text);
}

function activityView(activity) {
  const capacity = Math.max(0, Number(activity?.capacity) || 0);
  // 完全沿用 TDEA 後台活動總覽的統計欄位：reg / check。
  const registered = Math.max(0, Number(activity?.reg) || 0);
  const checked = Math.max(0, Number(activity?.check) || 0);
  return {
    id: clean(activity?.id, 180),
    activityNo: clean(activity?.activityNo, 100),
    title: clean(activity?.name || activity?.title || '未命名活動', 220),
    type: clean(activity?.typeLabel || activity?.type, 80),
    courseTime: clean(activity?.courseTime, 160),
    deadline: clean(activity?.deadline, 160),
    status: clean(activity?.status || '未設定', 40),
    live: isLiveActivity(activity),
    capacity,
    registered,
    checkedIn: checked,
    remaining: capacity ? Math.max(0, capacity - registered) : null,
    registrationRate: capacity ? Math.min(100, Math.round((registered / capacity) * 100)) : null,
    keys: registrationKeys(activity),
    source: 'tdeawork',
  };
}

async function opsDashboard(env) {
  const activitiesPayload = await readActivities(env);
  const activities = activityRows(activitiesPayload);
  const views = activities.map(activityView);
  return {
    success: true,
    source: 'tdeawork:/api/activities',
    generatedAt: new Date().toISOString(),
    summary: {
      // 與 TDEA 後台 dashboard() 完全一致：activities.length / 上架 / reg / check。
      activities: views.length,
      live: views.filter((item) => item.live).length,
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
      // TDEA-DESIGN 只負責登入權限；以下營運數字全部取自 tdeawork。
      if (!await requireAdmin(request, env, ctx)) return json({ success: false, error: '沒有營運管理權限' }, 403);
      try {
        return json(await opsDashboard(env));
      } catch (error) {
        console.error('Mobile ops dashboard failed', { error: String(error) });
        return json({ success: false, error: 'TDEA 後台營運資料暫時無法讀取' }, 502);
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
        return json({ success: true, source: 'tdeawork:/api/registrations/list', total: rows.length, data: rows.map(registrationView) });
      } catch (error) {
        console.error('Mobile ops registrations failed', { error: String(error) });
        return json({ success: false, error: 'TDEA 後台報名名單暫時無法讀取' }, 502);
      }
    }

    return app.fetch(request, env, ctx);
  },
  scheduled(controller, env, ctx) {
    return app.scheduled?.(controller, env, ctx);
  },
};
