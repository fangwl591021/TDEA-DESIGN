const MEMBER_TYPES = new Set(["general", "association", "vendor"]);

const clean = (value, limit = 160) => String(value || "").trim().slice(0, limit);
const normalizedName = (value) => clean(value, 160).toLocaleLowerCase().replace(/\s+/g, "");

export function normalizeMemberType(value) {
  const type = clean(value, 20).toLowerCase();
  if (!MEMBER_TYPES.has(type)) throw new Error("請選擇一般會員、協會會員或廠商會員");
  return type;
}

export async function verifyTdeaRosterMember(service, lookupSecret, { memberType, memberNumber, fullName, phone, birthday }) {
  const type = normalizeMemberType(memberType);
  const number = clean(memberNumber, 80).toUpperCase();
  const name = clean(fullName, 120);
  if (!name) throw new Error("請填寫姓名");
  if (type !== "general" && !number) throw new Error("協會會員與廠商會員必須填寫會員編號");
  if (!service?.fetch) throw new Error("TDEA 會員核對服務尚未設定");
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

async function listRosterCandidates(service, type, fullName) {
  const response = await service.fetch(new Request("https://tdea-roster.internal/api/roster/live", {
    method: "GET",
    headers: { accept: "application/json" },
  }));
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) return [];
  const rows = type === "association" ? payload.a : payload.v;
  if (!Array.isArray(rows)) return [];
  const needle = normalizedName(fullName);
  const candidates = rows.map((row) => {
    if (!Array.isArray(row)) return null;
    const memberNumber = clean(row[0], 80).toUpperCase();
    const rosterName = type === "association"
      ? clean(row[2], 120)
      : clean(row[1] || row[4] || row[3], 120);
    const phone = type === "association" ? clean(row[6], 40) : clean(row[7], 40);
    if (!memberNumber || !rosterName) return null;
    return { memberNumber, rosterName, phone, source: "roster/live" };
  }).filter(Boolean);
  const exact = candidates.filter((item) => normalizedName(item.rosterName) === needle);
  const matches = exact.length ? exact : candidates.filter((item) => normalizedName(item.rosterName).includes(needle));
  const seen = new Set();
  return matches.filter((item) => {
    if (seen.has(item.memberNumber)) return false;
    seen.add(item.memberNumber);
    return true;
  }).slice(0, 20);
}

export async function lookupTdeaRosterMemberNumber(service, lookupSecret, { memberType, fullName }) {
  const type = normalizeMemberType(memberType);
  const name = clean(fullName, 120);
  if (!["association", "vendor"].includes(type)) throw new Error("請先選擇協會會員或廠商會員");
  if (!name) throw new Error("請填寫姓名／公司名稱");
  if (!service?.fetch) throw new Error("TDEA 會員核對服務尚未設定");
  if (!clean(lookupSecret, 500)) throw new Error("TDEA 會員核對密鑰尚未設定");
  const response = await service.fetch(new Request("https://tdea-roster.internal/api/internal/tdea-design/member-number-lookup", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", "x-tdea-design-key": clean(lookupSecret, 500) },
    body: JSON.stringify({ memberType: type, fullName: name }),
  }));
  const payload = await response.json().catch(() => null);
  if (response.status === 409) {
    const candidates = await listRosterCandidates(service, type, name);
    if (candidates.length) {
      return {
        memberType: type,
        ambiguous: true,
        candidates,
        rosterName: name,
        source: "roster/live",
      };
    }
  }
  if (!response.ok || !payload?.success || !payload?.match?.memberNumber) {
    throw new Error(clean(payload?.message, 240) || "會員編號查詢失敗，請稍後再試");
  }
  return {
    memberType: type,
    memberNumber: clean(payload.match.memberNumber, 80).toUpperCase(),
    rosterName: clean(payload.match.rosterName, 120),
    phone: clean(payload.match.phone, 40),
    source: clean(payload.match.source, 40),
  };
}
