import test from 'node:test';
import assert from 'node:assert/strict';
import { tokens, counts, idrAmount } from '../scripts/cord_metrics.mjs';
test('CORD evaluator distinguishes IDR grouping from decimal amounts', () => {
  for (const [raw, expected] of [['60.000',60000],['63,000.00',63000],['Rp 240.000',240000],['1.234.567,89',1234567.89],['365000.00',365000],['42,50',42.5],['42',42]]) assert.equal(idrAmount(raw),expected,raw);
  for (const raw of ['', 'TOTAL 42', '1,23,456', '12.34.56','70,00...']) assert.equal(idrAmount(raw),null,raw);
});
test('CORD token metric preserves multiplicity and normalizes punctuation/case', () => {
  assert.deepEqual(tokens('Rp 60.000 TOTAL total'),['RP','60','000','TOTAL','TOTAL']);
  assert.equal(counts(tokens('TOTAL total')).get('TOTAL'),2);
});
