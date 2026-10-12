// All totals are computed in cents. AI never supplies financial amounts.
const cents = value => {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0 || number > 100000000) throw new Error('Enter a valid non-negative amount.');
  return Math.round((number + Number.EPSILON) * 100);
};
export function planFunding({ items, contingency = 0, available = 0 }) {
  const lines = items.map(({ label, quantity = 1, unitCost }) => {
    if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > 100000) throw new Error('Enter a whole-number quantity.');
    const unitCents = cents(unitCost);
    return { label, quantity, unitCents, totalCents: quantity * unitCents };
  });
  const baseCents = lines.reduce((sum, line) => sum + line.totalCents, 0);
  if (!Number.isSafeInteger(baseCents)) throw new Error("Total exceeds the supported budget size.");
  const percent = Number(contingency);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw new Error('Contingency must be between 0 and 100%.');
  const reserveCents = Math.round(baseCents * percent / 100);
  const totalCents = baseCents + reserveCents;
  if (!Number.isSafeInteger(totalCents)) throw new Error("Total exceeds the supported budget size.");
  const availableCents = cents(available);
  return { lines, baseCents, reserveCents, totalCents, availableCents, requestCents: Math.max(0, totalCents - availableCents) };
}
