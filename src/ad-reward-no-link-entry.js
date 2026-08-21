import app from './point-operator-open-entry.js';

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store, no-cache, must-revalidate',
    ...headers,
  },
});

const LEGACY_AD_ANCHOR = '<a class="btn" href="${esc(showcase.adLiffUrl)}" target="_blank" rel="noopener noreferrer">開啟廣告贈點</a>';
const DIRECT_AD_BUTTON = '<button type="button" class="btn" data-direct-ad-reward="1" data-image-id="${esc(ad.id)}" data-image-url="${esc(ad.imageUrl)}" data-ad-title="${esc(ad.title)}">開啟廣告贈點</button>';

async function servePatchedMainApp(request, env) {
  if (!env.ASSETS || typeof env.ASSETS.fetch !== 'function') return null;
  const assetResponse = await env.ASSETS.fetch(request);
  if (!assetResponse.ok) return assetResponse;

  const source = await assetResponse.text();
  const patched = source.split(LEGACY_AD_ANCHOR).join(DIRECT_AD_BUTTON);
  const headers = new Headers(assetResponse.headers);
  headers.set('content-type', 'text/javascript; charset=utf-8');
  headers.set('cache-control', 'no-store, no-cache, must-revalidate');
  headers.set('x-tdea-ad-control', patched !== source ? 'native-button' : 'source-pattern-missing');
  headers.delete('content-length');
  return new Response(patched, { status: assetResponse.status, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 主程式本身直接輸出 <button>，不再先生成可導頁的 <a target="_blank">。
    // 這樣在 LINE / Samsung WebView 也沒有任何新頁面或 hash 導航可以觸發。
    if (request.method === 'GET' && url.pathname === '/app-20260803-123.js') {
      const response = await servePatchedMainApp(request, env);
      if (response) return response;
    }

    if (request.method === 'GET' && url.pathname === '/v1/tdea-showcase') {
      const response = await app.fetch(request, env, ctx);
      if (!response.ok) return response;
      const payload = await response.clone().json().catch(() => null);
      if (!payload || typeof payload !== 'object') return response;

      // 保持 truthy 只為相容舊主程式的條件式；新版主程式會把控制項改為純 button。
      // 此值永遠不是 tdeawork / marquee 外部網址。
      return json({
        ...payload,
        adLiffUrl: '#direct-ad-reward',
        directAdReward: true,
      }, response.status, { 'x-tdea-ad-reward-mode': 'direct-pop-native-button' });
    }

    return app.fetch(request, env, ctx);
  },
  scheduled(controller, env, ctx) {
    return app.scheduled?.(controller, env, ctx);
  },
};
