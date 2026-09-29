import test from 'node:test';
import assert from 'node:assert/strict';
import * as PDFLib from 'pdf-lib';
import {
  moneyToCents, signedMoneyToCents, isoDate, monthBounds, suggestRequest, suggestReceipt,
  evaluateReimbursement, buildConcurPlan,
} from '../public/reimbursement/core.js';
import { buildCombinedPdf } from '../public/reimbursement/pdf-builder.js';
import { pageNeedsOcr } from '../public/reimbursement/ocr.js';

function readyCase() {
  return {
    requestFilePresent: true, requestId: '4000', orgAbbrev: 'TEST', organization: 'Synthetic Student Organization',
    recipient: 'Test Recipient', submitter: 'Test Officer', submittedDate: '2026-09-26', requestedAmount: '100.00',
    requestVerified: true, partiesVerified: true, budgetAmount: '70.00', budgetBalance: '100.00', budgetVerified: true,
    revenueAmount: '30.00', revenueBalance: '100.00', revenueVerified: true,
    concurMonth: '2026-09', concurMonthVerified: true, reportDate: '2026-09-26', reportDateVerified: true, gwid: '', blankGwidConfirmed: true,
    supportType: 'flyer', supportVerified: true, supportFilesCount: 1,
    receipts: [
      { fileName: 'first.pdf', sha256: 'hash-1', vendor: 'Synthetic Vendor A', purchaseDate: '2026-09-01', total: '50.00', excludedAmount: '0.00', tags: ['food'], verified: true, itemized: true, paid: true, cardLastFourPresent: true, uniqueVerified: true, ineligibleFullyExcluded: true, allocationVerified: true, budgetAllocation: '50.00', revenueAllocation: '0.00', expenseType: 'Staff-confirmed type A', paymentType: 'Out of Pocket' },
      { fileName: 'second.pdf', sha256: 'hash-2', vendor: 'Synthetic Vendor B', purchaseDate: '2026-09-02', total: '50.00', excludedAmount: '0.00', tags: [], verified: true, itemized: true, paid: true, cardLastFourPresent: true, uniqueVerified: true, ineligibleFullyExcluded: true, allocationVerified: true, budgetAllocation: '20.00', revenueAllocation: '30.00', expenseType: 'Staff-confirmed type B', paymentType: 'Out of Pocket' },
    ],
  };
}

test('strict money and calendar inputs', () => {
  assert.equal(moneyToCents('1,234.50'), 123450);
  assert.equal(moneyToCents('12.345'), null);
  assert.equal(signedMoneyToCents('-20.00'), -2000);
  assert.equal(isoDate('09/04/2026'), '2026-09-04');
  assert.equal(isoDate('Sep 26, 2026'), '2026-09-26');
  assert.equal(isoDate('04 Sep 2026'), '2026-09-04');
  assert.equal(isoDate('02/30/2026'), '');
  assert.deepEqual(monthBounds('2026-09'), { start: '2026-09-01', end: '2026-09-30' });
});

test('text extraction only proposes unverified values', () => {
  assert.deepEqual(suggestRequest('Transaction ID: 4000\nAmount Requested: $100.00').requestId, '4000');
  const receipt = suggestReceipt('Purchase Date: 09/04/2026\nPizza 50.00\nTotal $50.00\nPaid with card ending in 1234');
  assert.equal(receipt.purchaseDate, '2026-09-04');
  assert.equal(receipt.total, '50.00');
  assert.ok(receipt.cardEvidence);
  assert.ok(receipt.tagHints.includes('food'));
  assert.equal(Object.hasOwn(receipt, 'verified'), false);
  const print = suggestRequest('Submitted by: Test Officer (officer@example.invalid) on Sep 26, 2026 11:46 AM\nTransaction ID 4000\nGroup Name Synthetic Student Organization\nAllocated -$70.00\nGroup Money $30.00\nPayment Request Form');
  assert.equal(print.requestedAmount, '100.00');
  assert.equal(print.budgetAmount, '70.00');
  assert.equal(print.revenueAmount, '30.00');
  assert.equal(print.submittedDate, '2026-09-26');
  assert.equal(suggestRequest('Submitted by: Test Officer on Sep 26, 2026\nTransaction ID: 4000').submitter, 'Test Officer');
});

