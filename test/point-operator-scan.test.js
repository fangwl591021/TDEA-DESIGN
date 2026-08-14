import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractWalletToken, pointOperatorCapabilities } from '../src/point-operator.js';

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('wallet scanner accepts only 48-hex dynamic wallet tokens', () => {
  const token = 'a'.repeat(48);
  assert.equal(extractWalletToken(token), token);
  assert.equal(extractWalletToken(`https://tdea-design.fangwl591021.workers.dev/w/${token}`), token);
  assert.equal(extractWalletToken('https://tdea-design.fangwl591021.workers.dev/i/e/share-token'), '');
});

test('point scanner follows the existing admin login authorization', () => {
  assert.deepEqual(pointOperatorCapabilities({ canAccessAdmin:true }), {
    canScanPoints:true, canCreditPoints:true, canDebitPoints:true,
  });
  assert.deepEqual(pointOperatorCapabilities({ canAccessAdmin:false }), {
    canScanPoints:false, canCreditPoints:false, canDebitPoints:false,
  });
});

test('point scanner is LIFF scanCodeV2 based and the member avatar is the entry', () => {
  const ui = source('public/point-operator-scan.js');
  const html = source('public/index-20260803-123.txt');
  assert.match(ui, /\.ak-member-avatar/);
  assert.match(ui, /scanCodeV2/);
  assert.match(ui, /\/v1\/point-operator\/access/);
  assert.match(ui, /\/v1\/point-operator\/preview/);
  assert.match(ui, /\/v1\/point-operator\/adjust/);
  assert.match(html, /point-operator-scan\.js/);
});

test('point operation consumes wallet token after successful adjustment', () => {
  const backend = source('src/point-operator.js');
  assert.match(backend, /SET status='revoked'/);
  assert.match(backend, /requestId: `wallet:\$\{row\.wallet_token_id\}`/);
  assert.match(backend, /purpose = 'member_identification'/);
});
