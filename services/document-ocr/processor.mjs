import { createHash } from 'node:crypto';

export const MAX_BYTES = 12 * 1024 * 1024;
export function validateImage(bytes, mimeType) {
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error('Image must be between 1 byte and 12 MB.');
  const png = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!(mimeType === 'image/png' && png) && !(mimeType === 'image/jpeg' && jpeg)) throw new Error('Use a PNG or JPEG image. PDF pages must be rendered before processing.');
}

export function normalizeDocument(document, bytes) {
  const text = document.text || '';
  const anchorText = (anchor) => (anchor?.textSegments || []).map(s => text.slice(Number(s.startIndex || 0), Number(s.endIndex))).join('');
  const pages = (document.pages || []).map((page, index) => ({
    page: page.pageNumber || index + 1,
    quality: page.imageQualityScores || null,
    lines: (page.lines || []).map(line => ({
      text: anchorText(line.layout?.textAnchor),
      confidence: line.layout?.confidence ?? null,
      bounds: line.layout?.boundingPoly?.normalizedVertices || [],
    })),
  }));
  const confidences = (document.pages || []).flatMap(p => (p.tokens || []).map(t => t.layout?.confidence).filter(Number.isFinite));
  const confidence = confidences.length ? 100 * confidences.reduce((a,b) => a+b, 0) / confidences.length : null;
  return {
    text, confidence, pages,
    sourceSha256: createHash('sha256').update(bytes).digest('hex'),
    provider: 'google-document-ai', verified: false,
    needsReview: true,
  };
}

export async function processImage(bytes, mimeType, { processor, accessToken, fetcher = fetch }) {
  validateImage(bytes, mimeType);
  const match = /^projects\/[a-zA-Z0-9-]+\/locations\/(us|eu|[a-z]+-[a-z]+\d)\/processors\/[a-zA-Z0-9_-]+(?:\/processorVersions\/[a-zA-Z0-9_.-]+)?$/.exec(processor || '');
  if (!match) throw new Error('Document AI processor is not configured.');
  const response = await fetcher(`https://${match[1]}-documentai.googleapis.com/v1/${processor}:process`, {
    method: 'POST', signal: AbortSignal.timeout(85000),
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ rawDocument: { mimeType, content: bytes.toString('base64') }, imagelessMode: true,
      processOptions: { ocrConfig: { enableImageQualityScores: true } } }),
  });
  if (!response.ok) throw new Error(`Document AI request failed (${response.status}).`);
  const body = await response.json();
  if (!body.document) throw new Error('Document AI returned no document.');
  return { ...normalizeDocument(body.document, bytes), processor };
}
