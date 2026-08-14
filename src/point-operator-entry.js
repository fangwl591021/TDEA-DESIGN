import app from './index.js';
import { sessionTokenFromCookie, verifySession } from './auth.js';
import { getMember, resolveCanonicalMemberId } from './member-repository.js';
import { adjustPointWallet, pointOperatorCapabilities, previewPointWallet } from './point-operator.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store' },
});

function bearerToken(request) {
  const value = request.headers.get('authorization') || '';
  return value.startsWith('Bearer ') ? value.slice(7) : '';
}

async function verifiedLineUserId(db, userId) {
  const row = await db.prepare(`
    SELECT provider_subject AS line_user_id
    FROM external_identities
    WHERE platform_user_id = ?
      AND provider = 'line_login'
      AND verification_status = 'verified'
    LIMIT 1
  `).bind(userId).first();
  return String(row?.line_user_id || '').trim();
}

async function tdeaLoginAccess(env, lineUserId, displayName = '') {
  if (!lineUserId || !env.TDEA_WORKER || typeof env.TDEA_WORKER.fetch !== 'function') return false;
  try {
    const response = await env.TDEA_WORKER.fetch('https://tdeawork.internal/api/admin-login/line', {
      method:'POST',
      headers:{ 'content-type':'application/json', accept:'application/json' },
      body:JSON.stringify({ lineUserId, displayName }),
    });
    const payload = await response.json().catch(() => ({}));
    return response.ok && payload?.success === true;
  } catch (error) {
    console.error('TDEA loginAccess lookup failed', error);
    return false;
  }
}

async function currentOperator(request, env) {
  if (!env.SESSION_SIGNING_SECRET) return null;
  const tokens = [bearerToken(request), sessionTokenFromCookie(request.headers.get('cookie') || '')].filter(Boolean);
  for (const token of new Set(tokens)) {
    const session = await verifySession(token, env.SESSION_SIGNING_SECRET);
    if (!session) continue;
    const userId = await resolveCanonicalMemberId(env.DB, session.sub);
    const member = await getMember(env.DB, userId);
    if (member?.status !== 'active') continue;
    const lineUserId = await verifiedLineUserId(env.DB, userId);
    const loginAccess = await tdeaLoginAccess(env, lineUserId, member.displayName || '');
    // Scanner authorization follows tdea-worker's existing「允許登入」(loginAccess)
    // instead of TDEA-DESIGN's separate admin permission table.
    const adminAccess = { canAccessAdmin: loginAccess };
    return { member, lineUserId, loginAccess, adminAccess };
  }
  return null;
}

async function readJson(request) {
  try { return await request.json(); } catch { return {}; }
}

async function handlePointOperator(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/v1/point-operator/')) return null;
  const operator = await currentOperator(request, env);
  if (!operator) return json({ success:false, error:'Unauthorized' }, 401);
  const capabilities = pointOperatorCapabilities(operator.adminAccess);

  if (request.method === 'GET' && url.pathname === '/v1/point-operator/access') {
    return json({
      success:true,
      capabilities,
      operator:{
        userId:operator.member.userId,
        displayName:operator.member.displayName || '',
        lineUserId:operator.lineUserId || '',
        loginAccess:operator.loginAccess === true,
      },
    });
  }

  if (request.method === 'POST' && url.pathname === '/v1/point-operator/preview') {
    try {
      const body = await readJson(request);
      return json({ success:true, ...(await previewPointWallet(env.DB, {
        rawValue:body.value,
        operatorUserId:operator.member.userId,
        adminAccess:operator.adminAccess,
      })) });
    } catch (error) {
      return json({ success:false, error:error.message || 'QR Code 驗證失敗' }, Number(error.status) || 400);
    }
  }

  if (request.method === 'POST' && url.pathname === '/v1/point-operator/adjust') {
    try {
      const body = await readJson(request);
      return json({ success:true, ...(await adjustPointWallet(env.DB, {
        rawValue:body.value,
        operatorUserId:operator.member.userId,
        adminAccess:operator.adminAccess,
        action:String(body.action || ''),
        points:body.points,
        reason:body.reason,
      })) });
    } catch (error) {
      return json({ success:false, error:error.message || '點數操作失敗' }, Number(error.status) || 400);
    }
  }

  return json({ success:false, error:'Not found' }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const response = await handlePointOperator(request, env);
    return response || app.fetch(request, env, ctx);
  },
  scheduled(controller, env, ctx) {
    return app.scheduled?.(controller, env, ctx);
  },
};
