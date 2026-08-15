import app from './point-stats-entry.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store' },
});

async function aggregateMembers(request, env, ctx) {
  const base = await app.fetch(request, env, ctx);
  if (!base.ok) return base;
  let payload;
  try { payload = await base.clone().json(); } catch { return base; }

  const members = Array.isArray(payload?.members)
    ? payload.members
    : Array.isArray(payload?.data?.members)
      ? payload.data.members
      : Array.isArray(payload?.data)
        ? payload.data
        : null;
  if (!members || !env.DB) return base;

  const byId = new Map(members.map((member) => [String(member.id || member.user_id || member.platform_user_id || ''), member]));
  const cards = await env.DB.prepare(`
    SELECT
      cc.id,
      cc.scanner_user_id,
      cc.bound_user_id,
      cc.display_name,
      cc.company_name,
      cc.job_title,
      cc.department,
      cc.mobile,
      cc.company_phone,
      cc.email,
      cc.created_at,
      owner.display_name AS owner_name,
      owner.member_number AS owner_member_number
    FROM contact_cards cc
    LEFT JOIN member_profiles owner ON owner.platform_user_id = cc.scanner_user_id
    WHERE cc.status = 'active'
    ORDER BY cc.updated_at DESC, cc.created_at DESC
  `).all();

  const contactOnly = [];
  for (const row of cards.results || []) {
    const boundId = String(row.bound_user_id || '');
    if (boundId && byId.has(boundId)) {
      const member = byId.get(boundId);
      member.crm_source = 'registered_collected';
      member.collection_count = Number(member.collection_count || 0) + 1;
      const owners = new Set(Array.isArray(member.collection_owner_names) ? member.collection_owner_names : []);
      if (row.owner_name) owners.add(String(row.owner_name));
      member.collection_owner_names = [...owners];
      continue;
    }

    contactOnly.push({
      id:`contact:${row.id}`,
      crm_contact_id:row.id,
      crm_source:'collected',
      is_contact_only:true,
      display_name:String(row.display_name || '未命名名片'),
      phone:String(row.mobile || row.company_phone || ''),
      email:String(row.email || ''),
      company_name:String(row.company_name || ''),
      job_title:String(row.job_title || ''),
      department:String(row.department || ''),
      member_type:'contact',
      binding_status:'contact_only',
      company_member_number:'',
      member_number:'',
      referrer_name:String(row.owner_name || '名片收藏'),
      referrer_member_number:String(row.owner_member_number || ''),
      owner_user_id:String(row.scanner_user_id || ''),
      owner_name:String(row.owner_name || ''),
      points_balance:0,
      status:'contact_only',
      created_at:row.created_at,
      registration_status:'not_registered',
    });
  }

  for (const member of members) {
    if (!member.crm_source) member.crm_source = 'registered';
  }
  const merged = [...members, ...contactOnly];

  if (Array.isArray(payload.members)) payload.members = merged;
  else if (Array.isArray(payload?.data?.members)) payload.data.members = merged;
  else if (Array.isArray(payload?.data)) payload.data = merged;
  payload.crm = {
    registeredCount:members.length,
    collectedOnlyCount:contactOnly.length,
    total:merged.length,
  };
  return json(payload, base.status);
}

async function contactDetail(request, env, ctx, id) {
  const authRequest = new Request(new URL('/v1/admin/members', request.url), {
    method:'GET',
    headers:request.headers,
  });
  const auth = await app.fetch(authRequest, env, ctx);
  if (!auth.ok) return auth;
  const row = await env.DB.prepare(`
    SELECT cc.*, owner.display_name AS owner_name, owner.member_number AS owner_member_number
    FROM contact_cards cc
    LEFT JOIN member_profiles owner ON owner.platform_user_id = cc.scanner_user_id
    WHERE cc.id = ? AND cc.status = 'active'
    LIMIT 1
  `).bind(id).first();
  if (!row) return json({ success:false, error:'找不到名片收藏資料' }, 404);
  return json({ success:true, contact:{
    id:row.id,
    displayName:row.display_name || '',
    companyName:row.company_name || '',
    jobTitle:row.job_title || '',
    department:row.department || '',
    mobile:row.mobile || '',
    companyPhone:row.company_phone || '',
    email:row.email || '',
    websiteUrl:row.website_url || '',
    lineUrl:row.line_url || '',
    address:row.address || '',
    serviceDescription:row.service_description || '',
    note:row.note || '',
    boundUserId:row.bound_user_id || '',
    ownerUserId:row.scanner_user_id || '',
    ownerName:row.owner_name || '',
    ownerMemberNumber:row.owner_member_number || '',
    createdAt:row.created_at,
    updatedAt:row.updated_at,
  }});
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/v1/admin/members') {
      return aggregateMembers(request, env, ctx);
    }
    const match = request.method === 'GET' && url.pathname.match(/^\/v1\/admin\/crm\/contacts\/([^/]+)$/);
    if (match) return contactDetail(request, env, ctx, decodeURIComponent(match[1]));
    return app.fetch(request, env, ctx);
  },
  scheduled(controller, env, ctx) { return app.scheduled?.(controller, env, ctx); },
};
