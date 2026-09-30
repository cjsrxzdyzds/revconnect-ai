// OCR stays in the browser; engine and language data come from this site.
import { suggestReceipt, suggestRequest } from './core.js';
let workerPromise;
let currentProgress;
let queue = Promise.resolve();
const MAX_RENDER_PIXELS = 12_000_000;
const MAX_IMAGE_EDGE = 3600;

export function pageNeedsOcr(text, { imageCoverage = 0, kind = 'request', force = false } = {}) {
  if (force || imageCoverage >= 0.20) return true;
  const plain = String(text || '');
  if (plain.replace(/[^A-Za-z0-9]/g, '').length < 80) return true;
  // Selectable text can include hidden website sidebars or lack receipt fields.
  // Render the visible page when it cannot provide a useful expense suggestion.
  if (kind === 'receipt') {
    const hint = suggestReceipt(plain);
    return !hint.total || !hint.purchaseDate || !hint.vendor || /\bPast Orders\b|\bReorder\b/i.test(plain);
  }
  return /\uFFFD/.test(plain);
}

export function extractionScore(text, kind = 'receipt') {
  const hint = kind === 'request' ? suggestRequest(text) : suggestReceipt(text);
  const keys = kind === 'request' ? ['requestId', 'requestedAmount', 'recipient', 'organization', 'submitter', 'submittedDate'] : ['total', 'purchaseDate', 'vendor', 'paidEvidence', 'cardEvidence'];
  return keys.reduce((sum, key) => sum + (hint[key] ? 1 : 0), 0);
}

async function worker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { default: Tesseract } = await import('./vendor/tesseract.esm.min.js');
      const base = new URL('./vendor/', import.meta.url);
      const engine = await Tesseract.createWorker('eng', 1, {
        workerPath: new URL('worker.min.js', base).href, corePath: base.href,
        langPath: base.href.slice(0, -1), workerBlobURL: false, cacheMethod: 'none',
        logger: ({ status, progress }) => {
          if (status === 'recognizing text' && Number.isFinite(progress)) currentProgress?.(`Reading scan: ${Math.round(progress * 100)}%`);
          else if (status.includes('loading') || status.includes('initializing')) currentProgress?.('Loading local English OCR engine…');
        },
      });
      await engine.setParameters({ user_defined_dpi: '300', preserve_interword_spaces: '1' });
      return engine;
    })().catch((error) => { workerPromise = undefined; throw error; });
  }
  return workerPromise;
}

function rotate(canvas, degrees) {
  const result = document.createElement('canvas');
  const sideways = degrees === 90 || degrees === 270;
  result.width = sideways ? canvas.height : canvas.width;
  result.height = sideways ? canvas.width : canvas.height;
  const context = result.getContext('2d', { alpha: false });
  context.fillStyle = '#fff'; context.fillRect(0, 0, result.width, result.height);
  context.translate(result.width / 2, result.height / 2);
  context.rotate(degrees * Math.PI / 180);
  context.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return result;
}

function contrast(canvas) {
  const output = rotate(canvas, 0);
  const context = output.getContext('2d', { willReadFrequently: true });
  const pixels = context.getImageData(0, 0, output.width, output.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const gray = .299*pixels.data[i] + .587*pixels.data[i+1] + .114*pixels.data[i+2];
    const value = Math.max(0, Math.min(255, (gray - 128)*1.35 + 145));
    pixels.data[i] = pixels.data[i+1] = pixels.data[i+2] = value;
  }
  context.putImageData(pixels, 0, 0);
  return output;
}

export function recognizeCanvas(canvas, onProgress, kind = 'receipt') {
  // A Tesseract worker cannot safely run overlapping recognize/setParameters jobs.
  const job = queue.then(async () => {
    currentProgress = onProgress;
    const engine = await worker();
    let best;
    const score = (item) => extractionScore(item.text, kind)*18 + item.confidence*.5 + Math.min(item.text.replace(/[^A-Za-z0-9]/g, '').length, 300)/30;
    const attempt = async (source, mode, rotation = 0, preprocessing = 'original') => {
      await engine.setParameters({ tessedit_pageseg_mode: mode });
      const { data } = await engine.recognize(source, { rotateAuto: true });
      const candidate = { text: data.text || '', confidence: data.confidence ?? 0, rotation, preprocessing, mode };
      if (!best || score(candidate) > score(best)) best = candidate;
    };
    // AUTO handles forms/tables and separated receipt blocks; SINGLE_BLOCK was
    // the old default and often dropped separated totals/payment sections.
    await attempt(canvas, '3');
    if (best.confidence < 82 || extractionScore(best.text, kind) < 4) {
      onProgress?.('Checking sparse text and receipt layout…');
      await attempt(canvas, '11');
    }
    if (best.confidence < 72 || extractionScore(best.text, kind) < 3) {
      const cleaned = contrast(canvas);
      try { onProgress?.('Improving scan contrast…'); await attempt(cleaned, '6', 0, 'contrast'); }
      finally { cleaned.width = cleaned.height = 0; }
    }
    if (best.confidence < 65 || best.text.replace(/[^A-Za-z0-9]/g, '').length < 30) {
      for (const degrees of [90, 180, 270]) {
        onProgress?.(`Checking scan orientation ${degrees}°…`);
        const rotated = rotate(canvas, degrees);
        try { await attempt(rotated, '3', degrees); }
        finally { rotated.width = rotated.height = 0; }
        if (best.confidence >= 82 && extractionScore(best.text, kind) >= 4) break;
      }
    }
    return best;
  }).finally(() => { currentProgress = undefined; });
  queue = job.catch(() => {});
  return job;
}

export async function recognizePdfPage(page, onProgress, kind = 'request') {
  const viewport = page.getViewport({ scale: 1 });
  const scale = Math.min(4.17, Math.sqrt(MAX_RENDER_PIXELS / (viewport.width * viewport.height)));
  const rendered = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(rendered.width); canvas.height = Math.ceil(rendered.height);
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('This browser cannot render a scanned PDF page.');
  try {
    await page.render({ canvasContext: context, viewport: rendered, background: '#ffffff' }).promise;
    return await recognizeCanvas(canvas, onProgress, kind);
  } finally { canvas.width = canvas.height = 0; }
}

export async function recognizeImage(file, onProgress, kind = 'receipt') {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(3, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height), Math.sqrt(MAX_RENDER_PIXELS / (bitmap.width*bitmap.height)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width*scale)); canvas.height = Math.max(1, Math.round(bitmap.height*scale));
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) { bitmap.close(); throw new Error('This browser cannot read the selected image.'); }
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
  try { return await recognizeCanvas(canvas, onProgress, kind); }
  finally { canvas.width = canvas.height = 0; }
}

export async function stopOcr() {
  if (!workerPromise) return;
  const current = workerPromise; workerPromise = undefined;
  try { await (await current).terminate(); } catch { /* Worker was not initialized. */ }
}
