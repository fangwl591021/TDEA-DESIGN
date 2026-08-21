import app from './showcase-resilience-entry.js';
import { sessionTokenFromCookie, verifySession } from './auth.js';
import { getMember, resolveCanonicalMemberId } from './member-repository.js';
import { previewPointWallet, adjustPointWallet } from './point-operator.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  },
});

function authTokenFromRequest(request) {
  const authorization = String(request.headers.get('authorization') || '').trim();
  if (/^Bearer\s+/i.test(authorization)) return authorization.replace(/^Bearer\s+/i, '').trim();
  return sessionTokenFromCookie(request.headers.get('cookie') || '');
}

async function currentMember(request, env) {
  try {
    const token = authTokenFromRequest(request);
    if (!token || !env.SESSION_SIGNING_SECRET) return null;
    const claims = await verifySession(token, env.SESSION_SIGNING_SECRET);
    if (!claims?.sub) return null;
    const userId = await resolveCanonicalMemberId(env.DB, claims.sub);
    const member = await getMember(env.DB, userId);
    return member?.status === 'active' ? member : null;
  } catch {
    return null;
  }
}

async function readJson(request) {
  try { return await request.json(); }
  catch { return {}; }
}

async function openPointOperator(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/v1/point-operator/')) return null;

  const member = await currentMember(request, env);
  if (!member) return json({ success:false, error:'Unauthorized' }, 401);

  // TEMPORARY EMERGENCY BYPASS:
  // 只要是已登入且啟用中的 TDEA 會員，就可使用掃碼贈點／扣點。
  // 不開放匿名使用；點數統計中心仍走原本管理權限檢查。
  const adminAccess = { canAccessAdmin:true };
  const capabilities = {
    canScanPoints:true,
    canCreditPoints:true,
    canDebitPoints:true,
  };

  if (request.method === 'GET' && url.pathname === '/v1/point-operator/access') {
    return json({
      success:true,
      capabilities,
      temporaryOpen:true,
      operator:{
        userId:member.userId,
        displayName:member.displayName || '',
        memberNo:member.rosterMemberNumber || member.companyMemberNumber || member.memberNumber || '',
        loginAccess:true,
        matchedBy:'temporary_logged_in_member',
      },
    });
  }

  if (request.method === 'POST' && url.pathname === '/v1/point-operator/preview') {
    try {
      const body = await readJson(request);
      const result = await previewPointWallet(env.DB, {
        rawValue:body.value,
        operatorUserId:member.userId,
        adminAccess,
      });
      return json({ success:true, ...result, temporaryOpen:true });
    } catch (error) {
      return json({ success:false, error:error?.message || 'QR Code 驗證失敗' }, Number(error?.status) || 400);
    }
  }

  if (request.method === 'POST' && url.pathname === '/v1/point-operator/adjust') {
    try {
      const body = await readJson(request);
      const result = await adjustPointWallet(env.DB, {
        rawValue:body.value,
        operatorUserId:member.userId,
        adminAccess,
        action:String(body.action || ''),
        points:body.points,
        reason:body.reason,
      });
      return json({ success:true, ...result, temporaryOpen:true });
    } catch (error) {
      return json({ success:false, error:error?.message || '點數操作失敗' }, Number(error?.status) || 400);
    }
  }

  return json({ success:false, error:'Not found' }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const response = await openPointOperator(request, env);
    return response || app.fetch(request, env, ctx);
  },
  scheduled(controller, env, ctx) {
    return app.scheduled?.(controller, env, ctx);
  },
};
