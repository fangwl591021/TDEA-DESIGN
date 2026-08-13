import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=(path)=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('first-pass card OCR writes before web reverification',()=>{
  const card=source('src/card-collection.js');
  const start=card.indexOf('async function recognizeWithOpenAI(apiKey, model, images) {');
  const end=card.indexOf('// Keep web verification out of the initial OCR fast path.',start);
  assert.ok(start>=0 && end>start);
  const recognize=card.slice(start,end);
  assert.match(recognize,/name:'business_card'/);
  assert.doesNotMatch(recognize,/tools:\[\{type:'web_search'\}\]/);
  assert.doesNotMatch(recognize,/name:'verified_business_card'/);
  assert.match(card,/async function recognizeVerifiedWithOpenAI/);
  assert.match(card,/export async function reverifyContactFromSource/);
});

test('AI CRM does not run on placeholder or unfinished OCR imports',()=>{
  const crm=source('src/ai-card-crm.js');
  assert.match(crm,/card_import_events/);
  assert.match(crm,/cie\.status IN \('created','updated'\)/);
  assert.match(crm,/display_name NOT IN \('名片 AI 分析中','名片辨識未完成','名片分析未完成'\)/);
});
