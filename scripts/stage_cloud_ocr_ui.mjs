// Explicitly copy only published reimbursement assets into the service build.
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
const target = new URL('../services/document-ocr/web/reimbursement/', import.meta.url);
await mkdir(target, { recursive: true });
await cp(new URL('../public/reimbursement/', import.meta.url), target, { recursive: true });
const index = new URL('index.html', target);
let html = await readFile(index, 'utf8');
html = html.replace('Files stay in this browser session', 'Google Cloud OCR · staff review required')
  .replace('Local preparation only. Nothing here creates, approves, submits, or pays a Concur expense report. Case files are not sent to this site.', 'Preparation only. Nothing here creates, approves, submits, or pays a Concur expense report. Scanned pages and receipt images are processed by Google Cloud OCR; this service does not save case files.')
  .replace('Selectable text is read directly; scanned request and receipt pages use local English OCR. Verify every suggestion against the original.', 'Scanned pages and receipt images are sent to Google Cloud Document AI. This service does not save case files; PDF assembly stays in your browser. Verify every suggestion.')
  .replaceAll('href="/"', 'href="https://cjsrxzdyzds.com/"')
  .replaceAll('href="/#', 'href="https://cjsrxzdyzds.com/#');
await writeFile(index, html);
console.log('Staged only published reimbursement assets for the private cloud service.');
