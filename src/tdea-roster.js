const MEMBER_TYPES = new Set(["general", "association", "vendor"]);

const clean = (value, limit = 160) => String(value || "").trim().slice(0, limit);

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
  if (!response.ok || !payload?.success || !payload?.match?.memberNumber) {
    throw new Error(clean(payload?.message, 240) || "會員編號查詢失敗，請稍後再試");
  }
  return {
    memberType: type,
    memberNumber: clean(payload.match.memberNumber, 80).toUpperCase(),
    rosterName: clean(payload.match.rosterName, 120),
    source: clean(payload.match.source, 40),
  };
}