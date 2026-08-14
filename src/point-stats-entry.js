import app from './point-operator-entry.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function clampDays(value) {
  const n = Number(value || 30);
  return Math.max(1, Math.min(366, Number.isFinite(n) ? Math.floor(n) : 30));
}

async function requirePointAdmin(request, env, ctx) {
  const url = new URL('/v1/point-operator/access', request.url);
  const headers = new Headers();
  const auth = request.headers.get('authorization');
  const cookie = request.headers.get('cookie');
  if (auth) headers.set('authorization', auth);
  if (cookie) headers.set('cookie', cookie);
  const response = await app.fetch(new Request(url, { method: 'GET', headers }), env, ctx);
  if (!response.ok) return { ok:false, status:response.status || 401 };
  const payload = await response.json().catch(() => ({}));
  if (payload?.capabilities?.canManagePoints !== true) return { ok:false, status:403 };
  return { ok:true, operator:payload.operator || null };
}

function sinceDate(days) {
  return `-${Math.max(0, days - 1)} days`;
}

async function pointStatsData(db, url) {
  const days = clampDays(url.searchParams.get('days'));
  const scope = url.searchParams.get('scope') === 'all' ? 'all' : 'posted';
  const eventType = String(url.searchParams.get('event_type') || '').trim();
  const conditions = ["ple.created_at >= datetime('now', ?)"];
  const bindings = [sinceDate(days)];
  if (scope === 'posted') conditions.push("ple.status = 'posted'");
  if (eventType) {
    conditions.push('ple.event_type = ?');
    bindings.push(eventType);
  }
  const where = conditions.join(' AND ');

  const [summary, daily, sources, users, eventTypes] = await Promise.all([
    db.prepare(`
      SELECT
        COUNT(*) AS transactions,
        COUNT(DISTINCT ple.platform_user_id) AS unique_users,
        COALESCE(SUM(CASE WHEN ple.delta > 0 THEN ple.delta ELSE 0 END),0) AS grant_points,
        COALESCE(SUM(CASE WHEN ple.delta < 0 THEN -ple.delta ELSE 0 END),0) AS deduct_points,
        COALESCE(SUM(ple.delta),0) AS net_points
      FROM point_ledger_entries ple
      WHERE ${where}
    `).bind(...bindings).first(),
    db.prepare(`
      SELECT
        date(datetime(ple.created_at, '+8 hours')) AS day,
        COUNT(*) AS transactions,
        COUNT(DISTINCT ple.platform_user_id) AS unique_users,
        COALESCE(SUM(CASE WHEN ple.delta > 0 THEN ple.delta ELSE 0 END),0) AS grant_points,
        COALESCE(SUM(CASE WHEN ple.delta < 0 THEN -ple.delta ELSE 0 END),0) AS deduct_points,
        COALESCE(SUM(ple.delta),0) AS net_points
      FROM point_ledger_entries ple
      WHERE ${where}
      GROUP BY day
      ORDER BY day DESC
    `).bind(...bindings).all(),
    db.prepare(`
      SELECT
        ple.event_type,
        ple.status,
        COUNT(*) AS transactions,
        COUNT(DISTINCT ple.platform_user_id) AS unique_users,
        COALESCE(SUM(CASE WHEN ple.delta > 0 THEN ple.delta ELSE 0 END),0) AS grant_points,
        COALESCE(SUM(CASE WHEN ple.delta < 0 THEN -ple.delta ELSE 0 END),0) AS deduct_points,
        COALESCE(SUM(ple.delta),0) AS net_points
      FROM point_ledger_entries ple
      WHERE ${where}
      GROUP BY ple.event_type, ple.status
      ORDER BY transactions DESC, ple.event_type ASC
    `).bind(...bindings).all(),
    db.prepare(`
      SELECT
        date(datetime(ple.created_at, '+8 hours')) AS day,
        ple.platform_user_id,
        COALESCE(NULLIF(mp.display_name,''), ple.platform_user_id) AS display_name,
        COUNT(*) AS transactions,
        COALESCE(SUM(CASE WHEN ple.delta > 0 THEN ple.delta ELSE 0 END),0) AS grant_points,
        COALESCE(SUM(CASE WHEN ple.delta < 0 THEN -ple.delta ELSE 0 END),0) AS deduct_points,
        COALESCE(SUM(ple.delta),0) AS net_points
      FROM point_ledger_entries ple
      LEFT JOIN member_profiles mp ON mp.platform_user_id = ple.platform_user_id
      WHERE ${where}
      GROUP BY day, ple.platform_user_id
      ORDER BY day DESC, transactions DESC, display_name ASC
    `).bind(...bindings).all(),
    db.prepare(`SELECT DISTINCT event_type FROM point_ledger_entries ORDER BY event_type ASC`).all(),
  ]);

  const membersByDay = {};
  for (const row of users.results || []) {
    (membersByDay[row.day] ||= []).push({
      userId: row.platform_user_id,
      name: row.display_name,
      transactions: Number(row.transactions || 0),
      grantPoints: Number(row.grant_points || 0),
      deductPoints: Number(row.deduct_points || 0),
      netPoints: Number(row.net_points || 0),
    });
  }

  return {
    filters: { days, scope, eventType },
    summary: {
      grantPoints: Number(summary?.grant_points || 0),
      deductPoints: Number(summary?.deduct_points || 0),
      netPoints: Number(summary?.net_points || 0),
      transactions: Number(summary?.transactions || 0),
      uniqueUsers: Number(summary?.unique_users || 0),
    },
    daily: (daily.results || []).map(row => ({
      day: row.day,
      transactions: Number(row.transactions || 0),
      uniqueUsers: Number(row.unique_users || 0),
      grantPoints: Number(row.grant_points || 0),
      deductPoints: Number(row.deduct_points || 0),
      netPoints: Number(row.net_points || 0),
      members: membersByDay[row.day] || [],
    })),
    sources: (sources.results || []).map(row => ({
      eventType: row.event_type,
      status: row.status,
      transactions: Number(row.transactions || 0),
      uniqueUsers: Number(row.unique_users || 0),
      grantPoints: Number(row.grant_points || 0),
      deductPoints: Number(row.deduct_points || 0),
      netPoints: Number(row.net_points || 0),
    })),
    eventTypes: (eventTypes.results || []).map(row => String(row.event_type || '')).filter(Boolean),
  };
}

