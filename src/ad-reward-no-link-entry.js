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

      // 廣告贈點改為 App 內直接贈點後，主 App 不應再取得舊 marquee/LIFF URL。
      // 主 App 看到空字串後不會生成任何 <a href="...marquee=1">。
      return json({
        ...payload,
        adLiffUrl: '',
        directAdReward: true,
      }, response.status, { 'x-tdea-ad-reward-mode': 'direct-pop' });
    }

    return app.fetch(request, env, ctx);
  },
  scheduled(controller, env, ctx) {
    return app.scheduled?.(controller, env, ctx);
  },
};
