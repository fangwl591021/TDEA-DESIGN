import { sha256 } from './auth.js';

export function newId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

export async function resolveCanonicalMemberId(db, userId) {
  const row = await db.prepare(`
    SELECT canonical_user_id
    FROM member_account_aliases
    WHERE alias_user_id = ?
    LIMIT 1
  `).bind(userId).first();
  return row?.canonical_user_id || userId;
}

const MEMBER_NUMBER_DIGITS = '012356789';
const MEMBER_NUMBER_WIDTH = 8;
const MEMBER_NUMBER_LIMIT = (MEMBER_NUMBER_DIGITS.length ** MEMBER_NUMBER_WIDTH) - 1;
const PUBLIC_MEMBER_INVITE_PREFIX = 'akm-';

export function memberReferralToken(memberNumber) {
  const normalized = String(memberNumber || '').trim().toUpperCase();
  if (!/^MB-[012356789]{8}$/.test(normalized)) throw new Error('Invalid system member number');
  return `${PUBLIC_MEMBER_INVITE_PREFIX}${normalized}`;
}

export function parseMemberReferralToken(rawToken) {
  const token = String(rawToken || '').trim();
  if (!token.toLowerCase().startsWith(PUBLIC_MEMBER_INVITE_PREFIX)) return '';
  const memberNumber = token.slice(PUBLIC_MEMBER_INVITE_PREFIX.length).toUpperCase();
  return /^MB-[012356789]{8}$/.test(memberNumber) ? memberNumber : '';
}

export function memberLiffReferralUrl(liffId, memberNumber) {
  const normalizedLiffId = String(liffId || '').trim();
  if (!normalizedLiffId) throw new Error('LIFF is not configured');
  return `https://liff.line.me/${encodeURIComponent(normalizedLiffId)}?invite=${encodeURIComponent(memberReferralToken(memberNumber))}`;
}

export function formatMemberNumber(sequence) {
  let value = Number(sequence);
  if (!Number.isSafeInteger(value) || value < 1 || value > MEMBER_NUMBER_LIMIT) {
    throw new Error('System member number sequence is out of range');
  }

  let encoded = '';
  do {
    encoded = MEMBER_NUMBER_DIGITS[value % MEMBER_NUMBER_DIGITS.length] + encoded;
    value = Math.floor(value / MEMBER_NUMBER_DIGITS.length);
  } while (value > 0);

  return `MB-${encoded.padStart(MEMBER_NUMBER_WIDTH, '0')}`;
}

async function reserveMemberNumber(db) {
  const row = await db.prepare(`
    UPDATE member_number_sequences
    SET next_value = next_value + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
    RETURNING next_value - 1 AS sequence
  `).first();
  if (!row?.sequence) throw new Error('System member number sequence is not initialized');
  return formatMemberNumber(row.sequence);
}

function profileFromRow(row) {
  let socialLinks = [];
  try {
    const parsed = JSON.parse(row?.social_links_json || '[]');
    if (Array.isArray(parsed)) socialLinks = parsed;
  } catch {}
  return row && {
    userId: row.user_id,
    displayName: row.display_name,
    fullName: row.full_name || '',
    pictureUrl: row.picture_url,
    phone: row.phone,
    email: row.email,
    gender: row.gender || '',
    birthday: row.birthday || '',
    memberNumber: row.member_number || '',
    companyMemberNumber: row.company_member_number || '',
    memberType: row.member_type ?? 'general',
    rosterMemberNumber: row.roster_member_number || '',
    rosterVerifiedAt: row.roster_verified_at || '',
    rosterVerifiedName: row.roster_verified_name || '',
    rosterSource: row.roster_source || '',
    lineUrl: row.line_url || '',
    socialLinks,
    profileCompletedAt: row.profile_completed_at || '',
    systemReferrer: row.referrer_user_id ? {
      userId: row.referrer_user_id,
      displayName: row.referrer_name || '',
      memberNumber: row.referrer_member_number || ''
    } : null,
    status: row.status
  };
}

const memberFields = `
  mp.display_name, mp.full_name, mp.picture_url, mp.phone, mp.email, mp.gender, mp.birthday, mp.member_number, mp.company_member_number, mp.member_type, mp.roster_member_number, mp.roster_verified_name, mp.roster_verified_at, mp.roster_source, mp.line_url, mp.social_links_json, mp.profile_completed_at,
  rr.referrer_user_id, ref_mp.display_name AS referrer_name, ref_mp.member_number AS referrer_member_number
`;

