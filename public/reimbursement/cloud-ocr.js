let configuration;
export function cloudOcrConfiguration(fetcher = fetch) {
  if (!configuration) configuration = fetcher('/api/ocr/config', { cache: 'no-store', signal: AbortSignal.timeout(5000) })
    .then(response => response.ok ? response.json() : null)
    .then(body => body?.enabled === true ? body : null).catch(() => null);
  return configuration;
}

export async function recognizeCloudCanvas(canvas, onProgress) {
  if (!await cloudOcrConfiguration()) return null;
  onProgress?.('Reading this page with Google Cloud OCR…');
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob || blob.size > 12 * 1024 * 1024) throw new Error('Rendered page exceeds the cloud OCR limit.');
  const response = await fetch('/v1/ocr', {
    method: 'POST', headers: { 'Content-Type': 'image/png' }, body: blob,
    signal: AbortSignal.timeout(100000), redirect: 'error',
  });
  if (!response.ok) throw new Error(`Cloud OCR unavailable (${response.status}).`);
  const result = await response.json();
  if (typeof result.text !== 'string' || result.provider !== 'google-document-ai') throw new Error('Unexpected cloud OCR response.');
  return { ...result, confidence: Number.isFinite(result.confidence) ? result.confidence : 0, mode: 'document-ai', rotation: 0 };
}
