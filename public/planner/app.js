import { planFunding } from '../budget.js';
const $ = s => document.querySelector(s);
const form = $('#planner');
const field = name => form.elements[name];
const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const el = (tag, text = '') => { const n = document.createElement(tag); n.textContent = text; return n; };
let report = '', current;
function addLine(label = '', quantity = 1) {
  const row = el('tr');
  const specs = [ ['label', 'text', label], ['quantity', 'number', quantity], ['unitCost', 'number', ''], ['basis', 'select', 'estimate'], ['evidence', 'text', ''], ['payment', 'select', 'purchase'], ['due', 'date', ''] ];
  for (const [key, type, value] of specs) {
    const cell = el('td'); const input = document.createElement(type === 'select' ? 'select' : 'input');
    input.dataset.key = key; input.setAttribute('aria-label', key + ' for ' + (label || 'expense'));
    if (type === 'select') {
      const options = key === 'basis' ? { estimate: 'Estimate', quote: 'Quote confirmed', paid: 'Actual paid', free: 'Confirmed free' } : { purchase: 'Org purchase', contract: 'Contract / guest', reimbursement: 'Personal reimbursement', review: 'Ask staff' };
      for (const [v, text] of Object.entries(options)) { const option = el('option', text); option.value = v; input.append(option); }
    } else {
      input.type = type;
      if (type === 'number') { input.min = key === 'quantity' ? '1' : '0'; input.max = key === 'quantity' ? '100000' : '100000000'; input.step = key === 'quantity' ? '1' : '0.01'; }
      if (type === 'text') input.maxLength = key === 'evidence' ? 300 : 120;
    }
    input.value = value; cell.append(input); row.append(cell);
  }
  const cell = el('td'), remove = el('button', 'Remove'); remove.type = 'button'; remove.className = 'copy-button'; remove.addEventListener('click', () => { row.remove(); update(); }); cell.append(remove); row.append(cell); $('#lines').append(row);
}
function lines() { return [...$('#lines').rows].map(row => Object.fromEntries([...row.querySelectorAll('[data-key]')].map(input => [input.dataset.key, input.value]))); }
function calculate(rows) { return planFunding({ items: rows.map(row => ({ label: row.label || 'Unnamed expense', quantity: Number(row.quantity), unitCost: row.unitCost || 0 })), contingency: field('route').value === 'paid' ? 0 : field('contingency').value, available: field('available').value }); }
function gaps(rows) {
  const list = [];
  if (!field('date').value) list.push('When is the activity? Add its date so you can work backward from payment deadlines.');
  if (field('venueStatus').value === 'unknown') list.push('Is the room confirmed, and is it free or paid?');
  if (field('venueStatus').value === 'paid' && !rows.some(r => /venue|room/i.test(r.label))) list.push('Add the venue charge to your itemized costs.');
  if (field('food').value !== 'none') {
    if (!field('dietary').value.trim()) list.push('What service style, dietary needs, and delivery arrangement do you need?');
    if (!rows.some(r => /food|meal|cater|snack/i.test(r.label))) list.push('Add food and confirm all delivery, service, tip and tax charges.');
  }
  if (!field('logistics').value.trim()) list.push('Do you need equipment, a guest, transport or accommodation? Record none if not needed.');
  if (Number(field('available').value) > 0 && !field('fundingEvidence').value.trim()) list.push('Where does the confirmed funding come from, and when was its balance checked?');
  if (!rows.length) list.push('Add at least one expense.');
  const missing = rows.filter(r => r.unitCost === '').length;
  if (missing) list.push(missing + ' expense(s) still need a price. Blank prices are excluded from the subtotal, not treated as free.');
  if (rows.some(r => !r.evidence.trim() || r.basis === 'estimate')) list.push('Confirm estimates and add a quote/source reference for every item, including free items.');
  if (rows.some(r => !r.due)) list.push('Add a due date to each item for the payment timeline.');
  return list;
}
function routeText() {
  return {
    funding: 'Funding request: apply for the documented activity shortfall. Include itemized costs, quote references, student benefit and confirmed other funding. Confirm eligibility and deadlines with staff.',
    purchase: 'Purchase preparation: check the current eligible account balance and your proposed funding split with staff. Prepare vendor quotes, purchasing channel and relevant event materials. Existing funding does not authorize an order. Contracts and guest payments need staff coordination.',
    paid: 'Reimbursement preparation: use actual paid amounts, not a planning estimate or contingency. Retain itemized paid receipts, purchase dates and payment evidence; food may need an event flyer or attendee list. Ask staff about current limits, deadlines, submitter requirements and travel/hotel handling. This planner does not verify receipts or decide reimbursement eligibility.'
  }[field('route').value];
}
function update() {
  report = ''; $('#handoff').textContent = ''; $('#copy').hidden = $('#download').hidden = true; $('#handoff-status').textContent = '';
  const rows = lines(); $('#food-needs').hidden = field('food').value === 'none';
  let plan;
  try { plan = calculate(rows); } catch (error) { current = null; $('#summary').textContent = error.message; return; }
  current = { rows, plan };
  const missing = rows.some(r => r.unitCost === '');
  $('#summary').replaceChildren(el('p', (missing ? 'Entered-cost subtotal (incomplete): ' : 'Base costs: ') + money(plan.baseCents)), el('p', 'Separate contingency: ' + money(plan.reserveCents)), el('p', 'Confirmed other funding: ' + money(plan.availableCents)), el('strong', (field('route').value === 'paid' ? 'Entered paid total: ' + money(plan.baseCents) : 'Provisional funding shortfall: ' + money(plan.requestCents))));
  $('#gaps').replaceChildren(...gaps(rows).map(text => el('li', text)));
  $('#route-help').textContent = routeText();
  const dates = new Map();
  plan.lines.forEach((line, i) => { const date = rows[i].due || 'Date needed'; dates.set(date, (dates.get(date) || 0) + line.totalCents); });
  $('#timeline').replaceChildren(el('h3', 'Payment timing'), ...[...dates].sort(([a], [b]) => a.localeCompare(b)).map(([date, total]) => el('p', date + ': ' + money(total))), el('p', 'Timing describes payment needs, not separate funding applications. Contingency is unallocated. Confirm whether staged funding is allowed.'));
  $('#scenarios').replaceChildren();
  const foodIndex = rows.findIndex(r => /food|meal|cater|snack/i.test(r.label));
  for (const [name, price] of [['Current plan', null], ['Simple meal', field('simple').value], ['Refreshments', field('refreshments').value]]) {
    const card = el('div'); card.className = 'scenario'; card.append(el('h3', name));
    if (price !== null && (price === '' || foodIndex < 0 || field('food').value === 'none')) card.append(el('p', 'Add a food line and an alternative quote to compare.'));
    else {
      const alternative = rows.map(r => ({ ...r }));
      if (price !== null) alternative[foodIndex] = { ...alternative[foodIndex], unitCost: price, quantity: field('attendance').value };
      try { const scenario = calculate(alternative); card.append(el('strong', money(scenario.totalCents)), el('p', 'Funding gap: ' + money(scenario.requestCents)), el('p', (missing ? 'Incomplete; ' : '') + (price === null ? 'Uses current entered costs.' : 'Difference: ' + money(scenario.totalCents - plan.totalCents) + '. Verify quote scope and changed fees.'))); } catch { card.append(el('p', 'Enter valid prices to compare.')); }
    }
    $('#scenarios').append(card);
  }
}
$('#suggest').addEventListener('click', () => {
  const text = field('description').value + ' ' + field('logistics').value;
  const existing = lines();
  const suggestions = [];
  if (field('food').value !== 'none' && !existing.some(r => /food|meal|cater|snack/i.test(r.label))) suggestions.push(['Food', Number(field('attendance').value)]);
  if (/speaker|performer|guest|honorarium|panel/i.test(text)) suggestions.push(['Guest / performer', 1]);
  if (/travel|transport|bus|taxi|trip/i.test(text)) suggestions.push(['Transport', 1]);
  if (/hotel|accommodation|overnight/i.test(text)) suggestions.push(['Accommodation', 1]);
  if (/sound|microphone|projector|equipment|music|screen/i.test(text)) suggestions.push(['A/V equipment', 1]);
  if (/poster|flyer|advertis|marketing|print/i.test(text)) suggestions.push(['Marketing / printing', 1]);
  for (const [label, quantity] of suggestions) if (!existing.some(r => r.label === label)) addLine(label, quantity);
  update();
});
$('#add').addEventListener('click', () => { addLine(); update(); });
form.addEventListener('input', update); form.addEventListener('change', update);
form.addEventListener('submit', event => {
  event.preventDefault(); update(); if (!current) return;
  const { rows, plan } = current;
  const confirmed = field('confirmed').checked && rows.length > 0 && rows.every(r => r.unitCost !== '' && r.label.trim() && r.evidence.trim() && r.basis !== 'estimate' && (r.basis !== 'free' || Number(r.unitCost) === 0)) && (Number(field('available').value) === 0 || field('fundingEvidence').value.trim());
  const paid = field('route').value === 'paid';
  const verifiedPaid = paid && rows.every(r => r.basis === 'paid' || r.basis === 'free');
  const status = confirmed && (!paid || verifiedPaid) ? 'Costs confirmed by planner; staff review still required' : 'PROVISIONAL — missing prices/evidence or unconfirmed costs; not ready to submit';
  const amount = paid ? 'Actual entered paid total: ' + money(plan.baseCents) + '\nEligible reimbursement amount: staff verification required' : 'Net funding needed: ' + money(plan.requestCents);
  report = 'ACTIVITY BUDGET HANDOFF\n' + status + '\n\n' + field('title').value + '\nOrganization: ' + (field('organization').value || 'Not entered') + '\nDate: ' + (field('date').value || 'Not confirmed') + '\nAttendance: ' + field('attendance').value + '\nVenue: ' + (field('venue').value || 'Not entered') + '\n\nActivity: ' + field('description').value + '\nStudent benefit: ' + (field('purpose').value || 'Needed') + '\nPlanning notes: ' + $('#answers').value + '\nLogistics: ' + field('logistics').value + '\nFood needs: ' + (field('food').value === 'none' ? 'No food' : field('dietary').value) + '\n\nITEMIZED COSTS\n' + plan.lines.map((line, i) => line.label + ': ' + (rows[i].unitCost === '' ? 'PRICE NEEDED' : line.quantity + ' × ' + money(line.unitCents) + ' = ' + money(line.totalCents)) + '\nBasis: ' + rows[i].basis + '; source: ' + (rows[i].evidence || 'Needed') + '; payment: ' + rows[i].payment + '; due: ' + (rows[i].due || 'Needed')).join('\n') + '\n\nBase costs: ' + money(plan.baseCents) + '\nSeparate contingency: ' + money(plan.reserveCents) + '\nTotal: ' + money(plan.totalCents) + '\nConfirmed other funding: ' + money(plan.availableCents) + '\nFunding evidence: ' + (field('fundingEvidence').value || 'Not entered') + '\n' + amount + '\n\nNEXT STEP\n' + routeText() + '\n\nTO CONFIRM\n' + (gaps(rows).join('\n') || 'Confirm current policy and submission process with staff.') + '\nDo not split requests to bypass limits. Approval is not guaranteed.';
  $('#handoff').textContent = report; $('#handoff-status').textContent = status; $('#copy').hidden = $('#download').hidden = false;
});
$('#copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(report); $('#handoff-status').textContent = 'Copied'; } catch { $('#handoff-status').textContent = 'Select the handoff text to copy.'; } });
$('#download').addEventListener('click', () => {
  if (!current || !report) return;
  const safe = value => { let s = String(value ?? ''); if (/^[=+@\-\t\r\n]/.test(s)) s = "'" + s; return '"' + s.replaceAll('"', '""') + '"'; };
  const { rows, plan } = current;
  const csv = [['Expense','Quantity','Unit cost USD','Total USD','Basis','Evidence','Payment','Due'], ...rows.map((r, i) => [r.label,r.quantity,r.unitCost,r.unitCost === '' ? '' : (plan.lines[i].totalCents / 100).toFixed(2),r.basis,r.evidence,r.payment,r.due]), ['Base costs','','',(plan.baseCents/100).toFixed(2)], ['Contingency','','',(plan.reserveCents/100).toFixed(2)], ['Total','','',(plan.totalCents/100).toFixed(2)], ['Other funding','','',(plan.availableCents/100).toFixed(2)], [field('route').value === 'paid' ? 'Eligible reimbursement requires staff verification' : 'Provisional funding shortfall','','',field('route').value === 'paid' ? '' : (plan.requestCents/100).toFixed(2)]];
  const url = URL.createObjectURL(new Blob([csv.map(row => row.map(safe).join(',')).join('\r\n')], {type:'text/csv;charset=utf-8'})); const link = el('a'); link.href=url; link.download='activity-budget.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('#ai').addEventListener('click', async () => {
  if (!field('description').value.trim() || !field('description').checkValidity()) { field('description').reportValidity(); return; }
  $('#ai').disabled = true; $('#ai-status').textContent = 'Checking free AI availability…'; $('#ai-questions').replaceChildren();
  try {
    const response = await fetch('/api/planning', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({description:field('description').value}), signal:AbortSignal.timeout(20000) });
    const data = await response.json();
    if (response.ok && data.mode === 'ai') { $('#ai-questions').replaceChildren(...data.questions.map(q => el('li',q))); $('#ai-status').textContent = 'Optional AI questions — use the notes box to answer. Costs still need quotes.'; }
    else $('#ai-status').textContent = 'Free AI is unavailable. The questions and budget tools below still work; no paid fallback is used.';
  } catch { $('#ai-status').textContent = 'Free AI is unavailable. Continue with the planning checklist below.'; }
  finally { $('#ai').disabled = false; }
});
addLine('Food', 40); addLine('Delivery / service / tip / tax'); addLine('Supplies', 40); addLine('Venue'); update();
