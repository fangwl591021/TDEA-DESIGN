import { adjustPoints, awardPoints, getWallet } from './points.js';
import { resolveCanonicalMemberId } from './member-repository.js';

const ALLOWED_POINT_EVENTS = new Set([
  'daily_ad_checkin',
  'share_referral',
  'course_registered',
  'attendance_verified',
  'referral_attendance_reward',
  'task_completed',
  'card_collection_reward',
]);

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  },
});

function clean(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function authorized(request, env) {
  const expected = clean(env.TDEA_INTERNAL_SECRET, 512);
  if (!expected) return false;
  const provided = clean(request.headers.get('x-tdea-internal-secret'), 512);
  return provided && provided === expected;
}

async function userIdFromLineUid(db, lineUserId) {
  const uid = clean(lineUserId, 256);
  if (!uid) return '';
  const row = await db.prepare(`
    SELECT ei.platform_user_id AS user_id
    FROM external_identities ei
    JOIN platform_users pu ON pu.id = ei.platform_user_id AND pu.status = 'active'
    WHERE ei.provider = 'line_login'
      AND ei.provider_subject = ?
      AND ei.verification_status = 'verified'
    LIMIT 1
  `).bind(uid).first();
  return row?.user_id ? resolveCanonicalMemberId(db, row.user_id) : '';
}

async function readJson(request) {
  try { return await request.json(); } catch { return {}; }
}

export async function handleTdeaPointService(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/internal/tdea/points')) return null;
  if (!authorized(request, env)) return json({ success: false, error: 'Forbidden' }, 403);
  if (!env.DB) return json({ success: false, error: 'Point database is unavailable' }, 503);

  const balanceMatch = url.pathname.match(/^\/internal\/tdea\/points\/([^/]+)$/);
  if (request.method === 'GET' && balanceMatch) {
    const lineUserId = decodeURIComponent(balanceMatch[1]);
    const userId = await userIdFromLineUid(env.DB, lineUserId);
    if (!userId) return json({ success: false, error: 'LINE member not found' }, 404);
    const wallet = await getWallet(env.DB, userId);
    return json({ success: true, userId, lineUserId, ...wallet });
  }

  if (request.method === 'POST' && url.pathname === '/internal/tdea/points/adjust') {
    const body = await readJson(request);
    const lineUserId = clean(body.lineUserId, 256);
    const userId = await userIdFromLineUid(env.DB, lineUserId);
    if (!userId) return json({ success: false, error: 'LINE member not found' }, 404);
    const action = body.action === 'deduct' ? 'deduct' : body.action === 'grant' ? 'grant' : '';
    if (!action) return json({ success: false, error: 'Invalid adjustment action' }, 400);
    try {
      const result = await adjustPoints(env.DB, {
        userId,
        actorUserId: clean(body.actorUserId, 160) || null,
        action,
        points: Number(body.points),
        note: clean(body.note, 500),
        requestId: clean(body.requestId, 120),
      });
      return json({ success: true, userId, lineUserId, result, wallet: await getWallet(env.DB, userId) });
    } catch (error) {
      return json({ success: false, error: error?.message || 'Point adjustment failed' }, 400);
    }
  }

  if (request.method === 'POST' && url.pathname === '/internal/tdea/points/event') {
    const body = await readJson(request);
    const lineUserId = clean(body.lineUserId, 256);
    const userId = await userIdFromLineUid(env.DB, lineUserId);
    if (!userId) return json({ success: false, error: 'LINE member not found' }, 404);
    const eventType = clean(body.eventType, 120);
    if (!ALLOWED_POINT_EVENTS.has(eventType)) return json({ success: false, error: 'Unsupported point event' }, 400);
    const eventReference = clean(body.eventReference, 200);
    const idempotencyKey = clean(body.idempotencyKey, 240);
    if (!eventReference || !idempotencyKey) return json({ success: false, error: 'Missing point event reference' }, 400);
    try {
      const result = await awardPoints(env.DB, {
        userId,
        eventType,
        eventReference,
        idempotencyKey,
        metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
      });
      return json({ success: true, userId, lineUserId, result, wallet: await getWallet(env.DB, userId) });
    } catch (error) {
      return json({ success: false, error: error?.message || 'Point event failed' }, 400);
    }
  }

  return json({ success: false, error: 'Not found' }, 404);
}