test('scanned or nearly empty pages use OCR while text pages skip it', () => {
  assert.equal(pageNeedsOcr(''), true);
  assert.equal(pageNeedsOcr('Total $119.79'), true);
  assert.equal(pageNeedsOcr('Synthetic Vendor\nPurchase Date Sep 04, 2026\nPizza $108.90\nTax $10.89\nTotal Paid $119.79\nVisa ending in 1234'), false);
});

test('two receipts produce two expenses and exact split', () => {
  const data = readyCase();
  assert.equal(evaluateReimbursement(data).decision, 'READY_FOR_STAFF_REVIEW');
  const plan = buildConcurPlan(data);
  assert.equal(plan.report.name, 'TEST_#4000_Reimb');
  assert.equal(plan.expenses.length, 2);
  assert.equal(plan.expenses[1].revenue, '30.00');
  assert.equal(plan.pdfName, 'Test Recipient_$100.00.pdf');
});

test('missing payment evidence, food support, and funding verification never pass', () => {
  const data = readyCase();
  data.receipts[0].cardLastFourPresent = false;
  data.supportFilesCount = 0;
  data.budgetVerified = false;
  assert.equal(evaluateReimbursement(data).decision, 'NEEDS_EVIDENCE');
});

test('one-cent mismatch and wrong Allocate split require staff review', () => {
  const data = readyCase();
  data.requestedAmount = '100.01';
  assert.equal(evaluateReimbursement(data).decision, 'STAFF_REVIEW');
  data.requestedAmount = '100.00';
  data.receipts[1].revenueAllocation = '29.99';
  assert.equal(evaluateReimbursement(data).decision, 'STAFF_REVIEW');
});

test('manual categories and exact amount boundaries require review', () => {
  const data = readyCase();
  data.receipts[1].tags = ['hotel'];
  assert.equal(evaluateReimbursement(data).decision, 'STAFF_REVIEW');
  data.receipts[1].tags = [];
  data.requestedAmount = '25.00';
  data.receipts = [data.receipts[0]];
  data.receipts[0].total = '25.00';
  data.receipts[0].budgetAllocation = '25.00';
  data.receipts[0].revenueAllocation = '0.00';
  data.budgetAmount = '25.00'; data.revenueAmount = '0.00';
  assert.equal(evaluateReimbursement(data).decision, 'STAFF_REVIEW');
});

test('combined PDF retains cover fields and every source page', async () => {
  const source = await PDFLib.PDFDocument.create();
  source.addPage([612, 792]).drawText('Synthetic source');
  const sourceBytes = await source.save();
  const file = (name) => ({ name, mime: 'application/pdf', bytes: sourceBytes, sha256: `synthetic-${name}` });
  const data = readyCase();
  const output = await buildCombinedPdf(PDFLib, data, {
    request: file('request.pdf'), receipts: [file('first.pdf'), file('second.pdf')], support: [file('flyer.pdf')],
  });
  assert.equal(output.pageCount, 5);
  assert.deepEqual(output.manifest.map((part) => [part.kind, part.firstPage, part.lastPage]), [
    ['cover', 1, 1], ['CampusGroups printout', 2, 2], ['Original receipt', 3, 3],
    ['Original receipt', 4, 4], ['Supplementary material', 5, 5],
  ]);
  const reopened = await PDFLib.PDFDocument.load(output.bytes);
  assert.equal(reopened.getForm().getTextField('Name').getText(), 'Test Recipient');
  assert.equal(reopened.getForm().getTextField('GWID').getText() || '', '');
  assert.equal(reopened.getForm().getTextField('Amount').getText(), '100.00');
});
