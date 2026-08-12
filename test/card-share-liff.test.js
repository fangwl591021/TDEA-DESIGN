import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { personalCardShareLiffHtml } from "../src/card-share-liff.js";

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const worker = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const wrangler = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");

test("personal cards use the dedicated LIFF share app without replacing member login", () => {
  assert.match(wrangler, /"LIFF_ID": "2005868456-3Ip8H1Bx"/);
  assert.match(wrangler, /"CARD_SHARE_LIFF_ID": "2005868456-3Ip8H1Bx"/);
  assert.match(worker, /cardShareLiffId: env\.CARD_SHARE_LIFF_ID \|\| env\.LIFF_ID \|\| ""/);
  assert.match(app, /state\.cardShareMode[\s\S]*state\.config\?\.cardShareLiffId \|\| state\.config\?\.liffId/);
  assert.match(app, /function cardSharePickerUrl\(cardId, card = null\)[\s\S]*state\.config\?\.cardShareLiffId \|\| state\.config\?\.liffId/);
  assert.match(app, /https:\/\/liff\.line\.me\/\$\{encodeURIComponent\(liffId\)\}\/r\/card-share/);
  assert.match(wrangler, /"\/r\/\*"/);
  assert.match(wrangler, /"\/", "\/api\/\*"/);
  assert.match(worker, /url\.pathname === "\/r\/card-share"[\s\S]*personalCardShareLiffHtml/);
  assert.match(worker, /url\.searchParams\.get\("liff\.state"\)[\s\S]*stateUrl\.pathname === "\/r\/card-share"[\s\S]*personalCardShareLiffHtml/);
  assert.match(app, /url\.searchParams\.set\("shareCardId", cardId\)[\s\S]*url\.searchParams\.set\("share", "1"\)[\s\S]*card\?\.shareInvite/);
  assert.match(app, /async function sharePersonalCard\(card\)[\s\S]*location\.assign\(cardSharePickerUrl\(card\.id, card\)\)/);
  assert.match(app, /function cardLineShareUrl\(cardId, card = null\)[\s\S]*https:\/\/line\.me\/R\/share\?text=/);
  assert.match(app, /!liff\.isApiAvailable\?\.\("shareTargetPicker"\)[\s\S]*lineShareFallbackUrl = cardLineShareUrl\(cardId, publicCardResult\.card\)/);
  assert.match(app, /not allowed\|not available\|shareTargetPicker[\s\S]*lineShareFallbackUrl = cardLineShareUrl\(cardId, publicCardResult\?\.card\)/);
  assert.match(app, /if \(lineShareFallbackUrl\)[\s\S]*location\.replace\(lineShareFallbackUrl\)[\s\S]*else if \(pickerFinished\)/);
});

test("compact card share LIFF opens the picker without member-session dependency", async () => {
  const response = personalCardShareLiffHtml({
    liffId: "2010925044-hPtKkoKO",
    origin: "https://akaffit-team.example",
    cardId: "card_demo",
  });
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /liff\.init\(\{liffId:LIFF_ID\}\)/);
  assert.match(html, /liff\.isApiAvailable\("shareTargetPicker"\)/);
  assert.match(html, /liff\.shareTargetPicker/);
  assert.match(html, /\/v1\/cards\/"\+encodeURIComponent\(CARD_ID\)\+"\/public/);
  assert.match(html, /名片分享失敗/);
  assert.match(html, /error&&error\.code/);
  assert.match(html, /new URL\(clean\(value,2048\),API_ORIGIN\)/);
  assert.match(html, /versionMeta=.*standard.*20:13.*full.*2:3.*square.*1:1/);
  assert.match(html, /seenActions\.has\(key\)/);
  assert.match(html, /改用 LINE 一般分享/);
  assert.doesNotMatch(html, /klinkweb_session|authorization:|Bearer/);
  const inlineScript = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)?.[1] || "";
  assert.doesNotThrow(() => new Function(inlineScript));

  const elements = new Map();
  const document = { querySelector(selector) { if (!elements.has(selector)) elements.set(selector, { textContent:"", hidden:true, href:"" }); return elements.get(selector); } };
  let sharedMessages = null;
  const liff = {
    init: async () => {}, isLoggedIn: () => true, isApiAvailable: () => true,
    shareTargetPicker: async (messages) => { sharedMessages = messages; return false; },
    isInClient: () => false,
  };
  const fetch = async () => ({ ok:true, json:async () => ({ card:{
    displayName:"Tony", coverUrl:"/card-default-cover.jpg", selectedVersion:"full", shareInvite:"akm-MB-00123567",
    buttons:[
      { label:"撥打電話", value:"tel:0927136847" },
      { label:"店家地址", value:"https://maps.example/store" },
      { label:"店家地址", value:"https://maps.example/store" },
    ],
  } }) });
  new Function("document", "location", "liff", "fetch", "setTimeout", inlineScript)(
    document, { href:"https://akaffit-team.example/r/card-share?shareCardId=card_demo" }, liff, fetch, () => {},
  );
  await new Promise((resolve) => setImmediate(resolve));
  const bubble = sharedMessages?.[0]?.contents;
  assert.equal(bubble?.hero?.url, "https://akaffit-team.example/card-default-cover.jpg");
  assert.equal(bubble?.size, "giga");
  assert.equal(bubble?.hero?.aspectRatio, "2:3");
  assert.equal(new URL(bubble?.hero?.action?.uri).searchParams.get("invite"), "akm-MB-00123567");
  assert.equal(new URL(bubble?.header?.contents?.[0]?.action?.uri).searchParams.get("invite"), "akm-MB-00123567");
  assert.deepEqual(bubble?.footer?.contents.map((item) => item.action.label), ["撥打電話", "店家地址"]);
});
