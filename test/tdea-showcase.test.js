import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const worker = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

test("TDEA 活動與廠商展示使用服務綁定並僅回傳展示欄位", () => {
  const helperStart = worker.indexOf("async function fetchTdeaShowcase");
  const helperEnd = worker.indexOf("function decodeYoutubeXml", helperStart);
  const helper = worker.slice(helperStart, helperEnd);
  assert.ok(helper.includes('env.TDEA_WORKER.fetch("https://tdea.internal/api/manager-data"'));
  assert.ok(helper.includes('env.TDEA_WORKER.fetch("https://tdea.internal/api/vendor-card-menu"'));
  assert.ok(helper.includes("boundedResponseText(managerResponse, TDEA_SHOWCASE_MAX_BYTES)"));
  assert.match(helper, /title:tdeaShowcaseText\(activity\?\.name/);
  assert.match(helper, /registrationUrl:tdeaShowcaseUrl/);
  assert.match(helper, /name:tdeaShowcaseText\(vendor\?\.label/);
  assert.ok(!helper.includes("association:"));
  assert.ok(!helper.includes("phone:"));

  const routeStart = worker.indexOf('url.pathname === "/v1/tdea-showcase"');
  const routeEnd = worker.indexOf('url.pathname === "/v1/courses"', routeStart);
  assert.ok(worker.slice(routeStart, routeEnd).includes("const member = await currentMember(request, env)"));
  assert.ok(app.includes('data-daily-panel="activities">活動報名'));
  assert.ok(app.includes('data-daily-panel="vendors">廠商輪播'));
  assert.ok(app.includes('api("/v1/tdea-showcase")'));
  assert.ok(app.includes('class="tdea-vendor-carousel"'));
});