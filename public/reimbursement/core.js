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
    match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
    if (match) [, month, day, year] = match;
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

export function suggestRequest(text) {
  const id = firstMatch(text, [/(?:Transaction\s*ID|Request\s*(?:ID|#|Number))\s*[:#-]?\s*(\d{3,8})/i]);
  const transactionBlock = id ? (text.split(/\n+/).slice(Math.max(0, text.split(/\n+/).findIndex((line) => new RegExp(`\\bTransaction\\s*ID\\s*${id}\\b`, "i").test(line))), 90).join("\n").split(/Payment Request Form/i)[0]) : "";
  const budgetAmount = firstMatch(transactionBlock, [/^Allocated\s+-?\$([\d,]+\.\d{2})\b/im]);
  const revenueAmount = firstMatch(transactionBlock, [/^Group\s*Money\s+\$([\d,]+\.\d{2})\b/im]);
  let amount = firstMatch(text, [/(?:Amount\s*(?:Requested|of\s*Request)|Reimbursement\s*Amount|Total\s*Amount)\s*[:$\s]+([\d,]+\.\d{2})/i]);
  if (!amount && budgetAmount && revenueAmount) amount = centsToMoney(moneyToCents(budgetAmount) + moneyToCents(revenueAmount));
  const recipient = firstMatch(text, [/(?:Person\s*to\s*be\s*Reimbursed|Reimbursement\s*Recipient|Payee)\s*[:\s]+([^\n]{3,90})/i]);
  const organization = firstMatch(text, [/(?:Student\s*Organization|Group\s*Name)\s*[:\s]+([^\n]{3,120})/i]);
  const submitter = firstMatch(text, [
    /Submitted\s*by:\s*([^\n(]{3,90}?)\s+on\s+[A-Za-z]{3,9}\s+\d{1,2}/i,
    /Submitted\s*by:\s*([^\n(]{3,90})\s*\(/i,
  ]);
  const submittedDate = isoDate(firstMatch(text, [/Submitted\s*by:[^\n]+?\bon\s+([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})/i]));
  return {
    requestId: id,
    requestedAmount: amount,
    budgetAmount,
    revenueAmount,
    recipient,
    organization,
    submitter,
    submittedDate,
    evidence: [
      id && shortEvidence(text, /(?:Transaction\s*ID|Request\s*(?:ID|#|Number))\s*[:#-]?\s*\d{3,8}/i),
      amount && shortEvidence(text, /(?:Amount\s*(?:Requested|of\s*Request)|Reimbursement\s*Amount|Total\s*Amount)\s*[:$\s]+[\d,]+\.\d{2}/i),
    ].filter(Boolean),
  };
}

export function suggestReceipt(text) {
  const datePattern = '(\\d{1,2}\\/\\d{1,2}\\/\\d{4}|\\d{4}-\\d{2}-\\d{2}|[A-Za-z]{3,9}\\s+\\d{1,2},?\\s+\\d{4}|\\d{1,2}\\s+[A-Za-z]{3,9}\\s+\\d{4})';
  const date = firstMatch(text, [
    new RegExp(`(?:Purchase\\s*Date|Order\\s*Placed|Transaction\\s*Date|Ordered\\s*On)\\s*[:\\s]+${datePattern}`, 'i'),
    new RegExp(`\\b${datePattern}\\b`, 'i'),
  ]);
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const totals = lines.flatMap((line) => {
    if (!/\b(?:grand\s*total|order\s*total|total\s*paid|total)\b/i.test(line) || /\b(?:subtotal|tax|shipping|tip)\b/i.test(line)) return [];
    const amount = /\$?\s*([\d,]+\.\d{2})\b/.exec(line);
    return amount ? [{ amount: amount[1], line }] : [];
  });
  const paidEvidence = shortEvidence(text, /\b(?:paid|payment\s*(?:completed|received)|charged)\b/i);
  const cardEvidence = shortEvidence(text, /(?:ending\s*in|last\s*four|last\s*4|\*{4}|x{4})\s*[-:# ]*\d{4}\b/i);
  const vendor = lines.find((line) => /[A-Za-z]/.test(line) && line.length < 80 && !/\b(?:purchase\s*date|order\s*placed|transaction\s*date|ordered\s*on|total|paid|payment|card|tax|shipping|tip|qty|quantity)\b/i.test(line) && !/\b\d+[.,]\d{2}\b/.test(line)) || "";
  const tagHints = [];
  for (const [tag, pattern] of Object.entries({
    food: /\b(?:pizza|restaurant|catering|meal|sandwich|food|beverage)\b/i,
    flowers: /\b(?:flower|bouquet|floral)\b/i,
    ammunition: /\b(?:ammunition|ammo|bullet)\b/i,
    gasoline: /\b(?:gasoline|fuel|gas\s*station)\b/i,
    transportation: /\b(?:rideshare|uber|lyft|taxi|train|airfare|transportation)\b/i,
    hotel: /\b(?:hotel|lodging|accommodation)\b/i,
  })) if (pattern.test(text)) tagHints.push(tag);
  return {
    purchaseDate: isoDate(date),
    vendor,
    total: totals.length === 1 ? totals[0].amount : "",
    totalCandidates: totals,
    paidEvidence,
    cardEvidence,
    tagHints,
    evidence: [date && shortEvidence(text, /\b\d{1,2}\/\d{1,2}\/\d{4}\b|\b\d{4}-\d{2}-\d{2}\b/), paidEvidence, cardEvidence].filter(Boolean),
  };
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
