import app from './point-operator-open-entry.js';

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store, no-cache, must-revalidate',
    ...headers,
  },
});

const LEGACY_AD_CONTROL = '${showcase.adLiffUrl ? `<a class="btn" href="${esc(showcase.adLiffUrl)}" target="_blank" rel="noopener noreferrer">開啟廣告贈點</a>` : ""}';
const DIRECT_AD_CONTROL = '${showcase.directAdReward ? `<button type="button" class="btn" data-direct-ad-reward="1" data-image-id="${esc(ad.id)}" data-image-url="${esc(ad.imageUrl)}" data-ad-title="${esc(ad.title)}">${esc(showcase.adRewardLabel || "點我贈點")}</button>` : ""}';
const LEGACY_AD_ANCHOR = '<a class="btn" href="${esc(showcase.adLiffUrl)}" target="_blank" rel="noopener noreferrer">開啟廣告贈點</a>';
const DIRECT_AD_BUTTON = '<button type="button" class="btn" data-direct-ad-reward="1" data-image-id="${esc(ad.id)}" data-image-url="${esc(ad.imageUrl)}" data-ad-title="${esc(ad.title)}">${esc(showcase.adRewardLabel || "點我贈點")}</button>';

async function readRewardButtonConfig(env) {
  if (!env.TDEA_WORKER || typeof env.TDEA_WORKER.fetch !== 'function') {
    return { enabled: true, label: '點我贈點', points: 1 };
  }
  try {
    const response = await env.TDEA_WORKER.fetch('https://tdea.internal/api/marquee', {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
    const payload = await response.json().catch(() => ({}));
    const left = payload?.data?.left || {};
    const points = Number(left.points);
    return {
      enabled: left.enabled !== false,
      label: String(left.label || '點我贈點').trim() || '點我贈點',
      points: Number.isFinite(points) && points > 0 ? points : 1,
    };
  } catch {
    return { enabled: true, label: '點我贈點', points: 1 };
  }
}

async function servePatchedMainApp(request, env) {
  if (!env.ASSETS || typeof env.ASSETS.fetch !== 'function') return null;
  const assetResponse = await env.ASSETS.fetch(request);
  if (!assetResponse.ok) return assetResponse;

  const source = await assetResponse.text();
  let patched = source.split(LEGACY_AD_CONTROL).join(DIRECT_AD_CONTROL);
  if (patched === source) patched = source.split(LEGACY_AD_ANCHOR).join(DIRECT_AD_BUTTON);

  const headers = new Headers(assetResponse.headers);
  headers.set('content-type', 'text/javascript; charset=utf-8');
  headers.set('cache-control', 'no-store, no-cache, must-revalidate');
  headers.set('x-tdea-ad-control', patched !== source ? 'native-button-v4' : 'source-pattern-missing');
  headers.delete('content-length');
  return new Response(patched, { status: assetResponse.status, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 主程式直接輸出 button；不再提供任何 #direct-ad-reward 或外部 LIFF href。
    if (request.method === 'GET' && url.pathname === '/app-20260803-123.js') {
      const response = await servePatchedMainApp(request, env);
      if (response) return response;
    }

    if (request.method === 'GET' && url.pathname === '/v1/tdea-showcase') {
      const response = await app.fetch(request, env, ctx);
      if (!response.ok) return response;
      const payload = await response.clone().json().catch(() => null);
      if (!payload || typeof payload !== 'object') return response;

      const reward = await readRewardButtonConfig(env);
      return json({
        ...payload,
        // 舊版主程式若未被 patch，這裡為空字串，因此不會生成任何可導頁連結。
        adLiffUrl: '',
        directAdReward: reward.enabled,
        adRewardLabel: reward.label,
        adRewardPoints: reward.points,
      }, response.status, { 'x-tdea-ad-reward-mode': 'direct-button-no-hash-v4' });
    }

    return app.fetch(request, env, ctx);
  },
  scheduled(controller, env, ctx) {
    return app.scheduled?.(controller, env, ctx);
  },
};
