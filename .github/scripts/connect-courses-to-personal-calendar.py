from pathlib import Path

p = Path('src/personal-calendar.js')
s = p.read_text(encoding='utf-8')

if 'listMyCourseSessions' not in s.split('\n', 3)[0:3]:
    s = s.replace('import { newId } from "./member-repository.js";\n', 'import { newId } from "./member-repository.js";\nimport { listMyCourseSessions } from "./courses.js";\n', 1)

old = '''const SYSTEM_LABELS = [
  { sourceType: "personal", name: "未分類", color: "#b65d79", sortOrder: 20 },
  { sourceType: "birthday", name: "生日", color: "#d49121", sortOrder: 30 },
];'''
new = '''const SYSTEM_LABELS = [
  { sourceType: "company", name: "活動／課程", color: "#2563eb", sortOrder: 10 },
  { sourceType: "personal", name: "未分類", color: "#b65d79", sortOrder: 20 },
  { sourceType: "birthday", name: "生日", color: "#d49121", sortOrder: 30 },
];'''
if old not in s:
    raise SystemExit('SYSTEM_LABELS anchor not found')
s = s.replace(old, new, 1)

old = '  const labels = (labelRows.results || []).map(mapLabel).filter((label) => label.sourceType !== "company");'
new = '  const labels = (labelRows.results || []).map(mapLabel);'
if old not in s:
    raise SystemExit('labels filter anchor not found')
s = s.replace(old, new, 1)

anchor = '''  const birthdayLabel = labels.find((label) => label.sourceType === "birthday");
  const events = (privateRows.results || []).map(mapPrivateEvent);
  if (birthdayLabel) events.push(...await birthdayEvents(db, userId, birthdayLabel, start, end));
  events.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));'''
replacement = '''  const birthdayLabel = labels.find((label) => label.sourceType === "birthday");
  const companyLabel = labels.find((label) => label.sourceType === "company");
  const events = (privateRows.results || []).map(mapPrivateEvent);
  if (birthdayLabel) events.push(...await birthdayEvents(db, userId, birthdayLabel, start, end));
  if (companyLabel) {
    const sessions = await listMyCourseSessions(db, userId);
    for (const session of sessions) {
      if (session.registrationStatus && session.registrationStatus !== "registered") continue;
      const startsAt = String(session.startsAt || "");
      const endsAt = String(session.endsAt || session.startsAt || "");
      if (!startsAt || !endsAt || endsAt < start || startsAt >= end) continue;
      const location = [session.venueName, session.venueAddress].filter(Boolean).join("｜") || session.meetingUrl || "";
      events.push({
        id: `company:${session.sessionId}`,
        sourceType: "company",
        labelId: companyLabel.id,
        labelName: companyLabel.name,
        color: companyLabel.color,
        title: session.title || session.courseTitle || "活動／課程",
        description: session.courseDescription || "",
        location,
        startsAt,
        endsAt,
        allDay: false,
        reminderMinutes: 60,
        recurrence: "none",
        contactCardId: "",
        contactName: "",
        readonly: true,
        courseSessionId: session.sessionId || "",
        registeredAt: session.registeredAt || "",
        attendanceAt: session.attendanceAt || "",
      });
    }
  }
  events.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));'''
if anchor not in s:
    raise SystemExit('event merge anchor not found')
s = s.replace(anchor, replacement, 1)
p.write_text(s, encoding='utf-8')

app = Path('public/app-20260803-123.js')
a = app.read_text(encoding='utf-8')
a = a.replace('MLM 公司行事曆${event.registeredAt?"・已報名":""}', '活動／課程${event.registeredAt?"・已報名":""}')
a = a.replace('本月顯示 ${monthSessions.length} 項個人與生日行程', '本月顯示 ${monthSessions.length} 項個人、活動與生日行程')
app.write_text(a, encoding='utf-8')
