import app from './index.js';
import { sessionTokenFromCookie, verifySession } from './auth.js';
import { getMember, newId, resolveCanonicalMemberId } from './member-repository.js';
import { adjustPointWallet, pointOperatorCapabilities, previewPointWallet } from './point-operator.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store' },
});

function bearerToken(request) {
  const value = request.headers.get('authorization') || '';
  return value.startsWith('Bearer ') ? value.slice(7) : '';
}

async function currentSessionMember(request, env) {
  if (!env.SESSION_SIGNING_SECRET) return null;
  const tokens = [bearerToken(request), sessionTokenFromCookie(request.headers.get('cookie') || '')].filter(Boolean);
  for (const token of new Set(tokens)) {
    const session = await verifySession(token, env.SESSION_SIGNING_SECRET);
    if (!session) continue;
    const userId = await resolveCanonicalMemberId(env.DB, session.sub);
    const member = await getMember(env.DB, userId);
    if (member?.status === 'active') return member;
  }
  return null;
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
  const member = await currentSessionMember(request, env);
  if (!member) return null;
  const lineUserId = await verifiedLineUserId(env.DB, member.userId);
  const loginAccess = await tdeaLoginAccess(env, lineUserId, member.displayName || '');
  const adminAccess = { canAccessAdmin: loginAccess };
  return { member, lineUserId, loginAccess, adminAccess };
}

function taipeiBusinessDate(now = new Date()) {
  const taipei = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return taipei.toISOString().slice(0, 10);
}

async function fixedDailyCheckIn(db, userId) {
  const date = taipeiBusinessDate();
  const idempotencyKey = `daily_checkin_simple:${date}:${userId}`;
  const existing = await db.prepare(`
    SELECT id, delta, balance_after
    FROM point_ledger_entries
    WHERE idempotency_key = ?
    LIMIT 1
  `).bind(idempotencyKey).first();
  if (existing) {
    return { ok:true, duplicate:true, pointResult:{ awarded:false, duplicate:true, entry:existing }, businessDate:date };
  }

  let account = await db.prepare(`
    SELECT id, balance FROM point_accounts
    WHERE platform_user_id = ? AND program_id = 'program_main'
    LIMIT 1
  `).bind(userId).first();
  if (!account) {
    await db.prepare(`
      INSERT OR IGNORE INTO point_accounts (id, platform_user_id, program_id, balance)
      VALUES (?, ?, 'program_main', 0)
    `).bind(newId('pointacct'), userId).run();
    account = await db.prepare(`
      SELECT id, balance FROM point_accounts
      WHERE platform_user_id = ? AND program_id = 'program_main'
      LIMIT 1
    `).bind(userId).first();
  }

  const balanceAfter = Number(account?.balance || 0) + 1;
  const entryId = newId('ledger');
  try {
    await db.batch([
      db.prepare(`
        UPDATE point_accounts
        SET balance = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(balanceAfter, account.id),
      db.prepare(`
        INSERT INTO point_ledger_entries
          (id, point_account_id, platform_user_id, program_id, point_rule_id,
           event_type, event_reference, idempotency_key, delta, balance_after, metadata_json)
        VALUES (?, ?, ?, 'program_main', NULL,
                'daily_ad_checkin', ?, ?, 1, ?, ?)
      `).bind(
        entryId,
        account.id,
        userId,
        date,
        idempotencyKey,
        balanceAfter,
        JSON.stringify({ source:'simple_daily_checkin', businessDate:date }),
      ),
    ]);
  } catch (error) {
    if (String(error?.message || '').includes('UNIQUE constraint failed: point_ledger_entries.idempotency_key')) {
      const duplicate = await db.prepare(`SELECT id, delta, balance_after FROM point_ledger_entries WHERE idempotency_key = ?`).bind(idempotencyKey).first();
      return { ok:true, duplicate:true, pointResult:{ awarded:false, duplicate:true, entry:duplicate }, businessDate:date };
    }
    throw error;
  }
  return {
    ok:true,
    duplicate:false,
    pointResult:{ awarded:true, duplicate:false, entry:{ id:entryId, delta:1, balanceAfter } },
    businessDate:date,
  };
}

async function readJson(request) {
  try { return await request.json(); } catch { return {}; }
}

async function handleSimpleDailyCheckin(request, env) {
  const url = new URL(request.url);
  if (request.method !== 'POST' || url.pathname !== '/v1/daily-ad/check-in') return null;
  const member = await currentSessionMember(request, env);
  if (!member) return json({ success:false, error:'Unauthorized' }, 401);
  try {
    const result = await fixedDailyCheckIn(env.DB, member.userId);
    return json({ success:true, ...result });
  } catch (error) {
    console.error('Simple daily check-in failed', error);
    return json({ success:false, error:error?.message || '每日簽到失敗' }, 500);
  }
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
    const dailyResponse = await handleSimpleDailyCheckin(request, env);
    if (dailyResponse) return dailyResponse;
    const pointResponse = await handlePointOperator(request, env);
    return pointResponse || app.fetch(request, env, ctx);
  },
  scheduled(controller, env, ctx) {
    return app.scheduled?.(controller, env, ctx);
  },
};
