// Run against a private Cloud Run service via `gcloud run services proxy`.
// Only explicitly listed fixtures are sent. The report contains metrics, not OCR text.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { suggestReceipt } from '../public/reimbursement/core.js';

const [manifestPath, baseUrl, reportPath] = process.argv.slice(2);
if (!manifestPath || !baseUrl || !reportPath) throw new Error('Usage: node scripts/benchmark_cloud_ocr.mjs MANIFEST http://127.0.0.1:8080 REPORT.json');
const endpoint = new URL('/v1/ocr', baseUrl);
if (!['127.0.0.1', 'localhost'].includes(endpoint.hostname)) throw new Error('Use an authenticated local Cloud Run proxy.');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const results = [];
for (const item of manifest) {
  const bytes = await readFile(resolve(dirname(manifestPath), item.file));
  const started = performance.now();
  try {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': item.mimeType || 'image/png' }, body: bytes, signal: AbortSignal.timeout(100000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const output = await response.json();
    const hints = suggestReceipt(output.text);
    const matches = Object.fromEntries(Object.entries(item.expected).map(([field, value]) => [field, hints[field] === value]));
    results.push({ id: item.id, variant: item.variant, milliseconds: Math.round(performance.now() - started), matches,
      allFieldsMatch: Object.values(matches).every(Boolean), confidence: output.confidence,
      quality: output.pages?.map(page => page.quality), sourceSha256: output.sourceSha256, verified: output.verified });
  } catch (error) { results.push({ id: item.id, error: error.message }); }
}
const completed = results.filter(row => !row.error);
const report = { generatedAt: new Date().toISOString(), dataset: 'synthetic; does not establish real-receipt accuracy',
  total: results.length, completed: completed.length, exactMatches: completed.filter(row => row.allFieldsMatch).length, results };
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ total: report.total, completed: report.completed, exactMatches: report.exactMatches }));
if (completed.length !== results.length) process.exitCode = 1;
