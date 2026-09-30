// Deterministic, browser-safe review logic. Extraction yields suggestions, never verified facts.
export const ACCOUNT_CODES = Object.freeze({ budget: "542302", revenue: "542801" });

export function moneyToCents(value) {
  const text = String(value ?? "").trim().replace(/^\$/, "").replaceAll(",", "");
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function signedMoneyToCents(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const negative = text.startsWith("-");
  const cents = moneyToCents(negative ? text.slice(1) : text);
  return cents === null ? null : negative ? -cents : cents;
}

export function centsToMoney(cents) {
  return Number.isSafeInteger(cents) ? (cents / 100).toFixed(2) : "";
}

export function isoDate(value) {
  const text = String(value ?? "").trim();
  let year, month, day;
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match) [, year, month, day] = match;
  else {
    match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})$/.exec(text);
    if (match) { [, month, day, year] = match; if (year.length === 2) year = `20${year}`; }
    else {
      const named = /^(?:(\d{1,2})\s+([A-Za-z]{3,9})|([A-Za-z]{3,9})\s+(\d{1,2})),?\s+(\d{4})$/.exec(text);
      if (!named) return "";
      const key = (named[2] || named[3]).slice(0, 3).toLowerCase();
      const names = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
      month = names.indexOf(key) + 1;
      day = named[1] || named[4];
      year = named[5];
    }
  }
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function monthBounds(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value ?? ""));
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start: `${match[1]}-${match[2]}-01`, end: `${match[1]}-${match[2]}-${last}` };
}

function firstMatch(text, expressions) {
  for (const expression of expressions) {
    const match = expression.exec(text);
    if (match?.[1]) return match[1].trim();
  }
  return "";
}

function shortEvidence(text, expression) {
  const match = expression.exec(text);
  if (!match) return "";
  const start = Math.max(0, match.index - 36);
  return text.slice(start, Math.min(text.length, match.index + match[0].length + 36)).replace(/\s+/g, " ").trim();
}

// Read a label's value on this line or the next nonempty line. A PDF export often
// separates a question, its required-field asterisk, and its answer.
function labeledValue(text, labels) {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const prefix = new RegExp(`^(?:${labels})\\b[ \\t]*[:?]?[ \\t]*\\*?[ \\t]*`, 'i');
  for (let i = 0; i < lines.length; i++) {
    const cells = lines[i].split(/\t+/);
    for (let column = 0; column < cells.length; column++) {
      const match = prefix.exec(cells[column]);
      if (!match) continue;
      const inline = cells[column].slice(match[0].length).trim();
      if (inline) return inline;
      return lines[i + 1]?.split(/\t+/)[column]?.trim() || '';
    }
  }
  return '';
}

const DATE_PATTERN = '(\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[/-]\\d{1,2}[/-](?:\\d{4}|\\d{2})|[A-Za-z]{3,9}\\s+\\d{1,2},?\\s+\\d{4}|\\d{1,2}\\s+[A-Za-z]{3,9}\\s+\\d{4})';

