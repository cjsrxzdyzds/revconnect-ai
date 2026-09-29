import { centsToMoney, moneyToCents } from "./core.js";

async function drawCover(pdf, lib, caseData) {
  const { StandardFonts, rgb } = lib;
  const page = pdf.addPage([612, 792]);
  const ink = rgb(0.05, 0.20, 0.30);
  const muted = rgb(0.34, 0.43, 0.49);
  const accent = rgb(0.80, 0.64, 0.31);
  const helvetica = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawRectangle({ x: 0, y: 720, width: 612, height: 72, color: ink });
  page.drawText("ORG HELP FINANCE", { x: 46, y: 752, size: 12, font: helvetica, color: accent });
  page.drawText("Reimbursement Request", { x: 46, y: 731, size: 18, font: helvetica, color: rgb(1, 1, 1) });
  page.drawText("Prepared evidence cover - staff review required", { x: 46, y: 680, size: 10, font: helvetica, color: muted });
  const fields = [
    ["Name", "Student Name", caseData.recipient || "", 618],
    ["GWID", "GWID", caseData.gwid || "", 533],
    ["Student Org", "Student Organization", caseData.organization || "", 448],
    ["Amount", "Amount", centsToMoney(moneyToCents(caseData.requestedAmount)), 363],
  ];
  const form = pdf.getForm();
  for (const [fieldName, label, value, y] of fields) {
    page.drawText(label.toUpperCase(), { x: 46, y: y + 36, size: 9, font: helvetica, color: muted });
    const field = form.createTextField(fieldName);
    field.setText(value);
    field.addToPage(page, {
      x: 46, y, width: 520, height: 31,
      fontSize: value.length > 50 ? 9 : value.length > 34 ? 11 : 13,
      textColor: ink,
      backgroundColor: rgb(0.97, 0.98, 0.98),
      borderColor: rgb(0.76, 0.82, 0.84), borderWidth: 1,
    });
  }
  page.drawText(`RevConnect request #${caseData.requestId || "unverified"}`, { x: 46, y: 282, size: 10, font: helvetica, color: ink });
  page.drawText("The following pages preserve the submitted request, original invoices/receipts, and support.", { x: 46, y: 257, size: 9, font: helvetica, color: muted });
  page.drawText("This document is not proof of approval, Concur submission, or payment.", { x: 46, y: 242, size: 9, font: helvetica, color: muted });
  page.drawLine({ start: { x: 46, y: 61 }, end: { x: 566, y: 61 }, thickness: 1, color: rgb(0.82, 0.86, 0.87) });
  page.drawText("ORG HELP FINANCE  /  REIMBURSEMENT EVIDENCE", { x: 46, y: 42, size: 8, font: helvetica, color: muted });
}

function extension(name) {
  return String(name || "").split(".").pop().toLowerCase();
}

async function appendFile(pdf, lib, source, kind) {
  if (!source?.bytes) throw new Error(`Missing ${kind} file bytes.`);
  const bytes = source.bytes instanceof Uint8Array ? source.bytes : new Uint8Array(source.bytes);
  const type = extension(source.name);
  const start = pdf.getPageCount() + 1;
  if (type === "pdf" || source.mime === "application/pdf") {
    const original = await lib.PDFDocument.load(bytes);
    const copied = await pdf.copyPages(original, original.getPageIndices());
    for (const page of copied) pdf.addPage(page);
  } else if (type === "png" || source.mime === "image/png" || type === "jpg" || type === "jpeg" || source.mime === "image/jpeg") {
    const image = type === "png" || source.mime === "image/png" ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    const page = pdf.addPage([612, 792]);
    const maxW = 544, maxH = 724;
    const scale = Math.min(maxW / image.width, maxH / image.height, 1);
    const width = image.width * scale, height = image.height * scale;
    page.drawImage(image, { x: (612 - width) / 2, y: (792 - height) / 2, width, height });
  } else {
    throw new Error(`${source.name || "File"}: use PDF, PNG, or JPEG. Convert other formats before combining.`);
  }
  const end = pdf.getPageCount();
  if (end < start) throw new Error(`${source.name}: no pages were found.`);
  return { kind, name: source.name, firstPage: start, lastPage: end, sha256: source.sha256 || "" };
}

export async function buildCombinedPdf(lib, caseData, files) {
  if (!files?.request || !files.receipts?.length) throw new Error("Add a CampusGroups printout and at least one receipt.");
  if (!caseData.recipient || !caseData.organization || moneyToCents(caseData.requestedAmount) === null) {
    throw new Error("Verify the recipient, organization, and requested amount before generating the cover.");
  }
  if (!caseData.gwid && !caseData.blankGwidConfirmed) throw new Error("Enter the GWID or explicitly confirm a blank field for this case.");
  const pdf = await lib.PDFDocument.create();
  await drawCover(pdf, lib, caseData);
  const manifest = [{ kind: "cover", name: "Generated reimbursement heading", firstPage: 1, lastPage: 1 }];
  manifest.push(await appendFile(pdf, lib, files.request, "CampusGroups printout"));
  for (const receipt of files.receipts) manifest.push(await appendFile(pdf, lib, receipt, "Original receipt"));
  for (const support of files.support || []) manifest.push(await appendFile(pdf, lib, support, "Supplementary material"));
  const bytes = await pdf.save();
  const reopened = await lib.PDFDocument.load(bytes);
  const expected = { Name: caseData.recipient, GWID: caseData.gwid || "", "Student Org": caseData.organization, Amount: centsToMoney(moneyToCents(caseData.requestedAmount)) };
  for (const [name, value] of Object.entries(expected)) {
    if ((reopened.getForm().getTextField(name).getText() || "") !== value) throw new Error(`The generated cover field ${name} failed verification.`);
  }
  if (reopened.getPageCount() !== manifest.at(-1).lastPage) throw new Error("The generated PDF page count failed verification.");
  return { bytes, manifest, pageCount: reopened.getPageCount() };
}
