import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../public/point-operator-scan.js', import.meta.url), 'utf8');

test('TDEA wordmark click is captured before existing home handlers', () => {
  assert.match(source, /addEventListener\('click',[\s\S]*true\)/);
  assert.match(source, /\.ak-wordmark\{[^}]*pointer-events:auto/);
});
