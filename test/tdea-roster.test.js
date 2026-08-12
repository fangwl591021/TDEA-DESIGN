import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMemberType, verifyTdeaRosterMember } from "../src/tdea-roster.js";

const service = (data, status = 200) => ({
  fetch: async () => new Response(JSON.stringify({ data }), { status, headers: { "content-type": "application/json" } }),
});

test("registration accepts only the three supported member types", () => {
  assert.equal(normalizeMemberType("general"), "general");
  assert.equal(normalizeMemberType("association"), "association");
  assert.equal(normalizeMemberType("vendor"), "vendor");
  assert.throws(() => normalizeMemberType("admin"), /一般會員、協會會員或廠商會員/);
});

test("general members do not require a roster number", async () => {
  assert.deepEqual(await verifyTdeaRosterMember(null, { memberType: "general" }), {
    memberType: "general", memberNumber: "", rosterName: "",
  });
});

test("association and vendor members are verified against their own active roster", async () => {
  const roster = service({
    association: [{ memberNo: "A1090001", name: "王小明", qualification: "Y" }],
    vendor: [{ rosterMemberNo: "V0001", companyName: "設計有限公司", qualification: "Y" }],
  });
  assert.equal((await verifyTdeaRosterMember(roster, { memberType: "association", memberNumber: "a1090001", fullName: "王小明" })).memberNumber, "A1090001");
  assert.equal((await verifyTdeaRosterMember(roster, { memberType: "vendor", memberNumber: "v-0001", fullName: "設計有限公司" })).memberType, "vendor");
  await assert.rejects(() => verifyTdeaRosterMember(roster, { memberType: "vendor", memberNumber: "A1090001", fullName: "王小明" }), /查無此會員編號/);
});

test("roster verification rejects missing numbers, inactive rows and mismatched names", async () => {
  const roster = service({ association: [{ memberNo: "A1090001", name: "王小明", qualification: "N" }], vendor: [] });
  await assert.rejects(() => verifyTdeaRosterMember(roster, { memberType: "association", memberNumber: "", fullName: "王小明" }), /必須填寫會員編號/);
  await assert.rejects(() => verifyTdeaRosterMember(roster, { memberType: "association", memberNumber: "A1090001", fullName: "王小明" }), /不是有效會員/);
  const active = service({ association: [{ memberNo: "A1090001", name: "王小明", qualification: "Y" }], vendor: [] });
  await assert.rejects(() => verifyTdeaRosterMember(active, { memberType: "association", memberNumber: "A1090001", fullName: "陳小華" }), /姓名不一致/);
});
