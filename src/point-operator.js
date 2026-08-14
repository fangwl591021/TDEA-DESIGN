import { sha256 } from './auth.js';
import { adjustPoints, getWallet } from './points.js';
import { newId } from './member-repository.js';

const clean = (value, max = 500) => String(value ?? '').trim().slice(0, max);

export function pointOperatorCapabilities(adminAccess = {}) {
  // The existing admin "允許登入" permission is represented by canAccessAdmin.
  // Anyone explicitly allowed to log in may use the point scanner, including operators.
  const allowed = adminAccess?.canAccessAdmin === true;
  return {
    canScanPoints: allowed,
    canCreditPoints: allowed,
    canDebitPoints: allowed,
  };
}

export function extractWalletToken(rawValue = '') {
  const value = clean(rawValue, 4096);
  if (/^[a-f0-9]{48}$/i.test(value)) return value;
  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/w\/([a-f0-9]{48})$/i);
    return match ? match[1] : '';
  } catch {
    return '';
  }
}

async function activeWalletToken(db, rawValue) {
  const token = extractWalletToken(rawValue);
  if (!token) return null;
  const tokenHash = await sha256(token);
  return db.prepare(`
    SELECT wt.id wallet_token_id, wt.platform_user_id, wt.purpose,
      mp.display_name, mp.member_number, mp.picture_url
    FROM wallet_tokens wt
    JOIN platform_users pu ON pu.id = wt.platform_user_id AND pu.status = 'active'
    LEFT JOIN member_profiles mp ON mp.platform_user_id = wt.platform_user_id
    WHERE wt.token_hash = ?
      AND wt.status = 'active'
      AND wt.expires_at >= CURRENT_TIMESTAMP
      AND wt.purpose = 'member_identification'
    LIMIT 1
  `).bind(tokenHash).first();
}

export async function previewPointWallet(db, { rawValue, operatorUserId, adminAccess }) {
  const capabilities = pointOperatorCapabilities(adminAccess);
  if (!capabilities.canScanPoints) {
    const error = new Error('此功能僅限已允許登入的後台人員使用');
    error.status = 403;
    throw error;
  }
  const row = await activeWalletToken(db, rawValue);
  if (!row) {
    const error = new Error('QR Code 已失效，請會員重新產生');
    error.status = 410;
    throw error;
  }
  const wallet = await getWallet(db, row.platform_user_id);
  await db.prepare(`INSERT INTO wallet_scan_events
    (id,wallet_token_id,platform_user_id,scanner_label,result)
    VALUES (?,?,?,?, 'accepted')`)
    .bind(newId('walletscan'), row.wallet_token_id, row.platform_user_id, `point_operator:${operatorUserId}`).run();
  return {
    walletTokenId: row.wallet_token_id,
    member: {
      userId: row.platform_user_id,
      displayName: row.display_name || '',
      memberNumber: row.member_number || '',
      pictureUrl: row.picture_url || '',
    },
    wallet: { balance:Number(wallet.balance || 0), programCode:wallet.programCode || 'main' },
    capabilities,
  };
}

export async function adjustPointWallet(db, { rawValue, operatorUserId, adminAccess, action, points, reason }) {
  const capabilities = pointOperatorCapabilities(adminAccess);
  if (action === 'grant' && !capabilities.canCreditPoints) {
    const error = new Error('沒有贈點權限'); error.status = 403; throw error;
  }
  if (action === 'deduct' && !capabilities.canDebitPoints) {
    const error = new Error('沒有扣點權限'); error.status = 403; throw error;
  }
  if (!['grant','deduct'].includes(action)) throw new Error('不支援的點數操作');
  const row = await activeWalletToken(db, rawValue);
  if (!row) {
    const error = new Error('QR Code 已失效或已使用，請會員重新產生');
    error.status = 410;
    throw error;
  }

  const consume = await db.prepare(`
    UPDATE wallet_tokens
    SET status='revoked', revoked_at=CURRENT_TIMESTAMP
    WHERE id=? AND status='active' AND expires_at>=CURRENT_TIMESTAMP
    RETURNING id
  `).bind(row.wallet_token_id).first();
  if (!consume?.id) {
    const error = new Error('QR Code 已失效或已使用，請會員重新產生');
    error.status = 410;
    throw error;
  }

  try {
    const result = await adjustPoints(db, {
      userId: row.platform_user_id,
      actorUserId: operatorUserId,
      action,
      points,
      note: clean(reason, 500),
      requestId: `wallet:${row.wallet_token_id}`,
    });
    const wallet = await getWallet(db, row.platform_user_id);
    return {
      adjusted: result.adjusted,
      duplicate: result.duplicate,
      entry: result.entry,
      member: { userId:row.platform_user_id, displayName:row.display_name || '', memberNumber:row.member_number || '' },
      wallet: { balance:Number(wallet.balance || 0), programCode:wallet.programCode || 'main' },
      action,
    };
  } catch (error) {
    // 扣點餘額不足等業務錯誤時允許會員重新產生 QR 再操作；
    // 已成功寫帳時 adjustPoints 不會拋出，因此不會把已使用 token 復活。
    await db.prepare("UPDATE wallet_tokens SET status='active',revoked_at=NULL WHERE id=? AND status='revoked' AND expires_at>=CURRENT_TIMESTAMP")
      .bind(row.wallet_token_id).run().catch(()=>null);
    throw error;
  }
}