export function suggestRequest(source) {
  const text = String(source || "").replace(/\r/g, "");
  // Scope monetary extraction to this transaction, excluding the budget ledger
  // and the generic instructions earlier/later in the exported printout.
  const transaction = text.match(/(?:Budget\s*&\s*Payment\s*Request\s*Details|Transaction\s*ID)[\s\S]*?(?=Payment Request Form|$)/i)?.[0] || text;
  const id = firstMatch(transaction, [/(?:Transaction\s*ID|Request\s*(?:ID|#|Number))[^\n\d]*\n?\s*(\d{3,8})\b/i]);
  const funding = (label) => firstMatch(transaction, [
    new RegExp(`${label}[^\\n\\d$]*[-$\\s]+([\\d,]+\\.\\d{2})`, "i"),
    new RegExp(`-?\\$([\\d,]+\\.\\d{2})\\s*${label}\\b`, "i"),
  ]);
  const budgetAmount = funding('Allocated');
  const revenueAmount = funding('Group\\s*Money');
  let amount = firstMatch(text, [/(?:Amount\s*(?:Requested|of\s*Request)|Reimbursement\s*Amount|Total\s*Amount)\s*[:*$\s]+([\d,]+\.\d{2})/i]);
  if (!amount && budgetAmount && revenueAmount) amount = centsToMoney(moneyToCents(budgetAmount) + moneyToCents(revenueAmount));
  const recipient = labeledValue(text, 'Who\\s+is\\s+being\\s+reimbursed|Person\\s*to\\s*be\\s*Reimbursed|Reimbursement\\s*Recipient');
  const organization = labeledValue(transaction, 'Group\\s*Name|Student\\s*Organization');
  const submitted = /Submitted\s*by\s*:\s*([^\n(]+?)(?:\s*\([^\n]*?\))?\s+on\s+([^\n]+)/i.exec(text);
  const submitter = submitted?.[1]?.trim() || firstMatch(text, [/Submitted\s*by:\s*([^\n(]+)\s*\(/i]);
  const submittedDate = isoDate(firstMatch(submitted?.[2] || "", [new RegExp(DATE_PATTERN, 'i')]));
  return { requestId: id, requestedAmount: amount, budgetAmount, revenueAmount, recipient, organization, submitter, submittedDate,
    evidence: [id && `Request ID: ${id}`, amount && `Requested amount: $${amount}`, recipient && `Recipient: ${recipient}`, organization && `Organization: ${organization}`].filter(Boolean) };
}

export function suggestReceipt(source) {
  const text = String(source || "").replace(/\r/g, "");
  const dateText = text.split(/\n/).filter((line) => !/^\s*\d{1,2}[/-]\d{1,2}[/-]\d{2,4},?\s+\d{1,2}:\d{2}.*(?:Past Orders|Receipt|Invoice|https?)/i.test(line)).join('\n');
  const date = firstMatch(dateText, [
    new RegExp(`(?:Purchase\\s*Date|Date\\s*of\\s*Purchase|Order\\s*Placed|Transaction\\s*Date|Ordered\\s*On|Order\\s*completed)\\s*[:*\\s]+${DATE_PATTERN}`, 'i'),
    new RegExp(`(?:^|\\n)\\s*(?:Date\\s*[:*]\\s*)?${DATE_PATTERN}(?=\\s*(?:$|\\n|at|\\d{1,2}:))`, 'im'),
    new RegExp(`\\b${DATE_PATTERN}\\b`, 'i'),
  ]);
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const candidates = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const label = /\b(grand\s*total|order\s*total|total\s*(?:paid|charged)|amount\s*(?:paid|charged)|balance\s*paid|total)\b/i.exec(line);
    if (!label || /\b(?:sub\s*total|subtotal|amount\s*due|balance\s*due)\b/i.test(line)) continue;
    const tail = line.slice(label.index + label[0].length);
    if (/\b(?:tax|shipping|tip|savings|discount)\b/i.test(tail)) continue;
    // Label and value may be separated by a line break. Never steal a subtotal,
    // tax, item price, or another labeled row from below the total.
    const valueText = /\d/.test(tail) ? tail : /^\$?\s*[\d,]+\.\d{2}(?:\s*(?:USD|US\$))?\s*$/i.test(lines[index + 1] || '') ? lines[index + 1] : '';
    const amounts = [...valueText.matchAll(/(?:\$|\b)([\d,]+\.\d{2})\b/g)];
    for (const amount of amounts) {
      const cents = moneyToCents(amount[1]);
      if (cents !== null) candidates.push({ amount: centsToMoney(cents), line: `${line}${valueText === tail ? '' : ` ${valueText}`}`, rank: /paid|charged|grand|order/i.test(label[0]) ? 2 : 1 });
    }
  }
  const totals = [...new Map(candidates.map((item) => [item.amount, item])).values()];
  // Conflicting final totals always remain a staff choice. Repeated references
  // to the SAME amount are evidence, not ambiguity.
  const total = totals.length === 1 ? totals[0].amount : '';
  const paidEvidence = /\b(?:unpaid|not\s+paid|payment\s*(?:pending|failed))\b/i.test(text) ? '' : lines.filter((line) => !/\b(?:unpaid|not\s+paid|payment\s*(?:pending|failed)|amount\s+due|balance\s+due)\b/i.test(line)).map((line) => shortEvidence(line, /\b(?:paid|payment\s*(?:completed|received)|charged|payments)\b/i)).find(Boolean) || '';
  const cardEvidence = shortEvidence(text, /(?:(?:ending\s*(?:in)?|last\s*(?:four|4))\s*[-:# ]*|(?:[\u2022\u25cf*Xx][ \t]*){2,}|(?:visa|mastercard|amex|discover|credit\s*card)\s*[-:# +*Xx\u2022\u25cf]*)\d{4}\b/i);
  const explicitVendor = firstMatch(text, [/\b(?:merchant|vendor|store\s*name)\s*:\s*([^\n]+)/i, /(?:here['’]s\s+your\s+receipt\s+for|receipt\s+from)\s+([^\n]+?)[.]?(?:\n|$)/i]);
  const vendor = explicitVendor || lines.find((line) => /[A-Za-z]/.test(line) && line.length < 80 && !/\b(?:receipt|invoice|order|purchase|transaction|total|paid|payment|card|tax|shipping|tip|qty|quantity|date|print|page|www|https|thanks|thank\s+you|reorder)\b/i.test(line) && !/\b\d+[.,]\d{2}\b|\d{1,2}[/-]\d{1,2}|\d{1,2}:\d{2}|@/.test(line)) || '';
  const tagHints = [];
  for (const [tag, pattern] of Object.entries({
    food: /\b(?:pizza|restaurant|catering|meal|sandwich|food|beverage)\b/i,
    flowers: /\b(?:flower|bouquet|floral)\b/i,
    ammunition: /\b(?:ammunition|ammo|bullet)\b/i,
    gasoline: /\b(?:gasoline|fuel|gas\s*station)\b/i,
    transportation: /\b(?:rideshare|uber(?!\s*eats)|lyft|taxi|train|airfare|transportation)\b/i,
    hotel: /\b(?:hotel|lodging|accommodation)\b/i,
  })) if (pattern.test(text)) tagHints.push(tag);
  return { purchaseDate: isoDate(date), vendor, total, totalCandidates: totals, paidEvidence, cardEvidence, tagHints,
    evidence: [date && `Date wording: ${date}`, paidEvidence, cardEvidence].filter(Boolean) };
}

function add(issues, severity, field, message) {
  issues.push({ severity, field, message });
}

export function evaluateReimbursement(caseData) {
  const issues = [];
  const receipts = Array.isArray(caseData.receipts) ? caseData.receipts : [];
  const amount = moneyToCents(caseData.requestedAmount);
  const submittedDate = isoDate(caseData.submittedDate);
  if (!caseData.requestFilePresent || !caseData.requestId || !caseData.organization || !caseData.recipient || !caseData.submitter || !submittedDate || amount === null) {
    add(issues, "missing", "request", "Verify the request ID, organization, recipient, submitter, submission date, and requested amount.");
  }
  if (!caseData.requestVerified) add(issues, "missing", "request", "Compare the entered request facts to the CampusGroups printout.");
  if (!caseData.partiesVerified) add(issues, "missing", "identity", "Verify that the submitter and reimbursement recipient are different people.");
  if (caseData.submitter && caseData.recipient && caseData.submitter.trim().toLowerCase() === caseData.recipient.trim().toLowerCase()) {
    add(issues, "review", "identity", "The submitter and recipient appear to be the same person.");
  }
  if (!receipts.length) add(issues, "missing", "receipts", "Add at least one original receipt or invoice.");

  let eligibleTotal = 0;
  let allAmountsKnown = receipts.length > 0;
  let foodPresent = false;
  let budgetExpenses = 0;
  let revenueExpenses = 0;
  const ids = new Set();
  for (const [index, receipt] of receipts.entries()) {
    const label = `Receipt ${index + 1}`;
    if (ids.has(receipt.sha256) && receipt.sha256) add(issues, "review", `receipt.${index}`, `${label} has the same file hash as another receipt.`);
    if (receipt.sha256) ids.add(receipt.sha256);
    if (!receipt.verified) add(issues, "missing", `receipt.${index}`, `${label}: staff must verify extracted facts and the full item list.`);
    if (!receipt.vendor) add(issues, "missing", `receipt.${index}`, `${label}: verify the vendor.`);
    if (!receipt.itemized || !receipt.paid || !receipt.cardLastFourPresent) add(issues, "missing", `receipt.${index}`, `${label}: itemization, paid status, and card-last-four presence are all required.`);
    if (!receipt.uniqueVerified) add(issues, "missing", `receipt.${index}`, `${label}: verify that this is a distinct purchase.`);
    const purchaseDate = isoDate(receipt.purchaseDate);
    if (!purchaseDate) add(issues, "missing", `receipt.${index}`, `${label}: verify the purchase date.`);
    else if (submittedDate) {
      const days = (Date.parse(submittedDate) - Date.parse(purchaseDate)) / 86400000;
      if (days < 0 || days > 60) add(issues, "review", `receipt.${index}`, `${label}: purchase is outside the confirmed 60-day submission window.`);
    }
    const gross = moneyToCents(receipt.total);
    const excluded = moneyToCents(receipt.excludedAmount || "0");
    if (gross === null || excluded === null || excluded > gross) {
      allAmountsKnown = false;
      add(issues, "missing", `receipt.${index}`, `${label}: verify gross total and excluded item amount.`);
      continue;
    }
    const eligible = gross - excluded;
    eligibleTotal += eligible;
    const tags = receipt.tags || [];
    if (tags.includes("food")) foodPresent = true;
    if (tags.some((tag) => ["gasoline", "transportation", "hotel"].includes(tag))) add(issues, "review", `receipt.${index}`, `${label}: gasoline, transportation, and hotel claims require manual handling.`);
    if (tags.some((tag) => ["flowers", "ammunition"].includes(tag)) && (!receipt.ineligibleFullyExcluded || excluded === 0)) add(issues, "review", `receipt.${index}`, `${label}: prohibited items must be fully excluded.`);
    const budget = moneyToCents(receipt.budgetAllocation);
    const revenue = moneyToCents(receipt.revenueAllocation);
    if (!receipt.allocationVerified || budget === null || revenue === null) add(issues, "missing", `receipt.${index}`, `${label}: verify the Budget/Revenue Allocate amounts.`);
    else {
      if (budget + revenue !== eligible) add(issues, "review", `receipt.${index}`, `${label}: Allocate amounts do not equal this expense's eligible amount.`);
      budgetExpenses += budget;
      revenueExpenses += revenue;
    }
    if (!receipt.expenseType) add(issues, "missing", `receipt.${index}`, `${label}: staff must select the Concur expense type.`);
    if (!receipt.paymentType) add(issues, "missing", `receipt.${index}`, `${label}: confirm the Concur payment type.`);
  }
  if (foodPresent && (!(caseData.supportType === "flyer" || caseData.supportType === "attendee_list") || !caseData.supportFilesCount)) {
    add(issues, "missing", "support", "Food reimbursement needs a verified event flyer or attendee list.");
  } else if (foodPresent && !caseData.supportVerified) add(issues, "missing", "support", "Verify that the event evidence belongs to this request.");
  if (allAmountsKnown && amount !== null) {
    if (eligibleTotal !== amount) add(issues, "review", "amount", `Requested $${centsToMoney(amount)} does not equal eligible receipts $${centsToMoney(eligibleTotal)}.`);
    if (!(eligibleTotal > 2500 && eligibleTotal < 50000)) add(issues, "review", "amount", "The combined eligible amount must be greater than $25 and less than $500.");
  }
  const budgetRequested = moneyToCents(caseData.budgetAmount);
  const revenueRequested = moneyToCents(caseData.revenueAmount);
  const budgetAvailable = signedMoneyToCents(caseData.budgetBalance);
  const revenueAvailable = signedMoneyToCents(caseData.revenueBalance);
  if (budgetRequested === null || revenueRequested === null || amount === null) {
    add(issues, "missing", "funding", "Enter the submitted Budget and Revenue portions, using zero for an unused source.");
  } else if (budgetRequested + revenueRequested !== amount) {
    add(issues, "review", "funding", "Submitted Budget and Revenue amounts must sum exactly to the requested amount.");
  } else {
    if (budgetRequested && (!caseData.budgetVerified || budgetAvailable === null)) add(issues, "missing", "funding", "Verify the current Budget balance and its exact line.");
    if (revenueRequested && (!caseData.revenueVerified || revenueAvailable === null)) add(issues, "missing", "funding", "Verify the current Revenue balance.");
    if (caseData.budgetVerified && budgetAvailable !== null && budgetRequested > budgetAvailable) add(issues, "review", "funding", "The submitted Budget portion exceeds its verified current balance.");
    if (caseData.revenueVerified && revenueAvailable !== null && revenueRequested > revenueAvailable) add(issues, "review", "funding", "The submitted Revenue portion exceeds its verified current balance.");
    if (receipts.length && (budgetExpenses !== budgetRequested || revenueExpenses !== revenueRequested)) add(issues, "review", "allocation", "Expense-level Allocate totals do not reconcile to the request's submitted funding split.");
  }
  if (!monthBounds(caseData.concurMonth) || !caseData.concurMonthVerified) add(issues, "missing", "concur", "Confirm the Concur submission month for report Start and End dates.");
  if (!isoDate(caseData.reportDate) || !caseData.reportDateVerified) add(issues, "missing", "concur", "Confirm the Concur Report Date separately from the month range.");
  if (!caseData.orgAbbrev) add(issues, "missing", "concur", "Confirm the organization abbreviation for the report name.");
  if (!caseData.gwid && !caseData.blankGwidConfirmed) add(issues, "missing", "cover", "Supply a verified GWID or explicitly confirm a blank cover field for this case.");
  const decision = issues.some((issue) => issue.severity === "review") ? "STAFF_REVIEW" : issues.length ? "NEEDS_EVIDENCE" : "READY_FOR_STAFF_REVIEW";
  return { decision, issues, eligibleTotalCents: allAmountsKnown ? eligibleTotal : null, differenceCents: allAmountsKnown && amount !== null ? amount - eligibleTotal : null };
}

export function buildConcurPlan(caseData) {
  const bounds = monthBounds(caseData.concurMonth);
  const report = {
    name: caseData.orgAbbrev && caseData.requestId ? `${caseData.orgAbbrev}_#${caseData.requestId}_Reimb` : "",
    owner: caseData.recipient || "",
    businessPurpose: "Student Org Reimb",
    travelType: "No Travel",
    reportDate: isoDate(caseData.reportDate),
    startDate: bounds?.start || "",
    endDate: bounds?.end || "",
  };
  const expenses = (caseData.receipts || []).map((receipt, index) => ({
    number: index + 1,
    source: receipt.fileName || `Receipt ${index + 1}`,
    type: receipt.expenseType || "",
    transactionDate: isoDate(receipt.purchaseDate),
    vendor: receipt.vendor || "",
    amount: (() => { const gross = moneyToCents(receipt.total); const excluded = moneyToCents(receipt.excludedAmount || "0"); return gross !== null && excluded !== null && excluded <= gross ? centsToMoney(gross - excluded) : ""; })(),
    businessPurpose: caseData.organization || "",
    paymentType: receipt.paymentType || "",
    budget: receipt.budgetAllocation || "",
    revenue: receipt.revenueAllocation || "",
    codes: ACCOUNT_CODES,
  }));
  return { report, expenses, pdfName: caseData.recipient && moneyToCents(caseData.requestedAmount) !== null ? `${caseData.recipient}_$${centsToMoney(moneyToCents(caseData.requestedAmount))}.pdf` : "" };
}
