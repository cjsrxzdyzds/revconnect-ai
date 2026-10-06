import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { validateImage, normalizeDocument, processImage, MAX_BYTES } from '../services/document-ocr/processor.mjs';
import { createServer } from '../services/document-ocr/server.mjs';

const png = Buffer.from([137,80,78,71,13,10,26,10,0]);
const processor = 'projects/test-project/locations/us/processors/test';

test('rejects disguised files, empty uploads, and oversized images before paid calls', () => {
  assert.throws(() => validateImage(Buffer.from('<script>'), 'image/png'));
  assert.throws(() => validateImage(png, 'image/jpeg'));
  assert.throws(() => validateImage(Buffer.alloc(0), 'image/png'));
  assert.throws(() => validateImage(Buffer.alloc(MAX_BYTES + 1), 'image/png'));
  validateImage(png, 'image/png');
});

test('retains source locations and quality defects without verifying extracted facts', () => {
  const result = normalizeDocument({ text: 'TOTAL 38.80', pages: [{
    pageNumber: 1, imageQualityScores: { qualityScore: .3, detectedDefects: [{ type: 'quality/defect_blurry' }] },
    lines: [{ layout: { textAnchor: { textSegments: [{ endIndex: '11' }] }, confidence: .9, boundingPoly: { normalizedVertices: [{x:.1,y:.2}] } } }],
    tokens: [{ layout: { confidence: .8 } }],
  }] }, png);
  assert.equal(result.pages[0].lines[0].text, 'TOTAL 38.80');
  assert.equal(result.pages[0].quality.qualityScore, .3);
  assert.equal(result.confidence, 80);
  assert.equal(result.verified, false);
  assert.equal(result.needsReview, true);
  assert.match(result.sourceSha256, /^[a-f0-9]{64}$/);
  assert.equal(normalizeDocument({}, png).confidence, null);
});

test('Document AI uses configured regional endpoint and explicit quality analysis', async () => {
  let called = false;
  await processImage(png, 'image/png', { processor, accessToken: 'test-only', fetcher: async (url, options) => {
    called = true;
    assert.equal(url, `https://us-documentai.googleapis.com/v1/${processor}:process`);
    const body = JSON.parse(options.body);
    assert.equal(body.processOptions.ocrConfig.enableImageQualityScores, true);
    assert.equal(body.rawDocument.content, png.toString('base64'));
    return Response.json({ document: { text: 'synthetic' } });
  }});
  assert.equal(called, true);
  await assert.rejects(processImage(png, 'image/png', { processor: 'https://unexpected.example', accessToken: 'test' }));
});

async function withServer(options, run) {
  const server = createServer({ processor, token: async () => 'test-only', ...options });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('HTTP rejects invalid input without calling provider and does not cache financial results', async () => {
  let count = 0;
  await withServer({ process: async () => { count++; return { text: 'TOTAL 38.80', verified: false }; } }, async base => {
    assert.equal((await fetch(`${base}/v1/ocr`)).status, 405);
    assert.equal((await fetch(`${base}/v1/ocr`, { method: 'POST', body: 'invalid' })).status, 415);
    assert.equal((await fetch(`${base}/v1/ocr`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: 'invalid' })).status, 400);
    assert.equal(count, 0);
    const good = await fetch(`${base}/v1/ocr`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png });
    assert.equal(good.status, 200);
    assert.equal(good.headers.get('cache-control'), 'no-store');
    assert.equal((await good.json()).verified, false);
    assert.equal(count, 1);
  });
});

test('provider failures do not disclose upstream contents or credentials', async () => {
  await withServer({ process: async () => { throw new Error('private student data and token'); } }, async base => {
    const response = await fetch(`${base}/v1/ocr`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png });
    assert.equal(response.status, 502);
    assert.doesNotMatch(await response.text(), /student|token/);
  });
});

test('missing processor fails closed and health reports configuration accurately', async () => {
  await withServer({ processor: '' }, async base => {
    assert.equal((await (await fetch(`${base}/healthz`)).json()).configured, false);
    assert.equal((await (await fetch(`${base}/api/ocr/config`)).json()).enabled, false);
    assert.equal((await fetch(`${base}/v1/ocr`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png })).status, 503);
  });
});

test('concurrency cap rejects a third request before another paid provider call', async () => {
  let release, ready;
  const pending = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { ready = resolve; });
  let count = 0;
  await withServer({ process: async () => { if (++count === 2) ready(); await pending; return { text: '' }; } }, async base => {
    const send = () => fetch(`${base}/v1/ocr`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png });
    const first = send(), second = send();
    try {
      await started;
      assert.equal((await send()).status, 429);
      assert.equal(count, 2);
    } finally { release(); await Promise.all([first, second]); }
  });
});
