import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("home no longer renders the retired Facebook content panel", () => {
  const app = source("public/app.js");
  const home = app.slice(app.indexOf("async function home()"), app.indexOf("async function legacyHome()"));
  assert.doesNotMatch(home, /Facebook|facebook\.com\/plugins\/page\.php|ak-facebook-panel|data-content-view="facebook"/);
});