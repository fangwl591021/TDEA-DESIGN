import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const worker = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

test("TDEA 活動與廣告贈點展示使用服務綁定並僅回傳展示欄位", () => {
  const helperStart = worker.indexOf("async function fetchTdeaShowcase");
  const helperEnd = worker.indexOf("function decodeYoutubeXml", helperStart);
  const helper = worker.slice(helperStart, helperEnd);
  assert.ok(helper.includes('env.TDEA_WORKER.fetch("https://tdea.internal/api/manager-data"'));
  assert.ok(helper.includes('env.TDEA_WORKER.fetch("https://tdea.internal/api/marquee"'));
  assert.ok(helper.includes("boundedResponseText(managerResponse, TDEA_SHOWCASE_MAX_BYTES)"));
  assert.match(helper, /title:tdeaShowcaseText\(activity\?\.name/);
  assert.match(helper, /registrationUrl:tdeaShowcaseUrl/);
  assert.match(helper, /imageItems/);
  assert.match(helper, /adLiffUrl:tdeaShowcaseUrl/);
  assert.ok(!helper.includes("vendor-card-menu"));
  assert.ok(!helper.includes("association:"));
  assert.ok(!helper.includes("phone:"));

  const routeStart = worker.indexOf('url.pathname === "/v1/tdea-showcase"');
  const routeEnd = worker.indexOf('url.pathname === "/v1/courses"', routeStart);
  assert.ok(worker.slice(routeStart, routeEnd).includes("const member = await currentMember(request, env)"));
  assert.ok(app.includes('data-daily-panel="activities">活動報名'));
  assert.ok(app.includes('data-daily-panel="ads">廣告贈點'));
  assert.ok(app.includes('api("/v1/tdea-showcase")'));
  assert.ok(app.includes('class="tdea-ad-carousel"'));
  assert.ok(app.includes("開啟廣告贈點"));
  assert.ok(!app.includes('class="tdea-vendor-carousel"'));
  assert.ok(app.includes('class="tdea-activity-carousel"'));
  const styles = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.match(styles, /\.tdea-activity-card\{[^}]*min\(48vw,220px\)[^}]*max-width:220px/);
  assert.ok(app.includes('aria-label="TDEA 活動報名"'));
  assert.ok(!app.includes("tdea-activity-copy"));
  assert.ok(app.includes("詳細說明"));
  assert.ok(app.includes("點我報名"));
});