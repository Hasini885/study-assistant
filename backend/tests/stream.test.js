import test from 'node:test';
import assert from 'node:assert/strict';

import { callGroqStream } from '../groq.js';
import { buildGenerateRequest, generateStudySet, partialStudySet, UpstreamError } from '../pipeline.js';
import { formatEvent, streamStudySet, wantsEventStream } from '../sse.js';

process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || 'test-key';

const FULL = JSON.stringify({
  title: 'Bio',
  summary: 'Cells.',
  flashcards: [
    { front: 'What is ATP?', back: 'Energy currency.' },
    { front: 'What is DNA?', back: 'Genetic material.' },
  ],
  quiz: [{ question: 'Where is the Calvin cycle?', options: ['Stroma', 'Thylakoid'], answerIndex: 0 }],
});

/** A fetch Response whose body arrives as the given SSE chunks. */
function sseResponse(chunks, { breakAfter } = {}) {
  const encoder = new TextEncoder();
  let i = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (breakAfter !== undefined && i === breakAfter) {
        controller.error(new TypeError('terminated'));
        return;
      }
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[i++]));
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

/** Splits `text` into Groq-style delta events, `size` characters each. */
function groqChunks(text, size = 7) {
  const out = [];
  for (let i = 0; i < text.length; i += size) {
    out.push(`data: ${JSON.stringify({ choices: [{ delta: { content: text.slice(i, i + size) } }] })}\n\n`);
  }
  out.push(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`, 'data: [DONE]\n\n');
  // Re-split on arbitrary boundaries so events straddle reads.
  const joined = out.join('');
  const pieces = [];
  for (let i = 0; i < joined.length; i += 23) pieces.push(joined.slice(i, i + 23));
  return pieces;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/* ------------------------------ callGroqStream ----------------------------- */

test('callGroqStream reassembles content from events split across reads', async (t) => {
  let sentBody;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    sentBody = JSON.parse(init.body);
    return sseResponse(groqChunks(FULL));
  });
  const seen = [];
  const result = await callGroqStream({ messages: [], onText: (text) => seen.push(text) });

  assert.equal(sentBody.stream, true);
  assert.deepEqual(sentBody.response_format, { type: 'json_object' });
  assert.equal(result.content, FULL);
  assert.equal(result.finishReason, 'stop');
  assert.ok(seen.length > 10);
  assert.ok(
    seen.every((text, i) => i === 0 || text.startsWith(seen[i - 1])),
    'onText sees a growing prefix'
  );
});

test('callGroqStream reports a broken stream as stream_failed', async (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async () => sseResponse(groqChunks(FULL), { breakAfter: 3 }));
  await assert.rejects(callGroqStream({ messages: [] }), (error) => error.code === 'stream_failed');
});

test('callGroqStream surfaces an error event from the provider', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    sseResponse([`data: ${JSON.stringify({ error: { message: 'overloaded' } })}\n\n`])
  );
  await assert.rejects(callGroqStream({ messages: [] }), /overloaded/);
});

test('callGroqStream maps HTTP failures like the plain call does', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => json({ error: { message: 'slow down' } }, 429));
  await assert.rejects(
    callGroqStream({ messages: [] }),
    (error) => error.code === 'rate_limited' && error.status === 429
  );
});

/* ------------------------------ partialStudySet ---------------------------- */

test('partialStudySet holds back the flashcard still being written', () => {
  const text =
    '{"title":"Bio","flashcards":[{"front":"What is ATP?","back":"Energy currency."},{"front":"What is DNA?","back":"Gene';
  const partial = partialStudySet(text);
  assert.deepEqual(
    partial.flashcards.map((c) => c.front),
    ['What is ATP?']
  );
});

test('partialStudySet keeps every flashcard once the quiz has started', () => {
  const cut = FULL.indexOf('"options"');
  const partial = partialStudySet(FULL.slice(0, cut));
  assert.equal(partial.flashcards.length, 2);
  assert.equal(partial.quiz.length, 0); // the question being written is held back
});

test('partialStudySet ids match the final set, so items do not re-key when it lands', async () => {
  const partial = partialStudySet(FULL.slice(0, FULL.indexOf('"quiz"')));
  const { studySet } = await generateWith(FULL);
  assert.equal(partial.flashcards[0].id, studySet.flashcards[0].id);
});

test('partialStudySet returns null until something complete has arrived', () => {
  assert.equal(partialStudySet(''), null);
  assert.equal(partialStudySet('{"title":"Bi'), null);
  assert.equal(partialStudySet('{"title":"Bio","flashcards":[{"front":"What'), null);
});

/* ------------------------- generateStudySet streaming ---------------------- */

async function generateWith(content) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => json({ choices: [{ message: { content }, finish_reason: 'stop' }] });
  try {
    return await generateStudySet(buildGenerateRequest({ input: 'Cells' }));
  } finally {
    globalThis.fetch = original;
  }
}

test('streaming generation reports items as they complete, then the full set', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => sseResponse(groqChunks(FULL, 3)));
  const partials = [];
  const result = await generateStudySet({
    ...buildGenerateRequest({ input: 'Cells' }),
    onPartial: (set) => partials.push(set),
  });

  assert.deepEqual(
    partials.map((p) => `${p.flashcards.length}:${p.quiz.length}`),
    ['1:0', '2:0']
  );
  assert.equal(result.studySet.flashcards.length, 2);
  assert.equal(result.studySet.quiz.length, 1);
});

test('a stream that breaks off falls back to an ordinary request', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const modes = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const { stream } = JSON.parse(init.body);
    modes.push(stream ? 'stream' : 'plain');
    return stream
      ? sseResponse(groqChunks(FULL), { breakAfter: 2 })
      : json({ choices: [{ message: { content: FULL }, finish_reason: 'stop' }] });
  });

  const result = await generateStudySet({ ...buildGenerateRequest({ input: 'Cells' }), onPartial: () => {} });
  assert.deepEqual(modes, ['stream', 'plain']);
  assert.equal(result.studySet.flashcards.length, 2);
});

test('a rate limit while streaming is not retried as a plain request', async (t) => {
  // It may be retried on the fallback model (see fallback.test.js), never by
  // dropping to a non-streamed call on the same model.
  const saved = process.env.GROQ_FALLBACK_MODEL;
  process.env.GROQ_FALLBACK_MODEL = 'none';
  t.after(() =>
    saved === undefined ? delete process.env.GROQ_FALLBACK_MODEL : (process.env.GROQ_FALLBACK_MODEL = saved)
  );

  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return json({ error: { message: 'slow' } }, 429);
  });
  await assert.rejects(
    generateStudySet({ ...buildGenerateRequest({ input: 'Cells' }), onPartial: () => {} }),
    (error) => error.code === 'rate_limited'
  );
  assert.equal(calls, 1);
});

/* ---------------------------------- SSE ----------------------------------- */

function fakeRes() {
  return {
    status: null,
    headers: null,
    chunks: [],
    writableEnded: false,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    write(chunk) {
      this.chunks.push(chunk);
    },
    end(chunk) {
      if (chunk) this.chunks.push(chunk);
      this.writableEnded = true;
    },
    events() {
      return this.chunks
        .join('')
        .split('\n\n')
        .filter(Boolean)
        .map((block) => {
          const [, event] = block.match(/^event: (.+)$/m);
          const [, data] = block.match(/^data: (.+)$/m);
          return { event, data: JSON.parse(data) };
        });
    },
  };
}

const allow = { check: async () => ({ success: true }) };

test('wantsEventStream reads the Accept header', () => {
  assert.equal(wantsEventStream({ accept: 'text/event-stream' }), true);
  assert.equal(wantsEventStream({ accept: 'application/json' }), false);
  assert.equal(wantsEventStream({}), false);
});

test('formatEvent writes one SSE message', () => {
  assert.equal(formatEvent('done', { a: 1 }), 'event: done\ndata: {"a":1}\n\n');
});

test('streamStudySet sends partials and then done', async () => {
  const res = fakeRes();
  await streamStudySet({
    res,
    body: { input: 'Cells' },
    ip: '1.1.1.1',
    build: buildGenerateRequest,
    limiter: allow,
    generate: async ({ onPartial }) => {
      onPartial({ title: 'Bio', flashcards: [{ id: 'c-1' }], quiz: [] });
      return { studySet: { title: 'Bio' }, meta: { attempts: 1 } };
    },
  });

  assert.equal(res.status, 200);
  assert.match(res.headers['Content-Type'], /text\/event-stream/);
  assert.deepEqual(
    res.events().map((e) => e.event),
    ['partial', 'done']
  );
  assert.deepEqual(res.events()[1].data, { studySet: { title: 'Bio' }, meta: { attempts: 1 } });
  assert.equal(res.writableEnded, true);
});

test('streamStudySet answers a rejected request with a real status code, not a stream', async () => {
  const res = fakeRes();
  await streamStudySet({
    res,
    body: { input: 'Cells' },
    ip: '1.1.1.1',
    build: buildGenerateRequest,
    limiter: { check: async () => ({ success: false, reset: Date.now() + 9000 }) },
  });
  assert.equal(res.status, 429);
  assert.match(res.headers['Content-Type'], /application\/json/);
  assert.ok(Number(res.headers['Retry-After']) >= 8);
  assert.equal(JSON.parse(res.chunks.join('')).error.code, 'rate_limited');
});

test('streamStudySet reports a generation failure as an error event', async () => {
  const res = fakeRes();
  await streamStudySet({
    res,
    body: { input: 'Cells' },
    ip: '1.1.1.1',
    build: buildGenerateRequest,
    limiter: allow,
    generate: async () => {
      throw new UpstreamError('timeout', 'The model took too long to respond.', { status: 504, retryable: true });
    },
  });
  assert.deepEqual(res.events(), [
    {
      event: 'error',
      data: { error: { code: 'timeout', message: 'The model took too long to respond.', retryable: true } },
    },
  ]);
});

test('streamStudySet stays quiet when the client has gone', async () => {
  const res = fakeRes();
  const controller = new AbortController();
  controller.abort();
  await streamStudySet({
    res,
    body: { input: 'Cells' },
    ip: '1.1.1.1',
    build: buildGenerateRequest,
    limiter: allow,
    signal: controller.signal,
    generate: async () => {
      throw new UpstreamError('client_aborted', 'Request cancelled.', { status: 499 });
    },
  });
  assert.deepEqual(res.events(), []);
  assert.equal(res.writableEnded, true);
});

test('partialStudySet copes with a model that writes the quiz first', () => {
  const text =
    '{"title":"Bio","quiz":[{"question":"Where?","options":["Stroma","Thylakoid"],"answerIndex":0}],' +
    '"flashcards":[{"front":"What is ATP?","back":"Energy."},{"front":"What is DN';
  const partial = partialStudySet(text);
  assert.equal(partial.quiz.length, 1, 'the closed quiz is kept whole');
  assert.equal(partial.flashcards.length, 1, 'the half-written card is held back');
});
