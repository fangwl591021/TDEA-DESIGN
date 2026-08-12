import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("member binding source is persisted and returned to the frontend", () => {
  const migration = read("migrations/0046_member_binding_source.sql");
  const repository = read("src/member-repository.js");
  const worker = read("src/index.js");
  assert.match(migration, /ADD COLUMN roster_source/);
  assert.match(repository, /rosterSource: row.roster_source/);
  assert.ok(repository.includes("roster_verified_at = CURRENT_TIMESTAMP, roster_source = ?"));
  assert.match(worker, /TDEA_DESIGN_LOOKUP_SECRET/);
  assert.match(worker, /admin.member.roster_verified/);
});

test("admin CRM shows member type, binding source and re-verification", () => {
  const admin = read("public/admin.js");
  const html = read("public/admin.html");
  assert.match(html, /id="memberTypeFilter"/);
  assert.match(html, /id="memberBindingFilter"/);
  assert.ok(html.includes("<th>資料綁定</th>"));
  assert.match(admin, /"mother-register":"母站註冊資料"/);
  assert.match(admin, /"association-crm":"會員 CRM"/);
  assert.match(admin, /"vendor-crm":"廠商 CRM"/);
  assert.match(admin, /id="reverifyMemberBinding"/);
  assert.ok(admin.includes("/verify-roster"));
});

test("admin re-verification writes a fresh verified timestamp and authoritative binding source", () => {
  const worker = read("src/index.js");
  assert.match(worker, /\/v1\/admin\/members\/\(\[\^\/\]\+\)\/verify-roster/);
  assert.ok(worker.includes("roster_verified_at = CURRENT_TIMESTAMP, roster_source = ?, updated_at = CURRENT_TIMESTAMP"));
  assert.ok(worker.includes(".bind(verified.memberNumber, verified.rosterName, verified.source, memberId)"));
  assert.ok(worker.includes("'admin.member.roster_verified'"));
  assert.ok(worker.includes("return badRequest(error.message || \"會員名冊核對失敗\")"));
});
