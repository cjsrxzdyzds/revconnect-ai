import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'public', 'reimbursement', 'vendor');
await mkdir(target, { recursive: true });
for (const [source, name] of [
  ['node_modules/pdfjs-dist/build/pdf.mjs', 'pdf.mjs'],
  ['node_modules/pdfjs-dist/build/pdf.worker.mjs', 'pdf.worker.mjs'],
  ['node_modules/pdfjs-dist/LICENSE', 'PDFJS-LICENSE'],
  ['node_modules/pdf-lib/dist/pdf-lib.min.js', 'pdf-lib.min.js'],
  ['node_modules/pdf-lib/LICENSE.md', 'PDF-LIB-LICENSE.md'],
  ['node_modules/tesseract.js/dist/tesseract.esm.min.js', 'tesseract.esm.min.js'],
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['node_modules/tesseract.js/LICENSE.md', 'TESSERACT-LICENSE.md'],
  ['node_modules/tesseract.js/dist/worker.min.js.LICENSE.txt', 'TESSERACT-WORKER-LICENSE.txt'],
  ['node_modules/tesseract.js/dist/tesseract.min.js.LICENSE.txt', 'TESSERACT-BUNDLE-LICENSE.txt'],
  ['node_modules/tesseract.js-core/LICENSE', 'TESSERACT-CORE-LICENSE'],
  ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'eng.traineddata.gz'],
]) {
  await copyFile(join(root, source), join(target, name));
}
for (const variant of ['lstm', 'simd-lstm', 'relaxedsimd-lstm']) {
  for (const extension of ['wasm.js', 'wasm']) {
    const name = `tesseract-core-${variant}.${extension}`;
    await copyFile(join(root, 'node_modules', 'tesseract.js-core', name), join(target, name));
  }
}
console.log('Bundled local PDF libraries for the reimbursement page.');
