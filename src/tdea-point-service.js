import { adjustPoints, awardPoints, getWallet } from './points.js';
import { getMember, newId, resolveCanonicalMemberId, resolveLineMember } from './member-repository.js';

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

async function memberProfileFromUserId(db, userId) {
  if (!userId) return null;
  return db.prepare(`
    SELECT mp.platform_user_id AS user_id, mp.display_name, mp.full_name, mp.phone, mp.email,
      mp.gender, mp.birthday, mp.member_number, mp.company_member_number, mp.member_type,
      mp.roster_member_number, mp.roster_verified_at, mp.roster_verified_name, mp.roster_source,
      mp.profile_completed_at
    FROM member_profiles mp
    JOIN platform_users pu ON pu.id = mp.platform_user_id AND pu.status = 'active'
    WHERE mp.platform_user_id = ? LIMIT 1
  `).bind(userId).first();
}

function publicMemberProfile(row) {
  if (!row) return null;
  return {
    userId: row.user_id || '', displayName: row.display_name || '', fullName: row.full_name || '',
    phone: row.phone || '', email: row.email || '', gender: row.gender || '', birthday: row.birthday || '',
    memberNumber: row.member_number || '', companyMemberNumber: row.company_member_number || '',
    memberType: row.member_type || 'general', rosterMemberNumber: row.roster_member_number || '',
    rosterVerifiedAt: row.roster_verified_at || '', rosterVerifiedName: row.roster_verified_name || '',
    rosterSource: row.roster_source || '', profileCompletedAt: row.profile_completed_at || ''
  };
}

async function userIdFromRosterNumber(db, memberNo) {
  const normalized = clean(memberNo, 120).toUpperCase();
  if (!normalized) return '';
  const row = await db.prepare(`
    SELECT mp.platform_user_id AS user_id
    FROM member_profiles mp
    JOIN platform_users pu ON pu.id = mp.platform_user_id AND pu.status = 'active'
    WHERE UPPER(mp.roster_member_number) = ? OR UPPER(mp.company_member_number) = ?
    ORDER BY pu.created_at ASC
    LIMIT 1
  `).bind(normalized, normalized).first();
  return row?.user_id ? resolveCanonicalMemberId(db, row.user_id) : '';
}

async function attachLineIdentity(db, userId, lineUserId) {
  const uid = clean(lineUserId, 256);
  if (!uid || !userId) return false;
  const existing = await db.prepare(`
    SELECT platform_user_id FROM external_identities
    WHERE provider = 'line_login' AND provider_subject = ?
    LIMIT 1
  `).bind(uid).first();
  if (existing?.platform_user_id) {
    const canonical = await resolveCanonicalMemberId(db, existing.platform_user_id);
    if (canonical !== userId) throw new Error('LINE UID is already linked to another member');
    await db.prepare(`
      UPDATE external_identities
      SET verification_status = 'verified', last_verified_at = CURRENT_TIMESTAMP
      WHERE provider = 'line_login' AND provider_subject = ?
    `).bind(uid).run();
    return false;
  }
  await db.prepare(`
    INSERT INTO external_identities
      (id, platform_user_id, provider, provider_subject, verification_status, last_verified_at)
    VALUES (?, ?, 'line_login', ?, 'verified', CURRENT_TIMESTAMP)
  `).bind(newId('identity'), userId, uid).run();
  return true;
}

