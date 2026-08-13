import { newId } from "./member-repository.js";
import { listMyCourseSessions } from "./courses.js";

const SYSTEM_LABELS = [
  { sourceType: "company", name: "活動／課程", color: "#2563eb", sortOrder: 10 },
  { sourceType: "personal", name: "未分類", color: "#b65d79", sortOrder: 20 },
  { sourceType: "birthday", name: "生日", color: "#d49121", sortOrder: 30 },
];

const text = (value, max = 500) => String(value ?? "").trim().slice(0, max);
const iso = (value) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("行程日期時間不正確");
  return date.toISOString();
};
const bool = (value) => value === true || value === 1 || value === "1";

export async function ensurePersonalCalendarSchema(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS personal_calendar_labels (
      id TEXT PRIMARY KEY,
      platform_user_id TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'custom',
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#64748b',
      is_visible INTEGER NOT NULL DEFAULT 1,
      is_system INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 100,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(platform_user_id, source_type, name)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS personal_calendar_events (
      id TEXT PRIMARY KEY,
      platform_user_id TEXT NOT NULL,
      label_id TEXT NOT NULL,
      contact_card_id TEXT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      all_day INTEGER NOT NULL DEFAULT 0,
      reminder_minutes INTEGER NOT NULL DEFAULT 0,
      recurrence TEXT NOT NULL DEFAULT 'none',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_personal_calendar_labels_user ON personal_calendar_labels(platform_user_id, sort_order)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_personal_calendar_events_user_time ON personal_calendar_events(platform_user_id, starts_at, ends_at)"),
  ]);
}

async function ensureSystemLabels(db, userId) {
  for (const label of SYSTEM_LABELS) {
    const result = await db.prepare(`
      SELECT l.*, COUNT(e.id) AS event_count
      FROM personal_calendar_labels l
      LEFT JOIN personal_calendar_events e ON e.label_id = l.id AND e.platform_user_id = l.platform_user_id
      WHERE l.platform_user_id = ? AND l.source_type = ? AND l.is_system = 1
      GROUP BY l.id
      ORDER BY event_count DESC, l.created_at ASC, l.id ASC
    `).bind(userId, label.sourceType).all();
    const rows = result.results || [];
    if (!rows.length) {
      await db.prepare(`INSERT OR IGNORE INTO personal_calendar_labels
        (id, platform_user_id, source_type, name, color, is_visible, is_system, sort_order)
        VALUES (?, ?, ?, ?, ?, 1, 1, ?)`)
        .bind(newId("cal_label"), userId, label.sourceType, label.name, label.color, label.sortOrder).run();
      continue;
    }
    const canonical = rows[0];
    for (const duplicate of rows.slice(1)) {
      await db.batch([
        db.prepare("UPDATE personal_calendar_events SET label_id=?, updated_at=CURRENT_TIMESTAMP WHERE platform_user_id=? AND label_id=?")
          .bind(canonical.id, userId, duplicate.id),
        db.prepare("DELETE FROM personal_calendar_labels WHERE id=? AND platform_user_id=? AND is_system=1")
          .bind(duplicate.id, userId),
      ]);
    }
    await db.prepare("UPDATE personal_calendar_labels SET name=?, color=?, sort_order=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND platform_user_id=?")
      .bind(label.name, label.color, label.sortOrder, canonical.id, userId).run();
  }
}

