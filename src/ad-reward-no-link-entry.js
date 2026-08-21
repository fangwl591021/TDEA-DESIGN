import app from './point-operator-open-entry.js';

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store, no-cache, must-revalidate',
    ...headers,
  },
});

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/v1/tdea-showcase') {
      const response = await app.fetch(request, env, ctx);
      if (!response.ok) return response;
      const payload = await response.clone().json().catch(() => null);
      if (!payload || typeof payload !== 'object') return response;

      // 讓主 App 自己產生原生「開啟廣告贈點」控制項，但只給 App 內 hash，
      // 絕不再回傳 tdeawork marquee/LIFF 外部網址。
      // 既有 ad-reward-entry-fix.js 會在 capture 階段攔截此控制項，
      // 直接 POST /v1/ad-reward 並顯示中央 POP。
      return json({
        ...payload,
        adLiffUrl: '#direct-ad-reward',
        directAdReward: true,
      }, response.status, { 'x-tdea-ad-reward-mode': 'direct-pop-native-control' });
    }

    return app.fetch(request, env, ctx);
  },
  scheduled(controller, env, ctx) {
    return app.scheduled?.(controller, env, ctx);
  },
};
