import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { normalizeBirthday, normalizeTaiwanMobile } from "../src/member-repository.js";

test("birthday verification accepts ROC birthday passwords and keeps Gregorian compatibility", () => {
  assert.equal(normalizeBirthday("591021"), "1970-10-21");
  assert.equal(normalizeBirthday("390305"), "1950-03-05");
  assert.equal(normalizeBirthday("1120102"), "2023-01-02");
  assert.equal(normalizeBirthday("19901021"), "1990-10-21");
  assert.equal(normalizeBirthday("1990-10-21"), "1990-10-21");
  assert.throws(() => normalizeBirthday("000101"), /民國年月日/);
  assert.throws(() => normalizeBirthday("20260230"), /日期無效/);
});

test("member registration requires and normalizes a Taiwan mobile number", () => {
  assert.equal(normalizeTaiwanMobile("0912-345-678"), "0912345678");
  assert.equal(normalizeTaiwanMobile("+886 912 345 678"), "0912345678");
  assert.throws(() => normalizeTaiwanMobile("02-12345678"), /正確的台灣行動電話/);
  assert.throws(() => normalizeTaiwanMobile(""), /正確的台灣行動電話/);
});

test("member registration UI includes logo, name, numeric birthday, and repeatable social links", () => {
  const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(app, /id="memberLogoFile"/);
  assert.match(app, /id="displayName"/);
  assert.match(app, /id="fullName"/);
  assert.match(app, /id="phone" type="tel"[^>]*required/);
  assert.match(app, /請輸入正確的台灣行動電話/);
  assert.match(app, /phone,/);
  assert.match(app, /id="memberType" required/);
  assert.match(app, />一般會員</);
  assert.match(app, />協會會員</);
  assert.match(app, />廠商會員</);
  assert.match(app, /id="rosterMemberNumber"/);
  assert.match(app, /id="lookupRosterMemberNumber"/);
  assert.match(app, /function openRosterMemberNumberLookup/);
  assert.match(app, /\/v1\/roster\/member-number-lookup/);
  assert.match(app, /id="copyRosterMemberNumber">複製編號/);
  assert.match(app, /TDEA 正式名冊核對/);
  assert.match(app, /會員名冊綁定完成/);
  assert.match(app, /母站註冊資料綁定完成/);
  assert.match(app, /state\.member\.rosterVerifiedAt/);
  assert.match(app, /id="birthday" type="text" inputmode="numeric"/);
  assert.match(app, /生日密碼（民國年月日）/);
  assert.match(app, /591021、390305/);
  assert.match(app, /id="addSocialLink"/);
  assert.match(app, /socialLinks/);
  assert.match(app, /請補齊基本資料，完成後即可使用會員中心。/);
  assert.doesNotMatch(app, /驗證手機/);
  assert.doesNotMatch(app, /手機與生日是登入驗證資料/);
  assert.doesNotMatch(app, /class="ak-brandmark"/);
  const css = fs.readFileSync(new URL("../public/akaffit.css", import.meta.url), "utf8");
  assert.match(css, /\.member-logo-preview\{[^}]*border-radius:50%[^}]*background:var\(--ak-soft\)[^}]*color:var\(--ak-primary\)/);
  assert.doesNotMatch(css, /\.member-logo-preview\{[^}]*border-radius:24px/);
});

test("member registration opens as an accessible popup while required registration stays blocking", () => {
  const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("../public/akaffit.css", import.meta.url), "utf8");
  assert.match(app, /async function showProfileDialog\(required = false/);
  assert.match(app, /class="ak-profile-sheet" role="dialog" aria-modal="true"/);
  assert.match(app, /required \? "" : `<button type="button" class="ak-profile-close"/);
  assert.match(app, /if\(action==="profile"\)return showProfileDialog\(false\)/);
  assert.match(css, /\.ak-profile-dialog\{[^}]*position:fixed[^}]*inset:0/);
  assert.match(css, /\.ak-profile-sheet\{[^}]*max-height:90svh[^}]*overflow:auto/);
});
test("five-tag UI supports explicit retry and automatic refresh", () => {
  const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(app, /recalculate-insights/);
  assert.match(app, /data-retry-insights/);
  assert.match(app, /Five-tag refresh unavailable/);
});
