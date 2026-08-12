import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

const app = source("public/app.js");
const css = source("public/akaffit.css");
const homeStart = app.indexOf("async function home()");
const homeEnd = app.indexOf("async function legacyHome()", homeStart);
const home = app.slice(homeStart, homeEnd);

test("home uses a compact member summary, shared task toggle, and default daily check-in", () => {
  assert.match(home, /class="ak-wordmark">TDEA/);
  assert.match(home, /class="ak-task-notice\$\{taskAlert\}" data-home-task-toggle aria-expanded="false" aria-controls="homeTaskDetail"/);
  assert.equal((home.match(/data-home-task-toggle/g) || []).length, 2);
  assert.match(home, /class="ak-member-avatar" data-home-action="profile"[\s\S]*\$\{avatar\(\)\}/);
  assert.doesNotMatch(home, /homeGreeting|memberName|早安|午安|晚上好/);
  assert.match(home, /class="ak-point-card" data-home-action="wallet"/);
  assert.match(home, /class="ak-destiny-card" data-home-action="zodiacPopup"/);
  assert.match(home, /class="ak-qr-card" data-home-action="share"/);
  assert.match(home, /id="homeTaskDetail"[\s\S]*data-home-action="tasks">查看全部任務/);
  assert.match(home, /class="ak-frozen-nav"[\s\S]*class="ak-feature-grid"[\s\S]*id="homeDailyPanel" class="ak-daily-panel ak-content-panel"/);
  assert.doesNotMatch(home, /class="ak-bottom-nav"|class="ak-content-tabs"|data-content-view=|data-content-panel=/);
  assert.match(css, /\.ak-home-task-detail\{max-height:232px/);
  assert.match(css, /\.ak-home-task-list\{max-height:172px;[^}]*overflow-y:auto/);
  assert.match(css, /\.ak-frozen-nav \.ak-feature-grid\{[^}]*grid-template-columns:repeat\(5/);
  assert.match(css, /\.ak-frozen-nav \.ak-feature-grid button\{[^}]*min-height:62px/);
});

test("task notice handles zero, pending, overdue, and API failure without failing home", () => {
  const helperStart = app.indexOf("function homeTaskSummary");
  const helperEnd = app.indexOf("function homeTaskListMarkup", helperStart);
  const helperSource = app.slice(helperStart, helperEnd);
  const { homeTaskSummary } = Function(`${helperSource}; return { homeTaskSummary };`)();
  const future = new Date(Date.now() + 3600000).toISOString();
  const past = new Date(Date.now() - 3600000).toISOString();

  assert.equal(homeTaskSummary({ tasks:[] }).notice, "今日完成 ✓");
  assert.equal(homeTaskSummary({ tasks:[{ status:"pending", dueAt:future }] }).notice, "1 項待辦");
  assert.equal(homeTaskSummary({ tasks:[{ status:"postponed", dueAt:past }] }).notice, "1 項逾期");
  assert.equal(homeTaskSummary(null, true).notice, "查看待辦");
  assert.match(home, /Promise\.allSettled\(\[api\("\/v1\/points\/wallet"\), api\("\/v1\/tasks"\)\]\)/);
  assert.match(home, /String\(taskSummary\.active\.length\)/);
});

test("both task controls expand and collapse the same panel", () => {
  const helperStart = app.indexOf("function bindHomeTaskToggle");
  const helperEnd = app.indexOf("async function home()", helperStart);
  const helperSource = app.slice(helperStart, helperEnd);
  const classes = new Set();
  const panel = { classList:{ toggle:(name,on) => on ? classes.add(name) : classes.delete(name), contains:(name) => classes.has(name) } };
  const detail = { hidden:true };
  const callbacks = [];
  const toggles = [0, 1].map(() => ({
    expanded:"false",
    setAttribute(name, value) { if (name === "aria-expanded") this.expanded = value; },
    addEventListener(type, callback) { if (type === "click") callbacks.push(callback); },
  }));
  const document = {
    querySelector(selector) { return selector === "[data-home-task-panel]" ? panel : detail; },
    querySelectorAll() { return toggles; },
  };
  const bindHomeTaskToggle = Function("document", `${helperSource}; return bindHomeTaskToggle;`)(document);
  bindHomeTaskToggle();
  callbacks[0]();
  assert.equal(detail.hidden, false);
  assert.deepEqual(toggles.map((item) => item.expanded), ["true", "true"]);
  callbacks[1]();
  assert.equal(detail.hidden, true);
  assert.deepEqual(toggles.map((item) => item.expanded), ["false", "false"]);
});

test("exclusive share still opens as a closable QR dialog", () => {
  assert.match(app, /id="sharePanel" class="ak-share-dialog hidden" role="dialog" aria-modal="true"/);
  assert.match(app, /class="ak-share-close" data-close-share aria-label="關閉專屬分享">×/);
  assert.match(app, /function closeShareQr\(\)[\s\S]*classList\.add\("hidden"\)/);
  const shareQrSource = app.slice(
    app.indexOf("async function showShareQr()"),
    app.indexOf("async function copyInvite()"),
  );
  assert.doesNotMatch(shareQrSource, /scrollIntoView|site-home-frame/);
  assert.doesNotMatch(shareQrSource, /60000|60 秒|setTimeout/);
});

test("exclusive share opens the LINE target picker with a LINE share URL fallback", () => {
  const copyInviteSource = app.slice(
    app.indexOf("async function copyInvite()"),
    app.indexOf("async function showWalletQr("),
  );
  assert.doesNotMatch(copyInviteSource, /liff\.login|markLiffLoginPending/);
  assert.match(copyInviteSource, /canUseLinePicker/);
  assert.match(copyInviteSource, /liff\.shareTargetPicker/);
  assert.match(copyInviteSource, /https:\/\/line\.me\/R\/share\?text=/);
  assert.match(copyInviteSource, /window\.location\.assign\(lineShareUrl\)/);
});