export async function resolveLineMember(db, lineProfile, inviteToken = '') {
  const identity = await db.prepare(`
    SELECT ei.platform_user_id AS user_id, pu.status, ${memberFields}
    FROM external_identities ei
    JOIN platform_users pu ON pu.id = ei.platform_user_id
    LEFT JOIN member_profiles mp ON mp.platform_user_id = pu.id
    LEFT JOIN referral_relationships rr ON rr.referred_user_id = pu.id AND rr.status = 'active'
    LEFT JOIN member_profiles ref_mp ON ref_mp.platform_user_id = rr.referrer_user_id
    WHERE ei.provider = 'line_login' AND ei.provider_subject = ? AND ei.verification_status = 'verified'
  `).bind(lineProfile.sub).first();

  if (identity) {
    await db.prepare('UPDATE external_identities SET last_verified_at = CURRENT_TIMESTAMP WHERE provider = ? AND provider_subject = ?')
      .bind('line_login', lineProfile.sub).run();
    if (lineProfile.picture) await db.prepare('UPDATE member_profiles SET picture_url = ?, updated_at = CURRENT_TIMESTAMP WHERE platform_user_id = ?')
      .bind(String(lineProfile.picture).slice(0, 2048), identity.user_id).run();
    identity.picture_url = String(lineProfile.picture || identity.picture_url || '');
    // LINE 登入可能會經過外部跳轉；若帳號已建立但尚未有推薦人，
    // 仍允許以第一個有效邀約連結補上歸屬。
    const referral = identity.referrer_user_id ? null : await resolveInvite(db, inviteToken, identity.user_id);
    if (referral) {
      await db.batch([
        db.prepare('INSERT INTO referral_relationships (id, referred_user_id, referrer_user_id, invite_link_id) VALUES (?, ?, ?, ?)')
          .bind(newId('referral'), identity.user_id, referral.inviterUserId, referral.inviteLinkId),
        db.prepare('INSERT INTO audit_logs (id, subject_user_id, action, metadata_json) VALUES (?, ?, ?, ?)')
          .bind(newId('audit'), identity.user_id, 'referral.confirmed', JSON.stringify({ inviteLinkId: referral.inviteLinkId, recovered: true }))
      ]);
      identity.referrer_user_id = referral.inviterUserId;
      identity.referrer_name = '';
      identity.referrer_member_number = '';
    }
    return { member: profileFromRow(identity), created: false, referralCreated: Boolean(referral) };
  }

  const userId = newId('usr');
  const identityId = newId('identity');
  const displayName = String(lineProfile.name || '').slice(0, 120);
  const pictureUrl = String(lineProfile.picture || '').slice(0, 2048);
  const email = String(lineProfile.email || '').slice(0, 320);
  const memberNumber = await reserveMemberNumber(db);
  const statements = [
    db.prepare('INSERT INTO platform_users (id) VALUES (?)').bind(userId),
    db.prepare('INSERT INTO external_identities (id, platform_user_id, provider, provider_subject) VALUES (?, ?, ?, ?)')
      .bind(identityId, userId, 'line_login', lineProfile.sub),
    db.prepare('INSERT INTO member_profiles (platform_user_id, display_name, picture_url, email, member_number, member_type) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(userId, displayName, pictureUrl, email, memberNumber, ''),
    db.prepare('INSERT INTO audit_logs (id, subject_user_id, action, metadata_json) VALUES (?, ?, ?, ?)')
      .bind(newId('audit'), userId, 'member.registered', JSON.stringify({ provider: 'line_login' }))
  ];
  const referral = await resolveInvite(db, inviteToken, userId);
  if (referral) statements.push(
    db.prepare('INSERT INTO referral_relationships (id, referred_user_id, referrer_user_id, invite_link_id) VALUES (?, ?, ?, ?)')
      .bind(newId('referral'), userId, referral.inviterUserId, referral.inviteLinkId),
    db.prepare('INSERT INTO audit_logs (id, subject_user_id, action, metadata_json) VALUES (?, ?, ?, ?)')
      .bind(newId('audit'), userId, 'referral.confirmed', JSON.stringify({ inviteLinkId: referral.inviteLinkId }))
  );
  await db.batch(statements);
  return { member: { userId, displayName, fullName: '', pictureUrl, phone: '', email, gender: '', birthday: '', memberNumber, companyMemberNumber: '', memberType: '', rosterMemberNumber: '', rosterVerifiedAt: '', lineUrl: '', socialLinks: [], profileCompletedAt: '', systemReferrer: referral ? { userId: referral.inviterUserId, displayName: '', memberNumber: '' } : null, status: 'active' }, created: true, referralCreated: Boolean(referral) };
}

export function normalizeBirthday(rawBirthday) {
  const raw = String(rawBirthday || '').trim();
  const digits = raw.replace(/-/g, '');
  let gregorianDigits = digits;
  if (/^\d{6,7}$/.test(digits)) {
    const yearDigits = digits.length - 4;
    const rocYear = Number(digits.slice(0, yearDigits));
    if (!Number.isInteger(rocYear) || rocYear < 1) throw new Error('生日密碼請輸入民國年月日，例如 591021、390305');
    gregorianDigits = `${rocYear + 1911}${digits.slice(yearDigits)}`;
  } else if (!/^\d{8}$/.test(digits)) {
    throw new Error('生日密碼請輸入民國年月日，例如 591021、390305');
  }
  const birthday = `${gregorianDigits.slice(0, 4)}-${gregorianDigits.slice(4, 6)}-${gregorianDigits.slice(6, 8)}`;
  const parsedBirthday = new Date(`${birthday}T00:00:00Z`);
  if (Number.isNaN(parsedBirthday.getTime()) || parsedBirthday.toISOString().slice(0, 10) !== birthday || parsedBirthday > new Date()) {
    throw new Error('生日日期無效');
  }
  return birthday;
}

export function normalizeTaiwanMobile(rawPhone) {
  const phone = String(rawPhone || '').replace(/[^\d+]/g, '').slice(0, 20);
  if (!/^(?:\+886|0)9\d{8}$/.test(phone)) throw new Error('請輸入正確的台灣行動電話');
  return phone.startsWith('+886') ? '0' + phone.slice(4) : phone;
}

export async function resolvePhoneBirthdayMember(db, rawPhone, rawBirthday, inviteToken = '', intent = 'auto') {
  const normalizedPhone = normalizeTaiwanMobile(rawPhone);
  const birthday = normalizeBirthday(rawBirthday);
  const subject = await sha256(`${normalizedPhone}|${birthday}`);
  let existing = await db.prepare(`
    SELECT COALESCE(maa.canonical_user_id, ei.platform_user_id) AS user_id
    FROM external_identities ei
    LEFT JOIN member_account_aliases maa ON maa.alias_user_id = ei.platform_user_id
    WHERE ei.provider = 'phone_birthday' AND ei.provider_subject = ? AND ei.verification_status = 'verified'
  `).bind(subject).first();
  if (!existing?.user_id) {
    existing = await db.prepare(`
      SELECT COALESCE(maa.canonical_user_id, mp.platform_user_id) AS user_id
      FROM member_profiles mp
      JOIN platform_users pu ON pu.id = mp.platform_user_id AND pu.status = 'active'
      LEFT JOIN member_account_aliases maa ON maa.alias_user_id = mp.platform_user_id
      WHERE mp.phone = ? AND mp.birthday = ?
      ORDER BY pu.created_at ASC
      LIMIT 1
    `).bind(normalizedPhone, birthday).first();
  }
  if (existing?.user_id) {
    if (intent === 'register') throw new Error('此手機與生日已註冊，請切換「會員登入」');
    await db.prepare(`INSERT INTO external_identities
      (id, platform_user_id, provider, provider_subject, verification_status, last_verified_at)
      VALUES (?, ?, 'phone_birthday', ?, 'verified', CURRENT_TIMESTAMP)
      ON CONFLICT(provider, provider_subject) DO UPDATE SET
        platform_user_id = excluded.platform_user_id,
        verification_status = 'verified',
        last_verified_at = CURRENT_TIMESTAMP`)
      .bind(newId('identity'), existing.user_id, subject).run();
    let member = await getMember(db, existing.user_id);
    const referral = member?.systemReferrer ? null : await resolveInvite(db, inviteToken, existing.user_id);
    if (referral) {
      await db.prepare('INSERT INTO referral_relationships (id, referred_user_id, referrer_user_id, invite_link_id) VALUES (?, ?, ?, ?)')
        .bind(newId('referral'), existing.user_id, referral.inviterUserId, referral.inviteLinkId).run();
      member = await getMember(db, existing.user_id);
    }
    return { member, created: false, referralCreated: Boolean(referral) };
  }
  const phoneOwner = await db.prepare(`
    SELECT mp.platform_user_id, mp.birthday
    FROM member_profiles mp
    JOIN platform_users pu ON pu.id = mp.platform_user_id AND pu.status = 'active'
    WHERE mp.phone = ?
    ORDER BY pu.created_at ASC
    LIMIT 1
  `).bind(normalizedPhone).first();
  if (phoneOwner) {
    throw new Error('此手機已建立會員，但生日驗證不符。請確認生日，或聯絡管理員協助找回帳號。');
  }
  if (intent === 'login') throw new Error('查無會員資料，請先切換「新會員註冊」');
  const userId = newId('usr');
  const memberNumber = await reserveMemberNumber(db);
  const displayName = `會員${normalizedPhone.slice(-4)}`;
  const referral = await resolveInvite(db, inviteToken, userId);
  const statements = [
    db.prepare('INSERT INTO platform_users (id) VALUES (?)').bind(userId),
    db.prepare('INSERT INTO external_identities (id, platform_user_id, provider, provider_subject) VALUES (?, ?, ?, ?)')
      .bind(newId('identity'), userId, 'phone_birthday', subject),
    db.prepare(`INSERT INTO member_profiles
      (platform_user_id, display_name, phone, gender, birthday, member_number, company_member_number, member_type)
      VALUES (?, ?, ?, 'prefer_not_to_say', ?, ?, '', '')`)
      .bind(userId, displayName, normalizedPhone, birthday, memberNumber),
    db.prepare('INSERT INTO audit_logs (id, subject_user_id, action, metadata_json) VALUES (?, ?, ?, ?)')
      .bind(newId('audit'), userId, 'member.registered', JSON.stringify({ provider: 'phone_birthday' }))
  ];
  if (referral) statements.push(
    db.prepare('INSERT INTO referral_relationships (id, referred_user_id, referrer_user_id, invite_link_id) VALUES (?, ?, ?, ?)')
      .bind(newId('referral'), userId, referral.inviterUserId, referral.inviteLinkId)
  );
  await db.batch(statements);
  return { member: await getMember(db, userId), created: true, referralCreated: Boolean(referral) };
}
export async function resolveInvite(db, inviteToken, referredUserId) {
  const rawToken = String(inviteToken || '').trim();
  if (!rawToken || rawToken.length > 512) return null;
  const tokenHash = await sha256(rawToken);
  const row = await db.prepare(`
    SELECT id, inviter_user_id
    FROM invite_links
    WHERE token_hash = ? AND status = 'active' AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
  `).bind(tokenHash).first();
  if (row) {
    if (row.inviter_user_id === referredUserId) return null;
    return { inviteLinkId: row.id, inviterUserId: row.inviter_user_id };
  }
  const memberNumber = parseMemberReferralToken(rawToken);
  if (!memberNumber) return null;
  const publicReferrer = await db.prepare(`
    SELECT pu.id AS inviter_user_id
    FROM member_profiles mp
    JOIN platform_users pu ON pu.id = mp.platform_user_id AND pu.status = 'active'
    WHERE mp.member_number = ?
    LIMIT 1
  `).bind(memberNumber).first();
  if (!publicReferrer || publicReferrer.inviter_user_id === referredUserId) return null;
  return { inviteLinkId: null, inviterUserId: publicReferrer.inviter_user_id };
}

export async function getMember(db, userId) {
  const row = await db.prepare(`
    SELECT pu.id AS user_id, pu.status, ${memberFields}
    FROM platform_users pu
    LEFT JOIN member_profiles mp ON mp.platform_user_id = pu.id
    LEFT JOIN referral_relationships rr ON rr.referred_user_id = pu.id AND rr.status = 'active'
    LEFT JOIN member_profiles ref_mp ON ref_mp.platform_user_id = rr.referrer_user_id
    WHERE pu.id = ?
  `).bind(userId).first();
  return profileFromRow(row);
}

export async function updateMemberProfile(db, userId, profile, rosterVerification) {
  const displayName = String(profile.displayName || '').trim().slice(0, 120);
  const fullName = String(profile.fullName || '').trim().slice(0, 120);
  const phone = normalizeTaiwanMobile(profile.phone);
  const gender = String(profile.gender || '').trim();
  const birthday = normalizeBirthday(profile.birthday);
  const companyMemberNumber = String(profile.companyMemberNumber || '').trim().slice(0, 80);
  const memberType = String(rosterVerification?.memberType || '').trim();
  const rosterMemberNumber = String(rosterVerification?.memberNumber || '').trim().slice(0, 80);
  const rosterVerifiedName = String(rosterVerification?.rosterName || '').trim().slice(0, 120);
  const rosterSource = String(rosterVerification?.source || '').trim().slice(0, 40);
  const lineUrl = String(profile.lineUrl || '').trim().slice(0, 500);
  const socialLinks = Array.isArray(profile.socialLinks) ? profile.socialLinks.slice(0, 10).map((item) => ({
    label: String(item?.label || '').trim().slice(0, 40),
    url: String(item?.url || '').trim().slice(0, 500)
  })).filter((item) => item.label || item.url) : [];
  if (!displayName) throw new Error('請輸入顯示名稱');
  if (!fullName) throw new Error('請輸入姓名');
  if (!['female', 'male', 'other', 'prefer_not_to_say'].includes(gender)) throw new Error('請選擇性別');
  if (!['general', 'association', 'vendor'].includes(memberType)) throw new Error('會員類型尚未完成核對');
  if (memberType !== 'general' && !rosterMemberNumber) throw new Error('協會會員與廠商會員必須完成會員編號核對');
  if (!rosterSource) throw new Error('會員資料來源尚未完成核對');
  if (lineUrl && !/^https:\/\/(lin\.ee|line\.me|liff\.line\.me)\//i.test(lineUrl)) {
    throw new Error('LINE 網址格式錯誤，請填 https://lin.ee/... 或 https://line.me/...');
  }
  for (const item of socialLinks) {
    if (!item.label || !item.url) throw new Error('社群連結名稱與網址都必須填寫');
    let parsed;
    try { parsed = new URL(item.url); } catch { throw new Error(`「${item.label}」的社群網址格式不正確`); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`「${item.label}」的社群網址必須以 http:// 或 https:// 開頭`);
  }
  const currentProfile = await db.prepare('SELECT phone FROM member_profiles WHERE platform_user_id = ?').bind(userId).first();
  if (currentProfile?.phone && normalizeTaiwanMobile(currentProfile.phone) !== phone) {
    throw new Error('行動電話如需變更，請聯絡管理員');
  }
  const phoneOwner = await db.prepare(`
    SELECT mp.platform_user_id
    FROM member_profiles mp
    JOIN platform_users pu ON pu.id = mp.platform_user_id AND pu.status = 'active'
    WHERE mp.phone = ? AND mp.platform_user_id <> ?
    LIMIT 1
  `).bind(phone, userId).first();
  if (phoneOwner) throw new Error('此行動電話已由其他會員使用');
  await db.prepare(`
    UPDATE member_profiles SET display_name = ?, full_name = ?, phone = ?, gender = ?, birthday = ?, company_member_number = ?, member_type = ?, roster_member_number = ?, roster_verified_name = ?, roster_verified_at = CURRENT_TIMESTAMP, roster_source = ?, line_url = ?, social_links_json = ?, profile_completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE platform_user_id = ?
  `).bind(displayName, fullName, phone, gender, birthday, companyMemberNumber, memberType, rosterMemberNumber, rosterVerifiedName, rosterSource, lineUrl, JSON.stringify(socialLinks), userId).run();
  return getMember(db, userId);
}

export async function getAdminAccess(db, userId, configuredSubjects) {
  const allowed = new Set(String(configuredSubjects || '').split(',').map(value => value.trim()).filter(Boolean));
  const identity = await db.prepare(`SELECT provider_subject FROM external_identities WHERE platform_user_id = ? AND provider = 'line_login' AND verification_status = 'verified'`)
    .bind(userId).first();
  const owner = Boolean(identity?.provider_subject && allowed.has(identity.provider_subject));
  if (owner) return {
    canAccessAdmin: true,
    canManagePermissions: true,
    canManagePoints: true,
    canManageRichMenu: true,
    systemAccess: true,
    operatorAccess: false,
    role: 'owner'
  };
  const permission = await db.prepare(`SELECT system_access, operator_access FROM admin_member_permissions WHERE platform_user_id = ?`)
    .bind(userId).first();
  const systemAccess = Number(permission?.system_access || 0) === 1;
  const operatorAccess = Number(permission?.operator_access || 0) === 1;
  return {
    canAccessAdmin: systemAccess || operatorAccess,
    canManagePermissions: false,
    canManagePoints: systemAccess,
    canManageRichMenu: systemAccess,
    systemAccess,
    operatorAccess,
    role: systemAccess ? 'system' : operatorAccess ? 'operator' : 'member'
  };
}

export async function isAdminMember(db, userId, configuredSubjects) {
  return (await getAdminAccess(db, userId, configuredSubjects)).canAccessAdmin;
}

export async function createInviteLink(db, userId, rawToken) {
  const token = String(rawToken || '').trim();
  if (token.length < 24 || token.length > 512) throw new Error('Invalid invite token');
  const linkId = newId('invite');
  await db.prepare('INSERT INTO invite_links (id, inviter_user_id, token_hash) VALUES (?, ?, ?)')
    .bind(linkId, userId, await sha256(token)).run();
  return { id: linkId, token };
}