function statsHtml() {
  return new Response(`<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TDEA｜點數統計中心</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f5f7fb;color:#13213a;font-family:system-ui,-apple-system,"Noto Sans TC",sans-serif}.wrap{max-width:1500px;margin:auto;padding:26px 28px 50px}header{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;margin-bottom:24px}h1{margin:0 0 6px;font-size:30px}p{margin:0;color:#64748b}.back{border:1px solid #d6deea;background:#fff;color:#17233b;border-radius:12px;padding:12px 18px;font-weight:800;text-decoration:none}.filters{display:grid;grid-template-columns:1fr 1fr 1.4fr auto;gap:14px;margin:18px 0}.filters label{display:grid;gap:7px;font-weight:800}.filters select,.filters button{height:50px;border:1px solid #d6deea;border-radius:12px;background:#fff;padding:0 14px;font-size:16px}.filters button{border:0;background:#b95121;color:#fff;font-weight:900;padding:0 28px}.metrics{display:grid;grid-template-columns:repeat(5,1fr);gap:14px;margin-bottom:18px}.metric,.panel{background:#fff;border:1px solid #dae2ee;border-radius:16px}.metric{padding:20px}.metric small{display:block;color:#64748b;font-weight:800;margin-bottom:7px}.metric strong{font-size:30px}.grant{color:#159447}.deduct{color:#c3261d}.net{color:#2455d6}.grid{display:grid;grid-template-columns:1.6fr 1fr;gap:18px}.panel h2{font-size:21px;margin:0;padding:18px 20px;border-bottom:1px solid #e5eaf2}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse}th,td{padding:13px 14px;text-align:left;border-bottom:1px solid #e8edf4;vertical-align:top;white-space:nowrap}th{font-size:13px;color:#536176;background:#fbfcfe}.members{max-width:520px;white-space:normal}.chip{display:inline-block;margin:2px 3px 2px 0;padding:4px 8px;border-radius:999px;background:#e9f8ef;color:#167a43;font-size:12px;font-weight:800}.tag{display:inline-block;padding:5px 9px;border-radius:999px;background:#edf2ff;color:#244aa5;font-weight:800;font-size:12px}.empty{padding:32px;text-align:center;color:#8492a6}.error{display:none;margin:12px 0;padding:12px 14px;border-radius:12px;background:#fff0ee;color:#b42318;font-weight:800}@media(max-width:900px){.wrap{padding:18px 14px}.filters{grid-template-columns:1fr 1fr}.metrics{grid-template-columns:1fr 1fr}.grid{grid-template-columns:1fr}header{align-items:center}h1{font-size:25px}}@media(max-width:560px){.filters,.metrics{grid-template-columns:1fr}.filters button{width:100%}}
</style></head><body><main class="wrap"><header><div><h1>點數統計中心</h1><p>每日 K 點進出、扣贈統計與來源分類。資料來源：TDEA point_ledger_entries。</p></div><a class="back" href="/admin/">回管理中心</a></header>
<section class="filters"><label>期間<select id="days"><option value="7">近 7 天</option><option value="30" selected>近 30 天</option><option value="90">近 90 天</option><option value="365">近 365 天</option></select></label><label>統計範圍<select id="scope"><option value="posted">有效流水</option><option value="all">全部流水</option></select></label><label>事件類型<select id="eventType"><option value="">全部事件</option></select></label><button id="refresh">重新整理</button></section><div id="error" class="error"></div>
<section class="metrics"><article class="metric"><small>總贈點</small><strong id="grant" class="grant">–</strong></article><article class="metric"><small>總扣點</small><strong id="deduct" class="deduct">–</strong></article><article class="metric"><small>淨增減</small><strong id="net" class="net">–</strong></article><article class="metric"><small>流水筆數</small><strong id="transactions">–</strong></article><article class="metric"><small>觸及會員</small><strong id="users">–</strong></article></section>
<section class="grid"><article class="panel"><h2>每日進出</h2><div class="table-wrap"><table><thead><tr><th>日期</th><th>會員</th><th>贈點</th><th>扣點</th><th>淨額</th><th>筆數</th><th>人數</th></tr></thead><tbody id="daily"></tbody></table></div></article><article class="panel"><h2>來源分類</h2><div class="table-wrap"><table><thead><tr><th>類型</th><th>狀態</th><th>贈</th><th>扣</th><th>淨</th></tr></thead><tbody id="sources"></tbody></table></div></article></section></main>
<script>
const $=id=>document.getElementById(id),fmt=n=>new Intl.NumberFormat('zh-TW').format(Number(n)||0),signed=n=>(Number(n)>0?'+':'')+fmt(n);let eventLoaded=false;
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function render(data){const s=data.summary||{};$('grant').textContent=fmt(s.grantPoints);$('deduct').textContent=fmt(s.deductPoints);$('net').textContent=signed(s.netPoints);$('transactions').textContent=fmt(s.transactions);$('users').textContent=fmt(s.uniqueUsers);if(!eventLoaded){for(const type of data.eventTypes||[]){const o=document.createElement('option');o.value=type;o.textContent=type;$('eventType').appendChild(o)}eventLoaded=true}$('daily').innerHTML=(data.daily||[]).map(r=>'<tr><td><b>'+esc(r.day)+'</b></td><td class="members">'+((r.members||[]).slice(0,18).map(m=>'<span class="chip" title="'+esc(m.userId)+'">'+esc(m.name)+'</span>').join('')||'–')+'</td><td class="grant">'+fmt(r.grantPoints)+'</td><td class="deduct">'+fmt(r.deductPoints)+'</td><td class="net">'+signed(r.netPoints)+'</td><td>'+fmt(r.transactions)+'</td><td>'+fmt(r.uniqueUsers)+'</td></tr>').join('')||'<tr><td colspan="7" class="empty">目前沒有點數流水</td></tr>';$('sources').innerHTML=(data.sources||[]).map(r=>'<tr><td><span class="tag">'+esc(r.eventType)+'</span></td><td>'+esc(r.status)+'</td><td class="grant">'+fmt(r.grantPoints)+'</td><td class="deduct">'+fmt(r.deductPoints)+'</td><td class="net">'+signed(r.netPoints)+'</td></tr>').join('')||'<tr><td colspan="5" class="empty">目前沒有來源資料</td></tr>'}
async function load(){const e=$('error');e.style.display='none';const q=new URLSearchParams({days:$('days').value,scope:$('scope').value});if($('eventType').value)q.set('event_type',$('eventType').value);try{const r=await fetch('/admin/points/stats-data?'+q,{credentials:'same-origin'});if(r.status===401||r.status===403){throw new Error(r.status===403?'目前帳號沒有點數統計權限':'請先登入 TDEA 管理中心')}const j=await r.json().catch(()=>({}));if(!r.ok||!j.success)throw new Error(j.error||'讀取失敗');render(j.data||{})}catch(err){e.textContent=err.message||String(err);e.style.display='block'}}
$('refresh').onclick=load;$('days').onchange=load;$('scope').onchange=load;$('eventType').onchange=load;load();
</script></body></html>`, { headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'} });
}

async function injectStatsLink(response) {
  if (!response.ok) return response;
  const type = response.headers.get('content-type') || '';
  if (!type.includes('text/html')) return response;
  let html = await response.text();
  if (html.includes('href="/admin/points/stats"')) return new Response(html, response);
  const needle = '<button class="nav-item" data-page="points">\n            <span>◉</span> 點數規則\n          </button>';
  if (html.includes(needle)) {
    html = html.replace(needle, `${needle}\n          <a class="nav-item" href="/admin/points/stats">\n            <span>▥</span> 點數統計\n          </a>`);
  }
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(html, { status:response.status, statusText:response.statusText, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/admin/points/stats') {
      const access = await requirePointAdmin(request, env, ctx);
      if (!access.ok) {
        if (access.status === 401) return Response.redirect(new URL('/admin/', request.url), 302);
        return new Response('權限不足：僅點數管理員可查看統計。', { status:403, headers:{'content-type':'text/plain; charset=utf-8'} });
      }
      return statsHtml();
    }
    if (request.method === 'GET' && url.pathname === '/admin/points/stats-data') {
      const access = await requirePointAdmin(request, env, ctx);
      if (!access.ok) return json({ success:false, error:access.status === 403 ? 'Forbidden' : 'Unauthorized' }, access.status);
      try { return json({ success:true, data:await pointStatsData(env.DB, url) }); }
      catch (error) { console.error('Point stats failed', error); return json({ success:false, error:error?.message || '點數統計讀取失敗' }, 500); }
    }
    const response = await app.fetch(request, env, ctx);
    if (request.method === 'GET' && ['/admin/','/admin/index.html','/admin.html'].includes(url.pathname)) return injectStatsLink(response);
    return response;
  },
  scheduled(controller, env, ctx) { return app.scheduled?.(controller, env, ctx); },
};
