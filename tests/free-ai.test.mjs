import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AI_MODEL, DAILY_CALL_LIMIT, MAX_OUTPUT_TOKENS, MAX_PROMPT_BYTES, subscriptionsAreFree, verifyFreeAccount, buildPrompt, handleAsk, FreeAiBudget } from '../src/free-ai.js';

const data = JSON.parse(await readFile(new URL('../public/data.json', import.meta.url)));
const question = 'Recommend groups for AI and consulting';
const account = 'a'.repeat(32);
function request(body = { question }, headers = {}) {
  return new Request('https://example.org/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
}
function fixture() {
  const calls = [];
  const env = {
    AI_ENABLED: 'true', CF_ACCOUNT_ID: account, CF_BILLING_READ_TOKEN: 'test-only',
    AI: { run: async (...args) => { calls.push(args); return { response: 'Explore the listed groups and confirm membership on their official pages [1].' }; } },
    AI_BUDGET: { idFromName: name => name, get: () => ({ fetch: async () => Response.json({ allowed: true }) }) },
  };
  const load = async () => ({ data, events: [] });
  const fetcher = async () => Response.json({ success: true, result: [] });
  return { env, calls, load, fetcher };
}

test('free proof rejects paid, partial, contract and undocumented subscriptions', () => {
  assert.equal(subscriptionsAreFree({ success: true, result: [] }), true);
  assert.equal(subscriptionsAreFree({ success: true, result: [{ price: 0, rate_plan: { id: 'free' } }] }), true);
  for (const payload of [null, { result: [] }, { success: false, result: [] }, { success: true },
    { success: true, result: [{ price: 5, rate_plan: { id: 'workers_paid' } }] },
    { success: true, result: [{ rate_plan: { id: 'free' } }] },
    { success: true, result: [{ price: 0, rate_plan: { id: 'enterprise', is_contract: true } }] },
    { success: true, result: [{ price: 0, rate_plan: { id: 'free', externally_managed: true } }] },
  ]) assert.equal(subscriptionsAreFree(payload), false);
});
test('missing credentials and subscription errors fail closed', async () => {
  const { env } = fixture();
  assert.equal(await verifyFreeAccount({}), false);
  for (const fetcher of [async () => new Response('', { status: 403 }), async () => { throw new Error('offline'); }, async () => Response.json({ success: false, result: [] })]) {
    assert.equal(await verifyFreeAccount(env, fetcher), false);
  }
});
test('subscription check goes only to the configured Cloudflare account', async () => {
  const { env } = fixture();
  await verifyFreeAccount(env, async (url, options) => {
    assert.equal(url, `https://api.cloudflare.com/client/v4/accounts/${account}/subscriptions`);
    assert.equal(options.headers.Authorization, 'Bearer test-only');
    return Response.json({ success: true, result: [] });
  });
});
test('request validation rejects oversized, non-English and client-supplied context', async () => {
  const { env, calls, load, fetcher } = fixture();
  for (const body of [{ question: '' }, { question: 'x'.repeat(401) }, { question: '\u4e2d\u6587' }, { question, records: 'fabricated policy' }, { question: 'x'.repeat(3000) }]) {
    assert.equal((await handleAsk(request(body), env, load, fetcher)).status, 400);
  }
  assert.equal(calls.length, 0);
});
test('method and cross-origin requests cannot invoke AI', async () => {
  const { env, calls, load, fetcher } = fixture();
  assert.equal((await handleAsk(new Request('https://example.org/api/ask'), env, load, fetcher)).status, 405);
  assert.equal((await handleAsk(request({ question }, { Origin: 'https://other.org' }), env, load, fetcher)).status, 403);
  assert.equal(calls.length, 0);
});
test('unverified or paid plan never reaches the budget, data or model', async () => {
  const { env, calls } = fixture();
  env.AI_BUDGET.get = () => { throw new Error('must not access budget'); };
  for (const payload of [{ success: true, result: [{ price: 5, rate_plan: { id: 'workers_paid' } }] }, { success: false }]) {
    const response = await handleAsk(request(), env, () => { throw new Error('must not load'); }, async () => Response.json(payload));
    assert.equal((await response.json()).reason, 'free_plan_unverified');
  }
  assert.equal(calls.length, 0);
});
test('disabled or missing budget binding skips inference', async () => {
  for (const change of [{ AI_ENABLED: 'false' }, { AI_BUDGET: undefined }, { AI: undefined }]) {
    const { env, calls, load, fetcher } = fixture();
    Object.assign(env, change);
    assert.equal((await (await handleAsk(request(), env, load, fetcher)).json()).mode, 'rules');
    assert.equal(calls.length, 0);
  }
});
test('daily cap and storage failure prevent model calls', async () => {
  for (const fetch of [async () => Response.json({ allowed: false }), async () => new Response('', { status: 500 }), async () => { throw new Error('storage unavailable'); }]) {
    const { env, calls, load, fetcher } = fixture();
    env.AI_BUDGET.get = () => ({ fetch });
    assert.equal((await (await handleAsk(request(), env, load, fetcher)).json()).mode, 'rules');
    assert.equal(calls.length, 0);
  }
});
test('one bounded inference uses server records and server-generated source links', async () => {
  const { env, calls, load, fetcher } = fixture();
  const result = await (await handleAsk(request(), env, load, fetcher)).json();
  assert.equal(result.mode, 'ai');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], AI_MODEL);
  assert.equal(calls[0][1].max_tokens, MAX_OUTPUT_TOKENS);
  assert.ok(new TextEncoder().encode(JSON.stringify(calls[0][1].messages)).length <= MAX_PROMPT_BYTES);
  assert.ok(result.sources.every(source => data.groups.some(group => group.name === source.title && group.url === source.url)));
});
test('failed inference retains reservation and never retries', async () => {
  const { env, load, fetcher } = fixture();
  let reservations = 0, inferences = 0;
  env.AI_BUDGET.get = () => ({ fetch: async () => { reservations++; return Response.json({ allowed: true }); } });
  env.AI.run = async () => { inferences++; throw new Error('quota exhausted'); };
  assert.equal((await (await handleAsk(request(), env, load, fetcher)).json()).mode, 'rules');
  assert.equal(reservations, 1);
  assert.equal(inferences, 1);
});
test('empty, non-English, HTML and generated URLs are rejected', async () => {
  for (const answer of ['', '\u4e2d\u6587', '<script>alert(1)</script>', 'Go to https://fake.example']) {
    const { env, load, fetcher } = fixture();
    env.AI.run = async () => ({ response: answer });
    assert.equal((await (await handleAsk(request(), env, load, fetcher)).json()).mode, 'rules');
  }
});
test('no matches and invalid discovery constraints skip AI', async () => {
  const { env, calls, load, fetcher } = fixture();
  for (const question of ['zzzxnonexistent', 'Events with free food']) {
    assert.equal((await (await handleAsk(request({ question }), env, load, fetcher)).json()).reason, 'no_sources');
  }
  assert.equal(calls.length, 0);
});
test('oversized Unicode records fail context budget before inference', () => {
  assert.equal(buildPrompt('x'.repeat(400), Array.from({ length: 3 }, () => ({ title: '\u{1f600}'.repeat(140), type: 'Public event', body: '\u{1f600}'.repeat(600) }))), null);
});
test('daily reservations persist exactly the limit and reset at UTC day', async () => {
  let stored = { day: '2000-01-01', calls: 999 };
  const tx = { get: async () => stored, put: async (_, value) => { stored = value; } };
  const budget = new FreeAiBudget({ storage: { transaction: callback => callback(tx) } });
  for (let i = 0; i < DAILY_CALL_LIMIT; i++) assert.equal((await (await budget.fetch(new Request('https://budget/reserve', { method: 'POST' }))).json()).allowed, true);
  assert.equal((await (await budget.fetch(new Request('https://budget/reserve', { method: 'POST' }))).json()).allowed, false);
  assert.equal(stored.calls, DAILY_CALL_LIMIT);
  // New instance uses the persisted same-day cap, rather than resetting it.
  const restarted = new FreeAiBudget({ storage: { transaction: callback => callback(tx) } });
  assert.equal((await (await restarted.fetch(new Request('https://budget/reserve', { method: 'POST' }))).json()).allowed, false);
});
