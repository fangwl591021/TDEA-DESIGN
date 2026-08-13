import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const worker = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");

test("TDEA admin whitelist is checked server-side without creating an upload", () => {
  const start = worker.indexOf("async function mergedAdminAccess(env, member)");
  const end = worker.indexOf("async function currentAdmin", start);
  assert.ok(start >= 0 && end > start);
  const helper = worker.slice(start, end);
  assert.match(helper, /https:\/\/tdea\.internal\/api\/uploads/);
  assert.match(helper, /"x-admin-email": email/);
  assert.match(helper, /const form = new FormData\(\)/);
  assert.match(helper, /response\.status !== 400/);
  assert.match(helper, /role: "tdea_whitelist"/);
  assert.match(helper, /catch \{\s*return localAccess;/);
});