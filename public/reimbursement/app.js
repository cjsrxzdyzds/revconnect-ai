import * as pdfjs from "./vendor/pdf.mjs";
import { buildCombinedPdf } from "./pdf-builder.js";
import { buildConcurPlan, evaluateReimbursement, suggestReceipt, suggestRequest } from "./core.js";
import { pageNeedsOcr, recognizeImage, recognizePdfPage, stopOcr } from "./ocr.js";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdf.worker.mjs", import.meta.url).href;

const $ = (selector) => document.querySelector(selector);
const files = { request: null, receipts: [], support: [] };
let pdfUrl = "";
const ids = ["request-id", "org-abbrev", "organization", "recipient", "submitter", "submitted-date", "requested-amount", "budget-amount", "budget-balance", "revenue-amount", "revenue-balance", "concur-month", "report-date", "gwid", "support-type", "request-verified", "parties-verified", "budget-verified", "revenue-verified", "concur-month-verified", "report-date-verified", "support-verified", "blank-gwid-confirmed"];
const tagNames = ["food", "flowers", "ammunition", "gasoline", "transportation", "hotel"];

function showError(error) {
  const target = $("#fatal");
  target.textContent = error instanceof Error ? error.message : String(error);
  target.classList.remove("hidden");
}

function clearError() { $("#fatal").classList.add("hidden"); }

function text(tag, value, className = "") {
  const element = document.createElement(tag);
  element.textContent = String(value ?? "");
  if (className) element.className = className;
  return element;
}

function fieldValue(id) { return $(`#${id}`).value.trim(); }
function checked(id) { return $(`#${id}`).checked; }
function fillIfEmpty(id, value) { if (value && !fieldValue(id)) $(`#${id}`).value = value; }

