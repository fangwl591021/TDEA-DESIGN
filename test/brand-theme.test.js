import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("public site uses the coffee-inspired A-kaffit rust theme", () => {
  const css = source("public/akaffit.css");
  const baseCss = source("public/styles.css");
  const html = source("public/index.html");
  const worker = source("src/index.js");
  const adminHtml = source("public/admin.html");
  const adminRouteHtml = source("public/admin/index.html");

  assert.match(css, /--ak-primary:#b95121/);
  assert.match(css, /--ak-deep:#713015/);
  assert.match(css, /--ak-accent:#d78358/);
  assert.match(css, /--ak-cream:#fff8f3/);
  assert.match(css, /--ak-soft:#f9e9df/);
  assert.match(css, /--ak-ink:#3d2920/);
  assert.match(css, /main#app:has\(\.ak-dashboard\)\{height:100svh;min-height:100svh;max-height:100svh;overflow:hidden/);
  assert.match(css, /\.ak-dashboard\{[^}]*grid-template-rows:auto auto minmax\(0,1fr\);[^}]*height:100svh;[^}]*overflow:hidden/);
  assert.match(css, /\.ak-home-content\{[^}]*display:flex;flex-direction:column;[^}]*min-height:0;[^}]*overflow:hidden/);
  assert.match(css, /\.ak-content-panel\{[^}]*flex:1 1 auto;[^}]*min-height:0/);
  assert.doesNotMatch(css, /#003f2d|#002d21|#24e56f|#004932|#003b2c/);
  assert.match(css, /\.ak-daily-panel \.daily-slide\{[^}]*min\(48vw,220px\)/);
  assert.match(css, /\.ak-daily-panel \.daily-media-frame\{[^}]*overflow:hidden/);
  assert.doesNotMatch(css, /\.ak-daily-panel \.daily-media-frame\{[^}]*max-height/);
  assert.doesNotMatch(css, /\.ak-daily-panel \.daily-media\{[^}]*object-fit/);
  assert.match(baseCss, /\.media-dialog\{[^}]*z-index:1000[^}]*safe-area-inset-top/);
  assert.match(baseCss, /\.media-dialog-close\{[^}]*right:8px;top:8px;width:44px;height:44px/);
  assert.match(html, /\/styles\.css\?v=20260731-69/);
  assert.match(html, /\/akaffit-20260801-41\.css/);
  assert.match(html, /\/app-20260803-123\.js\?v=20260812-134/);
  assert.match(worker, /\/index-20260803-123\.txt/);
  assert.match(adminHtml, /圖片請使用 2:3 直式，建議 800 × 1200 px/);
  assert.match(adminHtml, /2:3 等比預覽｜建議 800 × 1200 px/);
  assert.match(adminRouteHtml, /圖片請使用 2:3 直式，建議 800 × 1200 px/);
  assert.match(adminRouteHtml, /2:3 等比預覽｜建議 800 × 1200 px/);
});
