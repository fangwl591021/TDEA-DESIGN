const MEMBER_TYPES = new Set(["general", "association", "vendor"]);

const clean = (value, limit = 160) => String(value || "").trim().slice(0, limit);
const normalizedKey = (value) => clean(value).toUpperCase().replace(/[\s\-_.()（）]+/g, "");

export function normalizeMemberType(value) {
  const type = clean(value, 20).toLowerCase();
  if (!MEMBER_TYPES.has(type)) throw new Error("請選擇一般會員、協會會員或廠商會員");
  return type;
}

export async function verifyTdeaRosterMember(service, { memberType, memberNumber, fullName }) {
  const type = normalizeMemberType(memberType);
  const number = clean(memberNumber, 80).toUpperCase();
  const name = clean(fullName, 120);
  if (type === "general") return { memberType: type, memberNumber: "", rosterName: "" };
  if (!number) throw new Error("協會會員與廠商會員必須填寫會員編號");
  if (!service?.fetch) throw new Error("TDEA 會員名單核對服務尚未設定");

  const response = await service.fetch(new Request("https://tdea-roster.internal/api/manager-data", {
    headers: { accept: "application/json" },
  }));
  if (!response.ok) throw new Error("TDEA 會員名單暫時無法核對，請稍後再試");
  const payload = await response.json().catch(() => null);
  if (!Array.isArray(payload?.data?.[type])) throw new Error("TDEA 會員名單回應格式錯誤，請稍後再試");
  const rows = payload.data[type];
  const matched = rows.find((row) => normalizedKey(row?.memberNo || row?.rosterMemberNo) === normalizedKey(number));
  if (!matched) throw new Error("查無此會員編號，請確認會員類型與編號");
  if (clean(matched.qualification, 10).toUpperCase() !== "Y") throw new Error("此會員編號目前不是有效會員，請聯絡協會確認");

  const rosterNames = type === "association"
    ? [matched.name]
    : [matched.companyName, matched.owner, matched.contact];
  if (!rosterNames.some((value) => normalizedKey(value) && normalizedKey(value) === normalizedKey(name))) {
    throw new Error(type === "association" ? "會員編號與姓名不一致，請確認後再送出" : "會員編號與公司名稱／負責人／窗口不一致，請確認後再送出");
  }
  return {
    memberType: type,
    memberNumber: normalizedKey(matched.memberNo || matched.rosterMemberNo),
    rosterName: clean(rosterNames.find((value) => normalizedKey(value) === normalizedKey(name)), 120),
  };
}
