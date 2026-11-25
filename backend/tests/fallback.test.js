import test from 'node:test';
import assert from 'node:assert/strict';

import { UpstreamError, fallbackModel, primaryModel, withModelFallback } from '../groq.js';
import { buildGenerateRequest, generateStudySet } from '../pipeline.js';

process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || 'test-key';

function withEnv(t, values) {
  const saved = Object.fromEntries(Object.keys(values).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

const fail = (code) => new UpstreamError(code, code, { status: 502, retryable: true });

test('fallbackModel defaults to a second model, is configurable, and can be turned off', (t) => {
  withEnv(t, { GROQ_FALLBACK_MODEL: undefined });
  assert.equal(fallbackModel(), 'qwen/qwen3.8-27b');
  process.env.GROQ_FALLBACK_MODEL = ' my/model ';
  assert.equal(fallbackModel(), 'my/model');
  process.env.GROQ_FALLBACK_MODEL = 'none';
  assert.equal(fallbackModel(), null);
  process.env.GROQ_FALLBACK_MODEL = '';
  assert.equal(fallbackModel(), null);
});

test('withModelFallback uses the primary model when it works', async (t) => {
  withEnv(t, { GROQ_MODEL: 'primary', GROQ_FALLBACK_MODEL: 'backup' });
  const seen = [];
  const result = await withModelFallback(async (model) => (seen.push(model), { model }));
  assert.deepEqual(seen, ['primary']);
  assert.deepEqual(result, { model: 'primary' });
});

test('withModelFallback retries once with the backup on a rate limit or provider outage', async (t) => {
  withEnv(t, { GROQ_MODEL: 'primary', GROQ_FALLBACK_MODEL: 'backup' });
  t.mock.method(console, 'warn', () => {});
  for (const code of ['rate_limited', 'provider_down']) {
    const seen = [];
    const result = await withModelFallback(async (model) => {
      seen.push(model);
      if (model === 'primary') throw fail(code);
      return { model };
    });
    assert.deepEqual(seen, ['primary', 'backup'], code);
    assert.deepEqual(result.fallback, { from: 'primary', to: 'backup', reason: code });
  }
});

test('withModelFallback does not retry failures another model would not fix', async (t) => {
  withEnv(t, { GROQ_MODEL: 'primary', GROQ_FALLBACK_MODEL: 'backup' });
  for (const error of [fail('timeout'), fail('bad_key'), fail('too_long'), fail('client_aborted'), new Error('bug')]) {
    let calls = 0;
    await assert.rejects(
      withModelFallback(async () => {
        calls++;
        throw error;
      }),
      error
    );
    assert.equal(calls, 1, error.code ?? error.message);
  }
});

test('withModelFallback does not retry when there is no distinct backup', async (t) => {
  for (const backup of ['none', 'primary']) {
    withEnv(t, { GROQ_MODEL: 'primary', GROQ_FALLBACK_MODEL: backup });
    let calls = 0;
    await assert.rejects(
      withModelFallback(async () => {
        calls++;
        throw fail('rate_limited');
      }),
      /rate_limited/
    );
    assert.equal(calls, 1, backup);
  }
});

test('a rate-limited primary is reported in meta when the backup generates the set', async (t) => {
  withEnv(t, { GROQ_MODEL: 'primary/model', GROQ_FALLBACK_MODEL: 'backup/model' });
  t.mock.method(console, 'warn', () => {});
  const models = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const { model } = JSON.parse(init.body);
    models.push(model);
    if (model === 'primary/model') {
      return new Response(JSON.stringify({ error: { message: 'Rate limit' } }), { status: 429 });
    }
    const content = JSON.stringify({ title: 'Bio', flashcards: [{ front: 'a?', back: 'b' }], quiz: [] });
    return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), {
      status: 200,
    });
  });

  const { meta } = await generateStudySet(buildGenerateRequest({ input: 'Cells' }));
  assert.deepEqual(models, ['primary/model', 'backup/model']);
  assert.equal(meta.model, 'backup/model');
  assert.deepEqual(meta.fallback, { from: 'primary/model', to: 'backup/model', reason: 'rate_limited' });
  assert.equal(primaryModel(), 'primary/model');
});
