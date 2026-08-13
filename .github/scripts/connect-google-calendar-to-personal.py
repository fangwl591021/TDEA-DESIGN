from pathlib import Path

p = Path('src/index.js')
s = p.read_text(encoding='utf-8')
old = '''  if (url.pathname === "/v1/personal-calendar" && request.method === "GET") {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    const now = new Date();
    const from = url.searchParams.get("from") || new Date(now.getFullYear(), now.getMonth() - 6, 1).toISOString();
    const to = url.searchParams.get("to") || new Date(now.getFullYear(), now.getMonth() + 18, 1).toISOString();
    try {
      return json({ success: true, ...(await listPersonalCalendar(env.DB, member.userId, { from, to })) });
    } catch (error) {
      return json({ success: false, error: error.message || "個人行事曆讀取失敗" }, 400);
    }
  }
'''
new = '''  if (url.pathname === "/v1/personal-calendar" && request.method === "GET") {
    const member = await currentMember(request, env);
    if (!member) return json({ success: false, error: "Unauthorized" }, 401);
    const now = new Date();
    const from = url.searchParams.get("from") || new Date(now.getFullYear(), now.getMonth() - 6, 1).toISOString();
    const to = url.searchParams.get("to") || new Date(now.getFullYear(), now.getMonth() + 18, 1).toISOString();
    try {
      const calendar = await listPersonalCalendar(env.DB, member.userId, { from, to });
      const companyLabel = (calendar.labels || []).find((label) => label.sourceType === "company");
      if (companyLabel && env.TDEA_WORKER) {
        try {
          const calendarId = String(env.TDEA_GOOGLE_CALENDAR_ID || "7d66f2a96f192dda6cca2b04e60a6e549c7adf74f57721845d5b7e03f8b7ca89@group.calendar.google.com");
          const upstream = await env.TDEA_WORKER.fetch(new Request(`https://tdeawork/api/calendar/events?calendarId=${encodeURIComponent(calendarId)}`));
          const payload = await upstream.json().catch(() => ({}));
          const rows = Array.isArray(payload.data) ? payload.data : [];
          const fromMs = Date.parse(from), toMs = Date.parse(to);
          const existing = new Set((calendar.events || []).map((event) => `${event.sourceType}|${event.title}|${event.startsAt}`));
          for (const row of rows) {
            const rawStart = row.start || row.startsAt || row.courseTime || "";
            let startMs = Date.parse(rawStart);
            if (!Number.isFinite(startMs) && row.courseTime) startMs = Date.parse(String(row.courseTime).replaceAll('/', '-'));
            if (!Number.isFinite(startMs) || startMs < fromMs || startMs >= toMs) continue;
            const rawEnd = row.end || row.endsAt || "";
            let endMs = Date.parse(rawEnd);
            if (!Number.isFinite(endMs) || endMs <= startMs) endMs = startMs + 2 * 60 * 60 * 1000;
            const startsAt = new Date(startMs).toISOString();
            const title = String(row.name || row.title || "協會活動");
            const dedupe = `company|${title}|${startsAt}`;
            if (existing.has(dedupe)) continue;
            existing.add(dedupe);
            calendar.events.push({
              id: `google:${String(row.uid || row.id || `${startMs}:${title}`).slice(0, 180)}`,
              sourceType: "company",
              labelId: companyLabel.id,
              labelName: companyLabel.name,
              color: companyLabel.color,
              title,
              description: String(row.description || ""),
              location: String(row.location || ""),
              startsAt,
              endsAt: new Date(endMs).toISOString(),
              allDay: Boolean(row.allDay),
              reminderMinutes: 60,
              recurrence: "none",
              contactCardId: "",
              contactName: "",
              readonly: true,
              googleCalendar: true,
            });
          }
          calendar.events.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
        } catch (error) {
          console.warn("Google calendar bridge failed", error);
        }
      }
      return json({ success: true, ...calendar });
    } catch (error) {
      return json({ success: false, error: error.message || "個人行事曆讀取失敗" }, 400);
    }
  }
'''
if old not in s:
    raise SystemExit('personal calendar route anchor not found')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')
