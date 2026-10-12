import test from 'node:test';
import assert from 'node:assert/strict';
import { planFunding } from '../public/budget.js';
test('itemized quotes, reserve and confirmed offsets yield a cent-exact shortfall', () => {
  const plan = planFunding({ items: [{ label: 'Meals', quantity: 37, unitCost: '12.35' }, { label: 'Delivery', unitCost: '19.99' }], contingency: 5, available: '100.10' });
  assert.equal(plan.baseCents, 47694);
  assert.equal(plan.reserveCents, 2385);
  assert.equal(plan.requestCents, 40069);
});
test('no unnecessary request when existing funding covers costs', () => {
  assert.equal(planFunding({ items: [{ label: 'Supplies', quantity: 3, unitCost: .1 }], available: 1 }).requestCents, 0);
});
test('invalid quantities, amounts and reserves are rejected', () => {
  for (const quantity of [-1, 1.5, Infinity]) assert.throws(() => planFunding({ items: [{ quantity, unitCost: 1 }] }));
  for (const unitCost of [-1, 'bad', Infinity]) assert.throws(() => planFunding({ items: [{ unitCost }] }));
  assert.throws(() => planFunding({ items: [], contingency: 101 }));
});
