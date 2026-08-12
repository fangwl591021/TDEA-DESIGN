import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("home defaults to the requested TDEA Facebook Page Plugin", () => {
  const app = source("public/app.js");
  const css = source("public/akaffit.css");
  assert.match(app, /aria-selected="true" class="active" data-content-view="facebook"><svg[\s\S]*?<span>Facebook<\/span>/);
  assert.match(app, /class="ak-facebook-panel ak-content-panel" data-content-panel="facebook" aria-label="TDEA Facebook 粉絲專頁"/);
  assert.match(app, /facebook\.com\/plugins\/page\.php\?href=/);
  assert.match(app, /href=https%3A%2F%2Fwww\.facebook\.com%2FTDEA2020/);
  assert.match(app, /class="ak-official-import ak-content-panel hidden"/);
  assert.doesNotMatch(app, /ak-facebook-fallback/);
  assert.match(css, /\.ak-facebook-panel,\.ak-instagram-panel\{[^}]*padding:0/);
  assert.match(css, /\.ak-facebook-frame,\.ak-instagram-frame\{[^}]*width:100%[^}]*max-width:none/);
  assert.match(css, /\.ak-facebook-frame\{height:100%/);
});
