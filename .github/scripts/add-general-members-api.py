from pathlib import Path

p = Path('src/tdea-point-service.js')
s = p.read_text(encoding='utf-8')

anchor = "  const balanceMatch = url.pathname.match(/^\\/internal\\/tdea\\/points\\/([^/]+)$/);\n"
if anchor not in s:
    raise SystemExit('balance anchor not found')

block = r'''  if (request.method === 'GET' && url.pathname === '/internal/tdea/points/members') {
    const type = clean(url.searchParams.get('type'), 40) || 'general';
    if (!['general', 'association', 'vendor'].includes(type)) return json({ success: false, error: 'Invalid member type' }, 400);
    const rows = await env.DB.prepare(`
      SELECT mp.platform_user_id AS user_id,
        mp.display_name, mp.full_name, mp.phone, mp.email, mp.gender, mp.birthday,
        mp.member_number, mp.company_member_number, mp.member_type, mp.roster_member_number,
        mp.profile_completed_at, pu.status,
        ei.provider_subject AS line_user_id,
        COALESCE(pa.balance, 0) AS point_balance
      FROM member_profiles mp
      JOIN platform_users pu ON pu.id = mp.platform_user_id AND pu.status = 'active'
      LEFT JOIN external_identities ei
        ON ei.platform_user_id = mp.platform_user_id
       AND ei.provider = 'line_login'
       AND ei.verification_status = 'verified'
      LEFT JOIN point_accounts pa
        ON pa.platform_user_id = mp.platform_user_id
       AND pa.program_id = 'program_main'
      WHERE COALESCE(NULLIF(mp.member_type, ''), 'general') = ?
        AND mp.profile_completed_at IS NOT NULL
        AND mp.profile_completed_at != ''
      ORDER BY mp.profile_completed_at DESC, mp.updated_at DESC
      LIMIT 2000
    `).bind(type).all();
    const members = (rows.results || []).map((row) => ({
      userId: row.user_id || '',
      displayName: row.display_name || '',
      fullName: row.full_name || '',
      phone: row.phone || '',
      email: row.email || '',
      gender: row.gender || '',
      birthday: row.birthday || '',
      memberNumber: row.member_number || '',
      companyMemberNumber: row.company_member_number || '',
      memberType: row.member_type || 'general',
      rosterMemberNumber: row.roster_member_number || '',
      lineUserId: row.line_user_id || '',
      pointBalance: Number(row.point_balance || 0),
      profileCompletedAt: row.profile_completed_at || '',
    }));
    return json({ success: true, type, count: members.length, members });
  }

'''
s = s.replace(anchor, block + anchor, 1)
p.write_text(s, encoding='utf-8')
