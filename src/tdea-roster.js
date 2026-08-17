const MEMBER_TYPES = new Set(["general", "association", "vendor"]);

const clean = (value, limit = 160) => String(value || "").trim().slice(0, limit);
const normalizeMemberNumber = (value) => clean(value, 80).toUpperCase().replace(/[\s\-_.()（）]+/g, "");

export function normalizeMemberType(value) {
  const type = clean(value, 20).toLowerCase();
  if (!MEMBER_TYPES.has(type)) throw new Error("請選擇一般會員、協會會員或廠商會員");
  return type;
}

async function loadTdeaRoster(service) {
  if (!service?.fetch) throw new Error("TDEA 會員核對服務尚未設定");
  const response = await service.fetch(new Request("https://tdea-roster.internal/api/roster/live", {
    method: "GET",
    headers: { accept: "application/json", "cache-control": "no-cache" },
  }));
  const roster = await response.json().catch(() => null);
  if (!response.ok || !roster || (!Array.isArray(roster.a) && !Array.isArray(roster.v))) {
    throw new Error("TDEA 即時名冊讀取失敗");
  }
  return roster;
}

export async function verifyTdeaRosterMember(service, lookupSecret, { memberType, memberNumber, fullName, phone, birthday }) {
  const type = normalizeMemberType(memberType);
  const number = normalizeMemberNumber(memberNumber);
  const name = clean(fullName, 120);
  if (!name) throw new Error("請填寫姓名");

  if (type === "general") {
    return {
      memberType: "general",
      memberNumber: "",
      rosterName: "",
      source: "self_registration",
    };
  }

  if (!number) throw new Error("協會會員與廠商會員必須填寫會員編號");
  if (!clean(lookupSecret, 500)) throw new Error("TDEA 會員核對密鑰尚未設定");

  const roster = await loadTdeaRoster(service);
  const rows = type === "vendor" ? roster.v : roster.a;
  const match = Array.isArray(rows) ? rows.find((row) => normalizeMemberNumber(row?.[0]) === number) : null;
  if (!match) throw new Error("查無此會員編號，請確認後再試");
  const qualification = type === "vendor" ? clean(match?.[5], 20).toUpperCase() : clean(match?.[4], 20).toUpperCase();
  if (qualification && qualification !== "Y") throw new Error("此會員目前不是有效會員資格");
  const rosterName = type === "vendor" ? clean(match?.[1] || match?.[4] || match?.[3], 120) : clean(match?.[2], 120);
  return {
    memberType: type,
    memberNumber: number,
    rosterName,
    source: "tdea_roster",
  };
}

export async function lookupTdeaRosterMemberNumber(service, lookupSecret, { memberType, fullName }) {
  const type = normalizeMemberType(memberType);
  const name = clean(fullName, 120);
  if (!["association", "vendor"].includes(type)) throw new Error("請先選擇協會會員或廠商會員");
  if (!name) throw new Error("請填寫姓名／公司名稱");
  if (!clean(lookupSecret, 500)) throw new Error("TDEA 會員核對密鑰尚未設定");
  const roster = await loadTdeaRoster(service);
  const rows = type === "vendor" ? roster.v : roster.a;
  const normalizeName = (value) => clean(value, 160).replace(/\s+/g, "").toLowerCase();
  const target = normalizeName(name);
  const match = Array.isArray(rows) ? rows.find((row) => {
    const candidate = type === "vendor" ? (row?.[1] || row?.[4] || row?.[3]) : row?.[2];
    return normalizeName(candidate) === target;
  }) : null;
  if (!match?.[0]) throw new Error("查無符合的會員資料，請直接輸入會員編號");
  return {
    memberType: type,
    memberNumber: clean(match[0], 80).toUpperCase(),
    rosterName: type === "vendor" ? clean(match?.[1] || match?.[4] || match?.[3], 120) : clean(match?.[2], 120),
    source: "tdea_roster",
  };
}