async function ensureRosterMember(db, row) {
  const lineUserId = clean(row.lineUserId, 256);
  const memberNo = clean(row.memberNo, 120).toUpperCase();
  if (!lineUserId) return { skipped: true, reason: 'missing_line_uid' };

  let userId = await userIdFromLineUid(db, lineUserId);
  const matchedByLine = Boolean(userId);
  let created = false;
  let attached = false;

  if (!userId && memberNo) {
    userId = await userIdFromRosterNumber(db, memberNo);
    if (userId) attached = await attachLineIdentity(db, userId, lineUserId);
  }

  if (!userId) {
    const resolved = await resolveLineMember(db, {
      sub: lineUserId,
      name: clean(row.name, 120),
      picture: '',
      email: clean(row.email, 320),
    });
    userId = resolved?.member?.userId || '';
    created = Boolean(resolved?.created);
  }

  if (!userId) return { skipped: true, reason: 'member_resolution_failed' };

  if (matchedByLine && memberNo) {
    const profile = await db.prepare(`
      SELECT roster_member_number, company_member_number
      FROM member_profiles
      WHERE platform_user_id = ?
      LIMIT 1
    `).bind(userId).first();
    const existingMemberNos = [profile?.roster_member_number, profile?.company_member_number]
      .map((value) => clean(value, 120).toUpperCase())
      .filter(Boolean);
    const existingMemberNo = existingMemberNos.find((value) => value !== memberNo) || '';
    if (existingMemberNo) {
      return {
        skipped: true,
        reason: 'line_uid_member_no_conflict',
        userId,
        lineUserId,
        memberNo,
        existingMemberNo,
      };
    }
  }

  await db.prepare(`
    UPDATE member_profiles
    SET display_name = CASE WHEN ? != '' THEN ? ELSE display_name END,
        phone = CASE WHEN phone = '' AND ? != '' THEN ? ELSE phone END,
        email = CASE WHEN email = '' AND ? != '' THEN ? ELSE email END,
        company_member_number = CASE WHEN company_member_number = '' AND ? != '' THEN ? ELSE company_member_number END,
        roster_member_number = CASE WHEN ? != '' THEN ? ELSE roster_member_number END,
        roster_verified_name = CASE WHEN ? != '' THEN ? ELSE roster_verified_name END,
        roster_verified_at = CURRENT_TIMESTAMP,
        roster_source = 'tdea-worker',
        updated_at = CURRENT_TIMESTAMP
    WHERE platform_user_id = ?
  `).bind(
    clean(row.name, 120), clean(row.name, 120),
    clean(row.phone, 40), clean(row.phone, 40),
    clean(row.email, 320), clean(row.email, 320),
    memberNo, memberNo,
    memberNo, memberNo,
    clean(row.name, 120), clean(row.name, 120),
    userId,
  ).run();

  return { userId, lineUserId, memberNo, created, attached };
}

async function initializeRosterBalance(db, member, rawBalance) {
  const balance = Number(rawBalance);
  if (!Number.isInteger(balance) || balance < 0 || balance > 100000000) {
    return { initialized: false, reason: 'invalid_balance' };
  }

  const existing = await db.prepare(`
    SELECT id, balance FROM point_accounts
    WHERE platform_user_id = ? AND program_id = 'program_main'
    LIMIT 1
  `).bind(member.userId).first();
  if (existing) {
    return { initialized: false, reason: 'account_exists', balance: Number(existing.balance || 0) };
  }

  const accountId = newId('pointacct');
  const metadata = JSON.stringify({
    source: 'tdea-worker-roster',
    memberNo: member.memberNo || '',
    lineUserId: member.lineUserId || '',
  });

  if (balance === 0) {
    await db.prepare(`
      INSERT INTO point_accounts (id, platform_user_id, program_id, balance)
      VALUES (?, ?, 'program_main', 0)
    `).bind(accountId, member.userId).run();
    return { initialized: true, balance: 0, ledgerCreated: false };
  }

  await db.batch([
    db.prepare(`
      INSERT INTO point_accounts (id, platform_user_id, program_id, balance)
      VALUES (?, ?, 'program_main', ?)
    `).bind(accountId, member.userId, balance),
    db.prepare(`
      INSERT INTO point_ledger_entries
        (id, point_account_id, platform_user_id, program_id, point_rule_id,
         event_type, event_reference, idempotency_key, delta, balance_after, metadata_json)
      VALUES (?, ?, ?, 'program_main', NULL,
              'roster_initial_balance', ?, ?, ?, ?, ?)
    `).bind(
      newId('ledger'),
      accountId,
      member.userId,
      member.memberNo || member.lineUserId,
      `roster_initial_balance:${member.userId}`,
      balance,
      balance,
      metadata,
    ),
  ]);
  return { initialized: true, balance, ledgerCreated: true };
}

async function readJson(request) {
  try { return await request.json(); } catch { return {}; }
}

