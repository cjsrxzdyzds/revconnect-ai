import test from 'node:test';
import assert from 'node:assert/strict';

test('public deployment with no cloud configuration never uploads a canvas', async () => {
  const client = await import('../public/reimbursement/cloud-ocr.js?local');
  assert.equal(await client.cloudOcrConfiguration(async () => new Response('', { status: 404 })), null);
  let rendered = false;
  assert.equal(await client.recognizeCloudCanvas({ toBlob() { rendered = true; } }), null);
  assert.equal(rendered, false);
});

test('private cloud UI sends PNG to same origin and retains unverified evidence', async () => {
  const client = await import('../public/reimbursement/cloud-ocr.js?cloud');
  await client.cloudOcrConfiguration(async () => Response.json({ enabled: true }));
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, '/v1/ocr');
      assert.equal(options.headers['Content-Type'], 'image/png');
      assert.equal(options.redirect, 'error');
      return Response.json({ text: 'TOTAL 38.80', provider: 'google-document-ai', confidence: 95, verified: false, pages: [{ page: 1 }] });
    };
    const result = await client.recognizeCloudCanvas({ toBlob(callback) { callback(new Blob(['synthetic'])); } });
    assert.equal(result.verified, false);
    assert.equal(result.pages.length, 1);
    assert.equal(result.mode, 'document-ai');
    globalThis.fetch = async () => new Response('', { status: 503 });
    await assert.rejects(client.recognizeCloudCanvas({ toBlob(callback) { callback(new Blob(['synthetic'])); } }), /503/);
  } finally { globalThis.fetch = original; }
});
