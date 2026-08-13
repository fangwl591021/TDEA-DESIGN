import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AI_CARD_CRM_VERSION, normaliseAiCardCrm } from "../src/ai-card-crm.js";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("AI business-card CRM sanitizes public enrichment data", () => {
  const value = normaliseAiCardCrm({
    status:"ready",
    analysisVersion:AI_CARD_CRM_VERSION,
    company:{
      website:"https://example.com",
      googleMap:"javascript:alert(1)",
      facebook:"https://facebook.com/example",
      instagram:"",
      youtube:"",
      linkedin:"",
      description:"公司介紹",
      logoUrl:"data:image/svg+xml,bad",
      address:"台北市",
      phone:"02-1234-5678",
      email:"hello@example.com",
      taxId:"12345678",
    },
    firstTask:{title:"首次聯絡",description:"確認合作需求",dueInDays:3},
  });
  assert.equal(value.company.website, "https://example.com/");
  assert.equal(value.company.googleMap, "");
  assert.equal(value.company.logoUrl, "");
  assert.equal(value.company.taxId, "12345678");
  assert.equal(value.firstTask.dueInDays, 3);
});

test("old scanned cards are queued without changing card rewards", () => {
  const crm = source("src/ai-card-crm.js");
  const worker = source("src/index.js");
  const calendar = source("src/personal-calendar.js");
  assert.match(crm, /COALESCE\(cc\.source_event_id,''\)!=''/);
  assert.match(crm, /queueSystemAiCardCrmBackfill/);
  assert.match(worker, /ctx\.waitUntil\(runSystemAiCardCrmBackfill\(env\)\)/);
  assert.match(worker, /queueMemberAiCardCrmBackfill/);
  assert.match(calendar, /\[AI智慧名片CRM\]/);
  assert.doesNotMatch(crm, /awardPoints|card_collection_reward/);
});
