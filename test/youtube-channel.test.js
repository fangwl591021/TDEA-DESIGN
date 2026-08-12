import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("YouTube service remains available without a home content tab", () => {
  const worker = source("src/index.js");
  const app = source("public/app.js");
  const home = app.slice(app.indexOf("async function home()"), app.indexOf("async function legacyHome()"));
  assert.match(worker, /UCQWEa3bZ4hIPD7ZuTAFw4wQ/);
  assert.match(worker, /youtube\.com\/feeds\/videos\.xml\?channel_id=/);
  assert.match(worker, /boundedResponseText\(upstream\)/);
  assert.match(worker, /i\.ytimg\.com\/vi\/\$\{videoId\}\/hqdefault\.jpg/);
  assert.match(worker, /url\.pathname === "\/v1\/youtube\/videos"/);
  assert.match(app, /class="ak-youtube-card" data-youtube-index=/);
  assert.match(app, /function showYoutubePlayer\(video = \{\}\)/);
  assert.match(app, /youtube-nocookie\.com\/embed\/\$\{encodeURIComponent\(videoId\)\}/);
  assert.match(app, /class="ak-youtube-player-close" data-close-youtube/);
  assert.match(app, /if \(event\.key === "Escape"\) closeYoutubePlayer\(\)/);
  assert.doesNotMatch(app, /class="ak-youtube-card" href=/);
  assert.doesNotMatch(home, /data-content-view="youtube"|ak-youtube-panel/);
});