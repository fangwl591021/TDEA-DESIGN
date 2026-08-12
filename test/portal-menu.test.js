import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

test("內頁功能列移除返回首頁，並將返回首頁放在共用 Banner", () => {
  const start = app.indexOf("const portalMenu");
  const end = app.indexOf("function openAiWear", start);
  const menu = app.slice(start, end);
  const actions = [...menu.matchAll(/data-home-action="([^"]+)"/g)].map((match) => match[1]);

  assert.deepEqual(actions, [
    "cardCollection",
    "daily",
    "smartMatch",
    "calendar",
  ]);
  assert.ok(!menu.includes('data-home-action="card"'));
  assert.ok(menu.includes('data-home-action="calendar"><span>個人行程</span></button></section>'));
  assert.ok(!menu.includes('data-home-action="zodiac"'));
  assert.ok(!menu.includes('data-home-action="tasks"'));

  const layoutStart = app.indexOf("function layout");
  const layoutEnd = app.indexOf("async function login", layoutStart);
  const layout = app.slice(layoutStart, layoutEnd);
  assert.ok(layout.includes('class="feature-header-actions"'));
  assert.ok(layout.includes('class="feature-header-action feature-home-action" data-home-action="home"'));
  assert.ok(layout.includes('<span>返回首頁</span>'));
  assert.ok(!layout.includes('data-home-action="cardCollection">名片收藏</button>'));
  assert.ok(layout.includes('daily:["TDEA 每日簽到"'));
  assert.equal((app.match(/data-home-action="home"/g) || []).length, 1);
  const styles = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.match(styles, /\.portal-menu-text\{grid-template-columns:repeat\(5/);
  assert.ok(!app.includes('class="back-card" data-home-action="home"'));
});
