import { createWorker } from 'tesseract.js';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { suggestReceipt } from '../public/reimbursement/core.js';
const [manifestPath, reportPath] = process.argv.slice(2);
if (!manifestPath || !reportPath) throw new Error('Usage: node scripts/benchmark_local_ocr.mjs MANIFEST REPORT');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const worker = await createWorker('eng', 1, { langPath: resolve('public/reimbursement/vendor'), cacheMethod: 'none' });
const results = [];
try {
  await worker.setParameters({ user_defined_dpi: '300', preserve_interword_spaces: '1', tessedit_pageseg_mode: '3' });
  for (const item of manifest) {
    const started = performance.now();
    const { data } = await worker.recognize(resolve(dirname(manifestPath), item.file), { rotateAuto: true });
    const hints = suggestReceipt(data.text);
    const matches = Object.fromEntries(Object.entries(item.expected).map(([key, value]) => [key, hints[key] === value]));
    results.push({ id: item.id, variant: item.variant, milliseconds: Math.round(performance.now() - started), matches, allFieldsMatch: Object.values(matches).every(Boolean), confidence: data.confidence });
  }
} finally { await worker.terminate(); }
const report = { generatedAt: new Date().toISOString(), method: 'Tesseract AUTO baseline; browser multi-pass recovery not included', dataset: 'synthetic; not real-receipt accuracy', total: results.length, exactMatches: results.filter(row => row.allFieldsMatch).length, results };
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({total: report.total, exactMatches: report.exactMatches}));