async function ensureFirstTaskEngineRecord(db, userId, contactCardId, event) {
  const taskId = `task_backfill_${event.id}`;
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO ai_tasks
      (id,platform_user_id,contact_card_id,title,description,due_at,priority,status,source,ai_status)
      VALUES (?,?,?,?,?,?,'normal','pending','card_crm','idle')`)
      .bind(taskId,userId,contactCardId,event.title,event.description,event.starts_at),
    db.prepare(`INSERT OR IGNORE INTO ai_task_events
      (id,task_id,platform_user_id,event_type,note,metadata_json)
      VALUES (?,?,?,'created',?,'{"source":"card_crm"}')`)
      .bind(`task_event_backfill_${event.id}`,taskId,userId,event.description),
  ]);
  return taskId;
}
export async function ensureContactFirstTask(db, userId, contactCardId, task = {}) {
  await ensurePersonalCalendarSchema(db);
  await ensureSystemLabels(db, userId);
  const contact = await db.prepare("SELECT id,display_name FROM contact_cards WHERE id=? AND scanner_user_id=? AND status='active'")
    .bind(contactCardId, userId).first();
  if (!contact) throw new Error("關聯名片不存在");
  const existing = await db.prepare(`SELECT id,title,description,starts_at,ends_at FROM personal_calendar_events
    WHERE platform_user_id=? AND contact_card_id=? AND status='active' AND instr(description,'[AI智慧名片CRM]')=1
    ORDER BY created_at ASC LIMIT 1`).bind(userId, contactCardId).first();
  if (existing) { const taskId=await ensureFirstTaskEngineRecord(db,userId,contactCardId,existing); return { id:existing.id, taskId, existing:true }; }
  const label = await db.prepare("SELECT id FROM personal_calendar_labels WHERE platform_user_id=? AND source_type='personal' AND is_system=1 ORDER BY created_at ASC LIMIT 1")
    .bind(userId).first();
  if (!label) throw new Error("找不到個人行程標籤");
  const dueInDays = Math.max(1, Math.min(30, Number(task.dueInDays) || 3));
  const startsAt = new Date(Date.now() + dueInDays * 86400000);
  const endsAt = new Date(startsAt.getTime() + 3600000);
  const id = newId("cal_event");
  const title = text(task.title, 100) || `首次聯絡 ${contact.display_name || "名片聯絡人"}`;
  const description = `[AI智慧名片CRM]\n${text(task.description, 1900) || "確認公司公開資料並完成第一次聯絡。"}`;
  await db.prepare(`INSERT INTO personal_calendar_events
    (id,platform_user_id,label_id,contact_card_id,title,description,location,starts_at,ends_at,all_day,reminder_minutes,recurrence)
    VALUES (?,?,?,?,?,?,?,?,?,0,1440,'none')`)
    .bind(id,userId,label.id,contactCardId,title,description,"",startsAt.toISOString(),endsAt.toISOString()).run();
  const taskId=await ensureFirstTaskEngineRecord(db,userId,contactCardId,{id,title,description,starts_at:startsAt.toISOString()});
  return { id, taskId, existing:false };
}
function mapLabel(row) {
  return {
    id: row.id,
    sourceType: row.source_type,
    name: row.source_type === "personal" ? "未分類" : row.name,
    color: row.color,
    visible: Boolean(row.is_visible),
    system: Boolean(row.is_system),
    sortOrder: Number(row.sort_order || 0),
  };
}

function mapPrivateEvent(row) {
  return {
    id: row.id,
    sourceType: row.source_type || "personal",
    labelId: row.label_id,
    labelName: row.source_type === "personal" ? "未分類" : (row.label_name || "未分類"),
    color: row.label_color || "#b65d79",
    title: row.title,
    description: row.description || "",
    location: row.location || "",
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    allDay: Boolean(row.all_day),
    reminderMinutes: Number(row.reminder_minutes || 0),
    recurrence: row.recurrence || "none",
    contactCardId: row.contact_card_id || "",
    contactName: row.contact_name || "",
    readonly: false,
  };
}

function annualBirthday(dateValue, year) {
  const match = String(dateValue || "").match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const candidate = `${year}-${match[1]}-${match[2]}`;
  const date = new Date(`${candidate}T00:00:00+08:00`);
  return Number.isFinite(date.getTime()) ? candidate : "";
}

async function birthdayEvents(db, userId, label, from, to) {
  const rows = await db.prepare(`
    SELECT 'self' AS contact_id, mp.display_name, mp.birthday
    FROM member_profiles mp WHERE mp.platform_user_id = ?
    UNION ALL
    SELECT cc.id AS contact_id, cc.display_name, mp.birthday
    FROM contact_cards cc
    JOIN member_profiles mp ON mp.platform_user_id = cc.bound_user_id
    WHERE cc.scanner_user_id = ? AND cc.status = 'active' AND COALESCE(mp.birthday, '') <> ''
  `).bind(userId, userId).all();
  const fromDate = new Date(from);
  const toDate = new Date(to);
  const years = [];
  for (let year = fromDate.getUTCFullYear() - 1; year <= toDate.getUTCFullYear() + 1; year += 1) years.push(year);
  const events = [];
  for (const row of rows.results || []) {
    for (const year of years) {
      const day = annualBirthday(row.birthday, year);
      if (!day) continue;
      const startsAt = new Date(`${day}T00:00:00+08:00`).toISOString();
      const endsAt = new Date(`${day}T23:59:59+08:00`).toISOString();
      if (endsAt < from || startsAt >= to) continue;
      events.push({
        id: `birthday:${row.contact_id}:${year}`,
        sourceType: "birthday",
        labelId: label.id,
        labelName: label.name,
        color: label.color,
        title: row.contact_id === "self" ? "我的生日" : `${row.display_name || "聯絡人"}生日`,
        description: "",
        location: "",
        startsAt,
        endsAt,
        allDay: true,
        reminderMinutes: 1440,
        recurrence: "yearly",
        contactCardId: row.contact_id === "self" ? "" : row.contact_id,
        contactName: row.contact_id === "self" ? "" : row.display_name || "",
        readonly: true,
      });
    }
  }
  return events;
}

export async function listPersonalCalendar(db, userId, { from, to }) {
  await ensurePersonalCalendarSchema(db);
  await ensureSystemLabels(db, userId);
  const start = iso(from);
  const end = iso(to);
  const labelRows = await db.prepare("SELECT * FROM personal_calendar_labels WHERE platform_user_id = ? ORDER BY sort_order, created_at").bind(userId).all();
  const labels = (labelRows.results || []).map(mapLabel);
  const privateRows = await db.prepare(`
    SELECT e.*, l.source_type, l.name AS label_name, l.color AS label_color, cc.display_name AS contact_name
    FROM personal_calendar_events e
    JOIN personal_calendar_labels l ON l.id = e.label_id AND l.platform_user_id = e.platform_user_id
    LEFT JOIN contact_cards cc ON cc.id = e.contact_card_id AND cc.scanner_user_id = e.platform_user_id AND cc.status = 'active'
    WHERE e.platform_user_id = ? AND e.status = 'active' AND e.starts_at < ? AND e.ends_at >= ?
    ORDER BY e.starts_at
  `).bind(userId, end, start).all();
  const contacts = await db.prepare(`
    SELECT cc.id, cc.display_name, cc.company_name, cc.job_title, mp.birthday
    FROM contact_cards cc
    LEFT JOIN member_profiles mp ON mp.platform_user_id = cc.bound_user_id
    WHERE cc.scanner_user_id = ? AND cc.status = 'active'
    ORDER BY cc.display_name LIMIT 200
  `).bind(userId).all();
  const birthdayLabel = labels.find((label) => label.sourceType === "birthday");
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
  events.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  return {
    labels,
    events,
    contacts: (contacts.results || []).map((row) => ({
      id: row.id,
      displayName: row.display_name || "未命名聯絡人",
      companyName: row.company_name || "",
      jobTitle: row.job_title || "",
      birthday: row.birthday || "",
    })),
  };
}

async function ownedLabel(db, userId, labelId) {
  return db.prepare("SELECT * FROM personal_calendar_labels WHERE id = ? AND platform_user_id = ?").bind(labelId, userId).first();
}

export async function createCalendarLabel(db, userId, body) {
  await ensurePersonalCalendarSchema(db);
  const name = text(body.name, 20);
  const color = /^#[0-9a-f]{6}$/i.test(String(body.color || "")) ? body.color : "#64748b";
  if (!name) throw new Error("請輸入標籤名稱");

  const findExisting = () => db.prepare(`SELECT * FROM personal_calendar_labels
    WHERE platform_user_id=? AND source_type='custom' AND lower(name)=lower(?)
    ORDER BY created_at ASC LIMIT 1`).bind(userId, name).first();
  let existing = await findExisting();
  if (existing) {
    await db.prepare("UPDATE personal_calendar_labels SET color=?, is_visible=1, updated_at=CURRENT_TIMESTAMP WHERE id=? AND platform_user_id=?")
      .bind(color, existing.id, userId).run();
    return mapLabel(await ownedLabel(db, userId, existing.id));
  }

  const id = newId("cal_label");
  await db.prepare(`INSERT OR IGNORE INTO personal_calendar_labels
    (id, platform_user_id, source_type, name, color, is_visible, is_system, sort_order)
    VALUES (?, ?, 'custom', ?, ?, 1, 0, 100)`).bind(id, userId, name, color).run();
  existing = await findExisting();
  if (!existing) throw new Error("標籤建立失敗，請稍後再試");
  return mapLabel(existing);
}

export async function updateCalendarLabel(db, userId, labelId, body) {
  await ensurePersonalCalendarSchema(db);
  const current = await ownedLabel(db, userId, labelId);
  if (!current) throw new Error("找不到標籤");
  const name = current.is_system ? current.name : (text(body.name ?? current.name, 20) || current.name);
  const color = /^#[0-9a-f]{6}$/i.test(String(body.color || "")) ? body.color : current.color;
  const visible = body.visible === undefined ? Boolean(current.is_visible) : bool(body.visible);
  await db.prepare("UPDATE personal_calendar_labels SET name=?, color=?, is_visible=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND platform_user_id=?")
    .bind(name, color, visible ? 1 : 0, labelId, userId).run();
  return mapLabel(await ownedLabel(db, userId, labelId));
}

export async function deleteCalendarLabel(db, userId, labelId) {
  await ensurePersonalCalendarSchema(db);
  const current = await ownedLabel(db, userId, labelId);
  if (!current) throw new Error("找不到標籤");
  if (current.is_system) throw new Error("系統標籤不能刪除");
  const personal = await db.prepare("SELECT id FROM personal_calendar_labels WHERE platform_user_id=? AND source_type='personal'").bind(userId).first();
  await db.batch([
    db.prepare("UPDATE personal_calendar_events SET label_id=?, updated_at=CURRENT_TIMESTAMP WHERE platform_user_id=? AND label_id=?").bind(personal.id, userId, labelId),
    db.prepare("DELETE FROM personal_calendar_labels WHERE id=? AND platform_user_id=?").bind(labelId, userId),
  ]);
  return true;
}

export async function savePersonalCalendarEvent(db, userId, body, eventId = "") {
  await ensurePersonalCalendarSchema(db);
  await ensureSystemLabels(db, userId);
  const id = eventId || newId("cal_event");
  const title = text(body.title, 100);
  const label = await ownedLabel(db, userId, text(body.labelId, 100));
  if (!title) throw new Error("請輸入行程名稱");
  if (!label || label.source_type === "company" || label.source_type === "birthday") throw new Error("請選擇個人或自訂標籤");
  const startsAt = iso(body.startsAt);
  const endsAt = iso(body.endsAt);
  if (endsAt <= startsAt) throw new Error("結束時間必須晚於開始時間");
  const reminder = Math.max(0, Math.min(10080, Number(body.reminderMinutes) || 0));
  const contactId = text(body.contactCardId, 100);
  if (contactId) {
    const contact = await db.prepare("SELECT id FROM contact_cards WHERE id=? AND scanner_user_id=? AND status='active'").bind(contactId, userId).first();
    if (!contact) throw new Error("關聯名片不存在");
  }
  const existing = eventId ? await db.prepare("SELECT id FROM personal_calendar_events WHERE id=? AND platform_user_id=? AND status='active'").bind(id, userId).first() : null;
  if (eventId && !existing) throw new Error("找不到行程");
  if (existing) {
    await db.prepare(`UPDATE personal_calendar_events SET label_id=?, contact_card_id=?, title=?, description=?, location=?,
      starts_at=?, ends_at=?, all_day=?, reminder_minutes=?, recurrence=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND platform_user_id=?`).bind(label.id, contactId || null, title, text(body.description, 2000), text(body.location, 300), startsAt, endsAt, bool(body.allDay) ? 1 : 0, reminder, body.recurrence === "yearly" ? "yearly" : "none", id, userId).run();
  } else {
    await db.prepare(`INSERT INTO personal_calendar_events
      (id, platform_user_id, label_id, contact_card_id, title, description, location, starts_at, ends_at, all_day, reminder_minutes, recurrence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, userId, label.id, contactId || null, title, text(body.description, 2000), text(body.location, 300), startsAt, endsAt, bool(body.allDay) ? 1 : 0, reminder, body.recurrence === "yearly" ? "yearly" : "none").run();
  }
  const row = await db.prepare(`SELECT e.*, l.source_type, l.name AS label_name, l.color AS label_color, cc.display_name AS contact_name
    FROM personal_calendar_events e JOIN personal_calendar_labels l ON l.id=e.label_id
    LEFT JOIN contact_cards cc ON cc.id=e.contact_card_id WHERE e.id=? AND e.platform_user_id=?`).bind(id, userId).first();
  return mapPrivateEvent(row);
}

export async function deletePersonalCalendarEvent(db, userId, eventId) {
  await ensurePersonalCalendarSchema(db);
  const result = await db.prepare("UPDATE personal_calendar_events SET status='deleted', updated_at=CURRENT_TIMESTAMP WHERE id=? AND platform_user_id=? AND status='active'").bind(eventId, userId).run();
  if (!Number(result.meta?.changes || 0)) throw new Error("找不到行程");
  return true;
}
