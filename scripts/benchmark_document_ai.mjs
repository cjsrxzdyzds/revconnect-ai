// Live evaluation before Cloud Run deployment. gcloud credentials stay in memory.
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { processImage } from '../services/document-ocr/processor.mjs';
import { suggestReceipt } from '../public/reimbursement/core.js';

const [manifestPath, processor, reportPath] = process.argv.slice(2);
if (!manifestPath || !processor || !reportPath) throw new Error('Usage: node scripts/benchmark_document_ai.mjs MANIFEST PROCESSOR REPORT');
const accessToken = execFileSync(process.env.GCLOUD_BIN || 'gcloud', ['auth', 'print-access-token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const results = [];
for (const item of manifest) {
  const bytes = await readFile(resolve(dirname(manifestPath), item.file));
  const started = performance.now();
  try {
    const output = await processImage(bytes, item.mimeType || 'image/png', { processor, accessToken });
    const hints = suggestReceipt(output.text);
    const matches = Object.fromEntries(Object.entries(item.expected).map(([field, value]) => [field, hints[field] === value]));
    results.push({ id: item.id, variant: item.variant, milliseconds: Math.round(performance.now() - started), matches,
      allFieldsMatch: Object.values(matches).every(Boolean), confidence: output.confidence,
      quality: output.pages.map(page => page.quality), sourceSha256: output.sourceSha256, verified: output.verified });
    console.log(`${item.id}: ${Object.values(matches).every(Boolean) ? 'exact' : 'needs review'}`);
  } catch (error) { results.push({ id: item.id, error: error.message }); console.log(`${item.id}: ${error.message}`); }
}
const completed = results.filter(row => !row.error);
const report = { generatedAt: new Date().toISOString(), processor, dataset: 'ten synthetic receipts, five variants; not real-receipt accuracy',
  total: results.length, completed: completed.length, exactMatches: completed.filter(row => row.allFieldsMatch).length, results };
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ total: report.total, completed: report.completed, exactMatches: report.exactMatches }));
if (completed.length !== results.length) process.exitCode = 1;
