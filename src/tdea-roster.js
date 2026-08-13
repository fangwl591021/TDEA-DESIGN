const MEMBER_TYPES = new Set(["general", "association", "vendor"]);

const clean = (value, limit = 160) => String(value || "").trim().slice(0, limit);

export function normalizeMemberType(value) {
  const type = clean(value, 20).toLowerCase();
  if (!MEMBER_TYPES.has(type)) throw new Error("請選擇一般會員、協會會員或廠商會員");
  return type;
}

async function readChildRoster(service) {
  if (!service?.fetch) throw new Error("TDEA 會員核對服務尚未設定");
  const response = await service.fetch(new Request("https://tdea-roster.internal/roster.json", {
    method: "GET",
    headers: { accept: "application/json", "cache-control": "no-store" },
  }));
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || typeof payload !== "object") throw new Error("TDEA 正式名冊讀取失敗");
  return payload;
}

function findRosterByNumber(roster, type, number) {
  const target = clean(number, 80).toUpperCase();
  const rows = type === "vendor" ? roster?.v : roster?.a;
  if (!target || !Array.isArray(rows)) return null;
  const row = rows.find((item) => Array.isArray(item) && clean(item[0], 80).toUpperCase() === target);
  if (!row) return null;
  if (type === "vendor") {
    return {
      memberNumber: clean(row[0], 80).toUpperCase(),
      rosterName: clean(row[1], 120),
      qualification: clean(row[5], 20).toUpperCase(),
      source: "tdeawork-roster",
    };
  }
  return {
    memberNumber: clean(row[0], 80).toUpperCase(),
    rosterName: clean(row[2], 120),
    qualification: clean(row[4], 20).toUpperCase(),
    source: "tdeawork-roster",
  };
}

function findRosterByName(roster, type, name) {
  const target = clean(name, 120).replace(/\s+/g, "").toLowerCase();
  const rows = type === "vendor" ? roster?.v : roster?.a;
  if (!target || !Array.isArray(rows)) return null;
  const row = rows.find((item) => {
    if (!Array.isArray(item)) return false;
    const candidates = type === "vendor" ? [item[1], item[3], item[4]] : [item[2]];
    return candidates.some((value) => clean(value, 120).replace(/\s+/g, "").toLowerCase() === target);
  });
  if (!row) return null;
  return findRosterByNumber(roster, type, row[0]);
}

export async function verifyTdeaRosterMember(service, lookupSecret, { memberType, memberNumber, fullName, phone, birthday }) {
  const type = normalizeMemberType(memberType);
  const number = clean(memberNumber, 80).toUpperCase();
  const name = clean(fullName, 120);
  if (!name) throw new Error("請填寫姓名");
  if (type !== "general" && !number) throw new Error("協會會員與廠商會員必須填寫會員編號");
  if (!service?.fetch) throw new Error("TDEA 會員核對服務尚未設定");

  if (type === "association" || type === "vendor") {
    const roster = await readChildRoster(service);
    const match = findRosterByNumber(roster, type, number);
    if (!match) throw new Error("查無此會員編號，請確認後再試");
    if (match.qualification && match.qualification !== "Y") throw new Error("此會員目前資格無效，請洽管理員確認");
    return {
      memberType: type,
      memberNumber: match.memberNumber,
      rosterName: match.rosterName,
      source: match.source,
    };
  }

  if (!clean(lookupSecret, 500)) throw new Error("TDEA 會員核對密鑰尚未設定");
  const response = await service.fetch(new Request("https://tdea-roster.internal/api/internal/tdea-design/member-lookup", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-tdea-design-key": clean(lookupSecret, 500),
    },
    body: JSON.stringify({
      memberType: type,
      memberNumber: number,
      fullName: name,
      phone: clean(phone, 40),
      birthday: clean(birthday, 20),
    }),
  }));
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success || !payload?.match) {
    throw new Error(clean(payload?.message, 240) || "TDEA 會員資料核對失敗，請稍後再試");
  }
  return {
    memberType: type,
    memberNumber: clean(payload.match.memberNumber, 80).toUpperCase(),
    rosterName: clean(payload.match.rosterName, 120),
    source: clean(payload.match.source, 40),
  };
}

export async function lookupTdeaRosterMemberNumber(service, lookupSecret, { memberType, fullName }) {
  const type = normalizeMemberType(memberType);
  const name = clean(fullName, 120);
  if (!["association", "vendor"].includes(type)) throw new Error("請先選擇協會會員或廠商會員");
  if (!name) throw new Error("請填寫姓名／公司名稱");
  if (!service?.fetch) throw new Error("TDEA 會員核對服務尚未設定");

  const roster = await readChildRoster(service);
  const match = findRosterByName(roster, type, name);
  if (!match) throw new Error("查無對應會員編號，請確認姓名／公司名稱");
  if (match.qualification && match.qualification !== "Y") throw new Error("此會員目前資格無效，請洽管理員確認");
  return {
    memberType: type,
    memberNumber: match.memberNumber,
    rosterName: match.rosterName,
    source: match.source,
  };
}
