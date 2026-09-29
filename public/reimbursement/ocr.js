// OCR runs inside the visitor's browser. All code, WASM, and English data are served locally.
let workerPromise;
const MAX_RENDER_PIXELS = 12_000_000;
const MAX_IMAGE_EDGE = 3200;

export function pageNeedsOcr(text) {
  return String(text || "").replace(/[^A-Za-z0-9]/g, "").length < 80;
}

async function worker(onProgress) {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { default: Tesseract } = await import("./vendor/tesseract.esm.min.js");
      const base = new URL("./vendor/", import.meta.url);
      return Tesseract.createWorker("eng", 1, {
        workerPath: new URL("worker.min.js", base).href,
        corePath: base.href,
        langPath: base.href.slice(0, -1),
        workerBlobURL: false,
        cacheMethod: "none",
        logger: ({ status, progress }) => {
          if (status === "recognizing text" && Number.isFinite(progress)) onProgress?.(`Reading scan: ${Math.round(progress * 100)}%`);
        },
      });
    })().catch((error) => {
      workerPromise = undefined;
      throw error;
    });
  }
  return workerPromise;
}

export async function recognizeCanvas(canvas, onProgress) {
  const engine = await worker(onProgress);
  const first = await engine.recognize(canvas);
  let best = { text: first.data.text || "", confidence: first.data.confidence ?? 0, rotation: 0 };
  const score = (item) => item.confidence + Math.min(item.text.replace(/[^A-Za-z0-9]/g, "").length, 120) / 8;
  if (best.confidence >= 70 && best.text.replace(/[^A-Za-z0-9]/g, "").length >= 30) return best;
  // Only uncertain scans pay the cost of orientation recovery.
  for (const degrees of [90, 180, 270]) {
    onProgress?.(`Checking scan orientation ${degrees}°…`);
    const rotated = document.createElement("canvas");
    const sideways = degrees === 90 || degrees === 270;
    rotated.width = sideways ? canvas.height : canvas.width;
    rotated.height = sideways ? canvas.width : canvas.height;
    const context = rotated.getContext("2d", { alpha: false });
    context.translate(rotated.width / 2, rotated.height / 2);
    context.rotate((degrees * Math.PI) / 180);
    context.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    try {
      const result = await engine.recognize(rotated);
      const candidate = { text: result.data.text || "", confidence: result.data.confidence ?? 0, rotation: degrees };
      if (score(candidate) > score(best)) best = candidate;
    } finally { rotated.width = 0; rotated.height = 0; }
  }
  return best;
}

export async function recognizePdfPage(page, onProgress) {
  const viewport = page.getViewport({ scale: 1 });
  const scale = Math.min(2.8, Math.sqrt(MAX_RENDER_PIXELS / (viewport.width * viewport.height)));
  const rendered = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(rendered.width);
  canvas.height = Math.ceil(rendered.height);
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("This browser cannot render a scanned PDF page.");
  await page.render({ canvasContext: context, viewport: rendered }).promise;
  try { return await recognizeCanvas(canvas, onProgress); }
  finally { canvas.width = 0; canvas.height = 0; }
}

export async function recognizeImage(file, onProgress) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(2, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("This browser cannot read the selected image.");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  try { return await recognizeCanvas(canvas, onProgress); }
  finally { canvas.width = 0; canvas.height = 0; }
}

export async function stopOcr() {
  if (!workerPromise) return;
  const current = workerPromise;
  workerPromise = undefined;
  try { (await current).terminate(); } catch { /* Worker was not initialized. */ }
}
