from pathlib import Path
p = Path('src/index.js')
s = p.read_text(encoding='utf-8')
old = """      const profile = (await readJson(request)) || {};
      const rosterVerification = await verifyTdeaRosterMember(env.TDEA_WORKER, env.TDEA_DESIGN_LOOKUP_SECRET, profile);
      const updated = await updateMemberProfile(
"""
new = """      const profile = (await readJson(request)) || {};
      const memberType = String(profile.memberType || '').trim().toLowerCase();
      const rosterVerification = memberType === 'general'
        ? { memberType: 'general', memberNumber: '', rosterName: '', source: 'self_registration' }
        : await verifyTdeaRosterMember(env.TDEA_WORKER, env.TDEA_DESIGN_LOOKUP_SECRET, profile);
      const updated = await updateMemberProfile(
"""
if old not in s:
    raise SystemExit('registration anchor not found')
p.write_text(s.replace(old, new, 1), encoding='utf-8')
