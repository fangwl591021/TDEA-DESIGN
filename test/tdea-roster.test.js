import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMemberType, verifyTdeaRosterMember } from "../src/tdea-roster.js";

const service = (match, status = 200, message = "") => {
  let request;
  return {
    get request() { return request; },
    fetch: async (input) => {
      request = input;
      return new Response(JSON.stringify(status < 400 ? { success: true, match } : { success: false, message }), {
        status,
        headers: { "content-type": "application/json" },
      });
    },
  };
};

test("registration accepts only the three supported member types", () => {
  assert.equal(normalizeMemberType("general"), "general");
  assert.equal(normalizeMemberType("association"), "association");
  assert.equal(normalizeMemberType("vendor"), "vendor");
  assert.throws(() => normalizeMemberType("admin"), /一般會員、協會會員或廠商會員/);
});

test("general members are verified against mother registration data", async () => {
  const lookup = service({ memberType: "general", memberNumber: "", rosterName: "王小明", source: "mother-register" });
  const result = await verifyTdeaRosterMember(lookup, "shared-secret", {
    memberType: "general",
    fullName: "王小明",
    phone: "0912345678",
    birthday: "591021",
  });
  assert.equal(result.source, "mother-register");
  assert.equal(result.rosterName, "王小明");
  assert.equal(lookup.request.headers.get("x-tdea-design-key"), "shared-secret");
  assert.deepEqual(await lookup.request.json(), {
    memberType: "general",
    memberNumber: "",
    fullName: "王小明",
    phone: "0912345678",
    birthday: "591021",
  });
});

test("association and vendor members use the CRM result returned by the mother worker", async () => {
  const association = service({ memberType: "association", memberNumber: "A1090001", rosterName: "王小明", source: "association-crm" });
  const vendor = service({ memberType: "vendor", memberNumber: "V0001", rosterName: "設計有限公司", source: "vendor-crm" });
  assert.deepEqual(await verifyTdeaRosterMember(association, "secret", {
    memberType: "association", memberNumber: "a1090001", fullName: "王小明",
  }), {
    memberType: "association", memberNumber: "A1090001", rosterName: "王小明", source: "association-crm",
  });
  assert.equal((await verifyTdeaRosterMember(vendor, "secret", {
    memberType: "vendor", memberNumber: "v0001", fullName: "設計有限公司",
  })).source, "vendor-crm");
});

test("lookup configuration and mother-worker errors fail closed", async () => {
  await assert.rejects(() => verifyTdeaRosterMember(null, "secret", {
    memberType: "general", fullName: "王小明",
  }), /核對服務尚未設定/);
  await assert.rejects(() => verifyTdeaRosterMember(service({}), "", {
    memberType: "general", fullName: "王小明",
  }), /核對密鑰尚未設定/);
  await assert.rejects(() => verifyTdeaRosterMember(service({}, 404, "母站註冊資料查無一致紀錄"), "secret", {
    memberType: "general", fullName: "王小明", phone: "0912345678", birthday: "591021",
  }), /母站註冊資料查無一致紀錄/);
  await assert.rejects(() => verifyTdeaRosterMember(service({}), "secret", {
    memberType: "association", memberNumber: "", fullName: "王小明",
  }), /必須填寫會員編號/);
});
