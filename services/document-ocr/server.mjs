import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { MAX_BYTES, processImage } from './processor.mjs';

let cachedToken;
async function accessToken() {
  if (cachedToken?.until > Date.now()) return cachedToken.value;
  const response = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
    headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('Service identity unavailable.');
  const token = await response.json();
  cachedToken = { value: token.access_token, until: Date.now() + Math.max(0, token.expires_in - 60) * 1000 };
  return cachedToken.value;
}

export function createServer({ process = processImage, token = accessToken, processor = globalThis.process.env.DOCUMENT_AI_PROCESSOR, staticRoot = fileURLToPath(new URL('./web', import.meta.url)) } = {}) {
  let active = 0;
  return http.createServer(async (request, response) => {
    const reply = (status, body) => {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(JSON.stringify(body));
    };
    if (request.url === '/api/ocr/config' && request.method === 'GET') return reply(200, { enabled: Boolean(processor) });
    if (['/healthz', '/api/health'].includes(request.url) && request.method === 'GET') return reply(200, { status: 'ok', configured: Boolean(processor) });
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/' && request.method === 'GET') { response.writeHead(302, { Location: '/reimbursement/' }); return response.end(); }
    if (pathname.startsWith('/reimbursement/') && request.method === 'GET') {
      try {
        const path = resolve(staticRoot, '.' + decodeURIComponent(pathname) + (pathname.endsWith('/') ? 'index.html' : ''));
        if (!path.startsWith(resolve(staticRoot) + '/')) return reply(404, { error: 'Not found' });
        const bytes = await readFile(path);
        const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' };
        response.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream',
          'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
          'Content-Security-Policy': "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' blob: data:; font-src 'self'; worker-src 'self'; frame-src blob:; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'" });
        return response.end(bytes);
      } catch { return reply(404, { error: 'Not found' }); }
    }
    if (request.url !== '/v1/ocr') return reply(404, { error: 'Not found' });
    if (request.method !== 'POST') return reply(405, { error: 'Method not allowed' });
    // Cloud Run IAM must enforce authentication before traffic reaches this service.
    if (!processor) return reply(503, { error: 'OCR is not configured.' });
    if (active >= 2) return reply(429, { error: 'OCR busy. Retry later.' });
    const mime = (request.headers['content-type'] || '').split(';')[0];
    if (!['image/png', 'image/jpeg'].includes(mime)) return reply(415, { error: 'PNG or JPEG required.' });
    if (Number(request.headers['content-length']) > MAX_BYTES) return reply(413, { error: '12 MB image limit.' });
    active++;
    try {
      const chunks = []; let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > MAX_BYTES) { reply(413, { error: '12 MB image limit.' }); return; }
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      const { validateImage } = await import('./processor.mjs');
      try { validateImage(bytes, mime); } catch (error) { return reply(400, { error: error.message }); }
      const result = await process(bytes, mime, { processor, accessToken: await token() });
      reply(200, result);
    } catch {
      // No original document, model response, credentials, or student data in logs.
      reply(502, { error: 'Cloud OCR failed. Retry or use local OCR; review the original.' });
    } finally { active--; }
  });
}

if (globalThis.process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = createServer();
  server.requestTimeout = 100000;
  server.listen(Number(globalThis.process.env.PORT || 8080), '0.0.0.0');
}