function limitFile(file) {
  if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name}: 25 MB per-file limit. Compress or split before using this page.`);
  const name = file.name.toLowerCase();
  if (!/\.(pdf|png|jpe?g)$/.test(name)) throw new Error(`${file.name}: use PDF, PNG, or JPEG.`);
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const MAX_OCR_PAGES = 20;

function ocrProgress(message) { $("#ocr-status").textContent = message; }

async function extractText(bytes, fileName, useOcr) {
  const loading = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, useSystemFonts: true });
  const document = await loading.promise;
  const pages = [];
  const ocrPages = [];
  const errors = [];
  let ocrAttempted = 0;
  const totalPages = document.numPages;
  try {
    for (let index = 1; index <= Math.min(totalPages, 60); index++) {
      const page = await document.getPage(index);
      const content = await page.getTextContent();
      const rows = new Map();
      for (const item of content.items) {
        if (!item.str?.trim()) continue;
        const y = Math.round(item.transform?.[5] || 0);
        const row = rows.get(y) || [];
        row.push({ x: item.transform?.[4] || 0, value: item.str });
        rows.set(y, row);
      }
      let pageText = [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, row]) => row.sort((a, b) => a.x - b.x).map((part) => part.value).join(" ")).join("\n");
      if (useOcr && pageNeedsOcr(pageText) && ocrAttempted < MAX_OCR_PAGES) {
        ocrAttempted++;
        ocrProgress(`${fileName}: recognizing scanned page ${index} of ${totalPages}…`);
        try {
          const scan = await recognizePdfPage(page, (message) => ocrProgress(`${fileName}, page ${index}: ${message}`));
          if (scan.text.trim()) { pageText = scan.text; ocrPages.push(index); }
          else errors.push(`page ${index}: no text recognized`);
        } catch (error) { errors.push(`page ${index}: ${error.message}`); }
      }
      pages.push(pageText);
      page.cleanup();
    }
  } finally {
    await document.destroy();
  }
  return { text: pages.join("\n\n"), ocrPages, errors, truncated: totalPages > 60, ocrLimitReached: ocrAttempted === MAX_OCR_PAGES && totalPages > MAX_OCR_PAGES };
}

async function loadFile(file, useOcr = true) {
  limitFile(file);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hash = await sha256(bytes);
  let extractedText = "";
  let note = "";
  if (file.name.toLowerCase().endsWith(".pdf")) {
    try {
      const result = await extractText(bytes, file.name, useOcr);
      extractedText = result.text;
      if (result.ocrPages.length) note = `Local English OCR on page${result.ocrPages.length === 1 ? "" : "s"} ${result.ocrPages.join(", ")}; verify against the original.`;
      if (result.errors.length) note += `${note ? " " : ""}OCR needs manual review (${result.errors.join("; ")}).`;
      if (result.ocrLimitReached) note += " OCR is limited to 20 pages per file; inspect remaining pages manually.";
      if (result.truncated) note += " Only the first 60 pages were inspected.";
      if (!extractedText.trim()) note += " No text found; enter and verify facts manually.";
    } catch (error) {
      note = `Text extraction unavailable (${error.message}); inspect the file and enter facts manually.`;
    }
  } else if (useOcr) {
    ocrProgress(`${file.name}: recognizing image…`);
    try {
      const result = await recognizeImage(file, (message) => ocrProgress(`${file.name}: ${message}`));
      extractedText = result.text;
      note = extractedText.trim() ? "Local English OCR; verify every field against the original image." : "OCR found no text; inspect and enter facts manually.";
    } catch (error) { note = `OCR unavailable (${error.message}); inspect and enter facts manually.`; }
  } else note = "Supporting image: inspect visually; text is not required for extraction.";
  return { name: file.name, mime: file.type, bytes, sha256: hash, extractedText, note };
}

function invalidatePdf() {
  if (pdfUrl) URL.revokeObjectURL(pdfUrl);
  pdfUrl = "";
  $("#pdf-preview").removeAttribute("src");
  $("#pdf-preview").classList.add("hidden");
  $("#download-pdf").classList.add("hidden");
  $("#pdf-reviewed-wrap").classList.add("hidden");
  $("#pdf-reviewed").checked = false;
  $("#manifest").replaceChildren();
  $("#pdf-message").textContent = "The inputs changed. Generate and inspect a new PDF.";
}

function fileStatus() {
  const names = [
    `Printout: ${files.request?.name || "not selected"}`,
    `Receipts: ${files.receipts.length}`,
    `Support files: ${files.support.length}`,
  ];
  const notes = [files.request, ...files.receipts, ...files.support].filter(Boolean).map((item) => item.note).filter(Boolean);
  $("#file-status").textContent = [...names, ...notes].join(" · ");
}

function staticInput(label, name, value = "", type = "text", placeholder = "") {
  const wrapper = document.createElement("label");
  wrapper.textContent = label;
  const input = document.createElement("input");
  input.name = name;
  input.type = type;
  input.value = value;
  input.placeholder = placeholder;
  if (name.includes("Amount") || name.includes("Allocation") || name === "total") input.inputMode = "decimal";
  wrapper.append(input);
  return wrapper;
}

function check(label, name, active = false) {
  const wrapper = document.createElement("label");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.name = name;
  input.checked = active;
  wrapper.append(input, document.createTextNode(label));
  return wrapper;
}

function renderReceipts() {
  const container = $("#receipt-cards");
  container.replaceChildren();
  if (!files.receipts.length) {
    container.append(text("div", "Add original invoices or receipts above.", "empty"));
    return;
  }
  files.receipts.forEach((file, index) => {
    const hint = suggestReceipt(file.extractedText);
    const card = document.createElement("article");
    card.className = "receipt-card";
    card.dataset.index = String(index);
    card.append(text("h3", `Expense ${index + 1}`));
    card.append(text("p", `${file.name} · SHA-256 ${file.sha256.slice(0, 12)}…`, "source-meta"));
    const fields = document.createElement("div");
    fields.className = "receipt-fields";
    fields.append(
      staticInput("Vendor / merchant", "vendor", hint.vendor),
      staticInput("Purchase date", "purchaseDate", hint.purchaseDate, "date"),
      staticInput("Receipt total (USD)", "total", hint.total, "text", "0.00"),
      staticInput("Excluded items (USD)", "excludedAmount", "0.00", "text", "0.00"),
      staticInput("Concur expense type / code", "expenseType", "", "text", "Staff-selected type"),
      staticInput("Payment type", "paymentType", "", "text", "e.g. Out of Pocket"),
      staticInput("Budget Allocate (USD)", "budgetAllocation", "", "text", "0.00"),
      staticInput("Revenue Allocate (USD)", "revenueAllocation", "", "text", "0.00"),
    );
    card.append(fields);
    const tags = document.createElement("div");
    tags.className = "tag-list";
    for (const name of tagNames) tags.append(check(name[0].toUpperCase() + name.slice(1), `tag-${name}`));
    const categoryPrompt = hint.tagHints.length ? `Text suggests: ${hint.tagHints.join(", ")}. Check categories only after inspecting the item list.` : "Check every applicable category after inspecting the item list.";
    card.append(text("p", categoryPrompt, "hint"), tags);
    const checks = document.createElement("div");
    checks.className = "receipt-checks";
    checks.append(
      check("I verified every entered fact and item category.", "verified"),
      check("The original receipt is readable and itemized.", "itemized"),
      check("The receipt proves it was paid.", "paid"),
      check("The receipt shows card last-four digits.", "cardLastFourPresent"),
      check("This is a distinct purchase, not a duplicate.", "uniqueVerified"),
      check("I verified this expense's Allocate amounts.", "allocationVerified"),
      check("All prohibited items are excluded.", "ineligibleFullyExcluded"),
    );
    card.append(checks);
    const evidence = document.createElement("details");
    evidence.className = "evidence";
    evidence.append(text("summary", "Extraction hints (unverified)"));
    const info = document.createElement("div");
    info.textContent = [
      hint.totalCandidates.length > 1 ? `${hint.totalCandidates.length} total candidates found; choose the correct final paid amount.` : hint.total ? `Total candidate: $${hint.total}` : "No unambiguous total found.",
      hint.purchaseDate ? `Date candidate: ${hint.purchaseDate}` : "No purchase date candidate found.",
      hint.paidEvidence ? "Paid/payment wording found; inspect the original page." : "No paid marker found in selectable text.",
      hint.cardEvidence ? "Card-last-four pattern found; inspect the original page." : "No card-last-four marker found in selectable text.",
      file.note,
    ].filter(Boolean).join("\n");
    evidence.append(info);
    card.append(evidence);
    container.append(card);
  });
}

function receiptValues() {
  return [...document.querySelectorAll(".receipt-card")].map((card) => {
    const file = files.receipts[Number(card.dataset.index)];
    const input = (name) => card.querySelector(`[name="${name}"]`);
    return {
      fileName: file.name, sha256: file.sha256,
      vendor: input("vendor").value.trim(), purchaseDate: input("purchaseDate").value,
      total: input("total").value.trim(), excludedAmount: input("excludedAmount").value.trim(),
      expenseType: input("expenseType").value.trim(), paymentType: input("paymentType").value.trim(), budgetAllocation: input("budgetAllocation").value.trim(), revenueAllocation: input("revenueAllocation").value.trim(),
      tags: tagNames.filter((tag) => input(`tag-${tag}`).checked),
      verified: input("verified").checked, itemized: input("itemized").checked, paid: input("paid").checked,
      cardLastFourPresent: input("cardLastFourPresent").checked, uniqueVerified: input("uniqueVerified").checked,
      allocationVerified: input("allocationVerified").checked, ineligibleFullyExcluded: input("ineligibleFullyExcluded").checked,
    };
  });
}

function collectCase() {
  return {
    requestFilePresent: Boolean(files.request),
    requestId: fieldValue("request-id"), orgAbbrev: fieldValue("org-abbrev"), organization: fieldValue("organization"),
    recipient: fieldValue("recipient"), submitter: fieldValue("submitter"), submittedDate: fieldValue("submitted-date"),
    requestedAmount: fieldValue("requested-amount"), budgetAmount: fieldValue("budget-amount"), budgetBalance: fieldValue("budget-balance"),
    revenueAmount: fieldValue("revenue-amount"), revenueBalance: fieldValue("revenue-balance"), concurMonth: fieldValue("concur-month"), reportDate: fieldValue("report-date"),
    gwid: fieldValue("gwid"), supportType: fieldValue("support-type"),
    requestVerified: checked("request-verified"), partiesVerified: checked("parties-verified"), budgetVerified: checked("budget-verified"),
    revenueVerified: checked("revenue-verified"), concurMonthVerified: checked("concur-month-verified"), reportDateVerified: checked("report-date-verified"),
    supportVerified: checked("support-verified"), supportFilesCount: files.support.length, blankGwidConfirmed: checked("blank-gwid-confirmed"),
    receipts: receiptValues(),
  };
}

function planTable(title, rows) {
  const section = document.createElement("section");
  section.append(text("h3", title));
  const table = document.createElement("table");
  const body = document.createElement("tbody");
  for (const [label, value] of rows) {
    const row = document.createElement("tr");
    row.append(text("td", label));
    row.append(text("td", value || "Needs staff entry"));
    const cell = document.createElement("td");
    const button = text("button", "Copy", "copy");
    button.type = "button";
    button.dataset.copy = String(value || "");
    button.disabled = !value;
    cell.append(button);
    row.append(cell);
    body.append(row);
  }
  table.append(body);
  section.append(table);
  return section;
}

function renderReview() {
  const data = collectCase();
  const result = evaluateReimbursement(data);
  const status = $("#decision");
  status.className = `decision ${result.decision === "READY_FOR_STAFF_REVIEW" ? "ready" : result.decision === "STAFF_REVIEW" ? "review" : "missing"}`;
  status.textContent = result.decision === "READY_FOR_STAFF_REVIEW" ? "Ready for staff reimbursement review - not approved or submitted" : result.decision === "STAFF_REVIEW" ? "Staff review required - do not treat as ready" : "More verified evidence is needed";
  const issues = $("#issues");
  issues.replaceChildren(...result.issues.map((issue) => text("li", issue.message)));
  const plan = buildConcurPlan(data);
  const target = $("#concur-plan");
  target.replaceChildren();
  target.append(planTable("Expense Report heading", [
    ["Report name", plan.report.name], ["Expense Report For", plan.report.owner], ["Business purpose", plan.report.businessPurpose],
    ["Travel type", plan.report.travelType], ["Report Date", plan.report.reportDate], ["Start date", plan.report.startDate], ["End date", plan.report.endDate],
  ]));
  for (const expense of plan.expenses) target.append(planTable(`Expense ${expense.number} · ${expense.source}`, [
    ["Expense type", expense.type], ["Transaction date", expense.transactionDate], ["Vendor", expense.vendor],
    ["Amount (USD)", expense.amount], ["Business purpose", expense.businessPurpose], ["Payment type", expense.paymentType],
    ["Budget Allocate · 542302", expense.budget], ["Revenue Allocate · 542801", expense.revenue],
  ]));
  return { data, result, plan };
}

async function onRequestFile() {
  clearError();
  invalidatePdf();
  const selected = $("#request-file").files[0];
  files.request = null;
  if (!selected) { fileStatus(); renderReview(); return; }
  try {
    if (!selected.name.toLowerCase().endsWith(".pdf")) throw new Error("The CampusGroups printout must be a PDF.");
    files.request = await loadFile(selected);
    const suggestion = suggestRequest(files.request.extractedText);
    fillIfEmpty("request-id", suggestion.requestId);
    fillIfEmpty("requested-amount", suggestion.requestedAmount);
    fillIfEmpty("budget-amount", suggestion.budgetAmount);
    fillIfEmpty("revenue-amount", suggestion.revenueAmount);
    fillIfEmpty("recipient", suggestion.recipient);
    fillIfEmpty("organization", suggestion.organization);
    fillIfEmpty("submitter", suggestion.submitter);
    fillIfEmpty("submitted-date", suggestion.submittedDate);
    const details = $("#request-evidence");
    details.classList.toggle("hidden", !suggestion.evidence.length && !files.request.note);
    details.querySelector("div").textContent = ["Suggestions are unverified; inspect the actual printout.", ...suggestion.evidence, files.request.note].filter(Boolean).join("\n");
  } catch (error) { showError(error); }
  ocrProgress("");
  fileStatus(); renderReview();
}

async function onManyFiles(kind, selector) {
  clearError();
  invalidatePdf();
  files[kind] = [];
  try {
    const selected = [...$(selector).files];
    if (selected.length > 20) throw new Error("Select no more than 20 files in one category.");
    for (const file of selected) files[kind].push(await loadFile(file, kind === "receipts"));
  } catch (error) { showError(error); }
  ocrProgress("");
  if (kind === "receipts") renderReceipts();
  fileStatus(); renderReview();
}

async function generatePdf() {
  clearError();
  invalidatePdf();
  const { data, plan } = renderReview();
  try {
    if (!window.PDFLib) throw new Error("The bundled PDF library did not load. Reload the page and retry.");
    $("#pdf-message").textContent = "Combining and verifying pages in this browser…";
    const output = await buildCombinedPdf(window.PDFLib, data, files);
    const blob = new Blob([output.bytes], { type: "application/pdf" });
    pdfUrl = URL.createObjectURL(blob);
    const preview = $("#pdf-preview");
    preview.src = pdfUrl;
    preview.classList.remove("hidden");
    const manifest = $("#manifest");
    const table = document.createElement("table");
    const head = document.createElement("thead");
    const row = document.createElement("tr");
    for (const name of ["Component", "Source", "PDF pages"]) row.append(text("th", name));
    head.append(row); table.append(head);
    const body = document.createElement("tbody");
    for (const item of output.manifest) {
      const line = document.createElement("tr");
      for (const value of [item.kind, item.name, item.firstPage === item.lastPage ? item.firstPage : `${item.firstPage}-${item.lastPage}`]) line.append(text("td", value));
      body.append(line);
    }
    table.append(body); manifest.replaceChildren(table);
    $("#pdf-message").textContent = `${output.pageCount} pages generated. Verify every page in the preview, then confirm the checkbox to download.`;
    const link = $("#download-pdf");
    link.href = pdfUrl;
    link.download = plan.pdfName || "Reimbursement_evidence.pdf";
    $("#pdf-reviewed-wrap").classList.remove("hidden");
  } catch (error) {
    $("#pdf-message").textContent = "PDF generation failed. Review the source files and case fields.";
    showError(error);
  }
}

for (const id of ids) {
  const input = $(`#${id}`);
  input.addEventListener("input", () => { invalidatePdf(); renderReview(); });
  input.addEventListener("change", () => { invalidatePdf(); renderReview(); });
}
$("#receipt-cards").addEventListener("input", () => { invalidatePdf(); renderReview(); });
$("#receipt-cards").addEventListener("change", () => { invalidatePdf(); renderReview(); });
$("#request-file").addEventListener("change", onRequestFile);
$("#receipt-files").addEventListener("change", () => onManyFiles("receipts", "#receipt-files"));
$("#support-files").addEventListener("change", () => onManyFiles("support", "#support-files"));
$("#generate-pdf").addEventListener("click", generatePdf);
$("#pdf-reviewed").addEventListener("change", () => $("#download-pdf").classList.toggle("hidden", !checked("pdf-reviewed")));
$("#concur-plan").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-copy]");
  if (!button || !button.dataset.copy) return;
  try { await navigator.clipboard.writeText(button.dataset.copy); button.textContent = "Copied"; setTimeout(() => { button.textContent = "Copy"; }, 1300); }
  catch { showError("Clipboard access was blocked by this browser. Select and copy the value manually."); }
});
fileStatus();
window.addEventListener("pagehide", () => { void stopOcr(); });
renderReview();