export async function handleTdeaPointService(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/internal/tdea/points')) return null;
  if (!authorized(request, env)) return json({ success: false, error: 'Forbidden' }, 403);
  if (!env.DB) return json({ success: false, error: 'Point database is unavailable' }, 503);

  const memberMatch = url.pathname.match(/^\/internal\/tdea\/member\/([^/]+)$/);
  if (request.method === 'GET' && memberMatch) {
    const lineUserId = decodeURIComponent(memberMatch[1]);
    const userId = await userIdFromLineUid(env.DB, lineUserId);
    if (!userId) return json({ success: false, error: 'LINE member not found' }, 404);
    const member = publicMemberProfile(await memberProfileFromUserId(env.DB, userId));
    return json({ success: true, registered: Boolean(member?.profileCompletedAt), userId, lineUserId, member });
  }

  const balanceMatch = url.pathname.match(/^\/internal\/tdea\/points\/([^/]+)$/);
  if (request.method === 'GET' && balanceMatch) {
    const lineUserId = decodeURIComponent(balanceMatch[1]);
    const userId = await userIdFromLineUid(env.DB, lineUserId);
    if (!userId) return json({ success: false, error: 'LINE member not found' }, 404);
    const wallet = await getWallet(env.DB, userId);
    const member = await getMember(env.DB, userId);
    return json({
      success: true,
      userId,
      lineUserId,
      registered: Boolean(member?.profileCompletedAt),
      member: member ? {
        userId: member.userId,
        displayName: member.displayName || '',
        fullName: member.fullName || '',
        phone: member.phone || '',
        email: member.email || '',
        memberNumber: member.memberNumber || '',
        memberType: member.memberType || 'general',
        rosterMemberNumber: member.rosterMemberNumber || '',
        companyMemberNumber: member.companyMemberNumber || '',
        rosterVerifiedAt: member.rosterVerifiedAt || '',
        rosterVerifiedName: member.rosterVerifiedName || '',
        profileCompletedAt: member.profileCompletedAt || ''
      } : null,
      ...wallet
    });
  }

  if (request.method === 'POST' && url.pathname === '/internal/tdea/points/initialize') {
    const body = await readJson(request);
    const members = Array.isArray(body.members) ? body.members.slice(0, 600) : [];
    if (!members.length) return json({ success: false, error: 'No members supplied' }, 400);
    const summary = { received: members.length, initialized: 0, existing: 0, skipped: 0, createdMembers: 0, attachedLineIds: 0, conflicts: [], errors: [] };
    const results = [];
    for (const row of members) {
      try {
        const member = await ensureRosterMember(env.DB, row || {});
        if (member.skipped) {
          summary.skipped += 1;
          const skippedResult = {
            memberNo: clean(row?.memberNo, 120),
            lineUserId: clean(row?.lineUserId, 256),
            success: false,
            reason: member.reason,
            existingMemberNo: member.existingMemberNo || '',
          };
          if (member.reason === 'line_uid_member_no_conflict') summary.conflicts.push(skippedResult);
          results.push(skippedResult);
          continue;
        }
        if (member.created) summary.createdMembers += 1;
        if (member.attached) summary.attachedLineIds += 1;
        const initialized = await initializeRosterBalance(env.DB, member, row?.pointBalance);
        if (initialized.initialized) summary.initialized += 1;
        else if (initialized.reason === 'account_exists') summary.existing += 1;
        else summary.skipped += 1;
        results.push({ memberNo: member.memberNo, lineUserId: member.lineUserId, userId: member.userId, success: true, ...initialized });
      } catch (error) {
        summary.skipped += 1;
        const item = { memberNo: clean(row?.memberNo, 120), lineUserId: clean(row?.lineUserId, 256), error: error?.message || 'Initialization failed' };
        summary.errors.push(item);
        results.push({ ...item, success: false });
      }
    }
    return json({ success: true, summary, results });
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
      if (url.searchParams.get('compact') === '1') {
        const entry = result?.entry || {};
        return json({ success: true, userId, lineUserId, result, balance: Number(entry.balanceAfter ?? entry.balance_after ?? 0) });
      }
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
