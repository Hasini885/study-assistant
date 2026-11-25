import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildGenerateRequest,
  buildRefineRequest,
  enforceRateLimit,
  errorResponse,
  generateStudySet,
  handleStudySetRequest,
  UpstreamError,
} from '../pipeline.js';

const question = { question: 'Where?', options: ['Stroma', 'Thylakoid'], answerIndex: 0, explanation: '' };

function studySet(overrides = {}) {
  return {
    title: 'Bio',
    summary: '',
    flashcards: [{ id: 'c1', front: 'What is ATP?', back: 'Energy currency.', hint: '' }],
    quiz: [{ id: 'q1', ...question }],
    ...overrides,
  };
}

function badRequest(fn) {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof UpstreamError, `expected UpstreamError, got ${error}`);
    return error;
  }
  assert.fail('expected the request to be rejected');
}

/* ------------------------------- refine limits ---------------------------- */

test('buildRefineRequest accepts a normal set', () => {
  const { messages, topic } = buildRefineRequest({ studySet: studySet(), instruction: 'make it harder' });
  assert.equal(topic, 'Bio');
  assert.equal(messages.length, 2);
});

test('buildRefineRequest rejects too many flashcards with a 400', () => {
  const flashcards = Array.from({ length: 500 }, (_, i) => ({ front: `card ${i}`, back: 'b' }));
  const error = badRequest(() => buildRefineRequest({ studySet: studySet({ flashcards }), instruction: 'harder' }));
  assert.equal(error.status, 400);
  assert.equal(error.code, 'bad_request');
  assert.match(error.message, /500 flashcards \(the limit is 40\)/);
});

test('buildRefineRequest rejects too many quiz questions with a 400', () => {
  const quiz = Array.from({ length: 31 }, () => question);
  const error = badRequest(() => buildRefineRequest({ studySet: studySet({ quiz }), instruction: 'harder' }));
  assert.equal(error.status, 400);
  assert.match(error.message, /31 quiz questions/);
});

test('buildRefineRequest rejects over-long strings with a 400', () => {
  const flashcards = [{ front: 'x'.repeat(100_000), back: 'b' }];
  const error = badRequest(() => buildRefineRequest({ studySet: studySet({ flashcards }), instruction: 'harder' }));
  assert.equal(error.status, 400);
  assert.match(error.message, /flashcard 1's front/);
});

test('buildRefineRequest rejects too many options with a 400', () => {
  const quiz = [{ ...question, options: Array.from({ length: 50 }, (_, i) => `option ${i}`) }];
  const error = badRequest(() => buildRefineRequest({ studySet: studySet({ quiz }), instruction: 'harder' }));
  assert.equal(error.status, 400);
  assert.match(error.message, /50 options/);
});

test('buildRefineRequest still rejects a set that is not a study set at all', () => {
  const error = badRequest(() => buildRefineRequest({ studySet: { nope: true }, instruction: 'harder' }));
  assert.equal(error.status, 400);
  assert.match(error.message, /can no longer be refined/);
});

/* ------------------------------ rate limiting ----------------------------- */

const allow = { check: async () => ({ success: true }) };

function denyUntil(reset) {
  const seen = [];
  return { seen, check: async (id) => (seen.push(id), { success: false, reset }) };
}

async function rejection(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail('expected a rejection');
}

test('enforceRateLimit lets an allowed request through', async () => {
  await enforceRateLimit('1.2.3.4', allow);
});

test('enforceRateLimit throws the 429 the UI already understands', async () => {
  const limiter = denyUntil(Date.now() + 30_000);
  const error = await rejection(enforceRateLimit('1.2.3.4', limiter));

  assert.ok(error instanceof UpstreamError);
  assert.equal(error.status, 429);
  assert.equal(error.code, 'rate_limited'); // same code as Groq's own 429
  assert.equal(error.retryable, true);
  assert.ok(error.retryAfter >= 29 && error.retryAfter <= 30, String(error.retryAfter));
  assert.match(error.message, /Try again in \d+ seconds/);
  assert.deepEqual(limiter.seen, ['ip:1.2.3.4']);
});

test('enforceRateLimit buckets a missing IP as "unknown" rather than skipping the check', async () => {
  const limiter = denyUntil(Date.now() + 1000);
  await rejection(enforceRateLimit('', limiter));
  assert.deepEqual(limiter.seen, ['ip:unknown']);
});

test('a rate-limited request never reaches validation or the model', async () => {
  let built = false;
  let generated = false;
  const error = await rejection(
    handleStudySetRequest({
      body: { input: 'photosynthesis' },
      ip: '1.2.3.4',
      build: (body) => ((built = true), buildGenerateRequest(body)),
      limiter: denyUntil(Date.now() + 5000),
      generate: async () => {
        generated = true;
      },
    })
  );
  assert.equal(error.status, 429);
  assert.equal(built, false);
  assert.equal(generated, false);
});

test('an allowed request is validated and then generated', async () => {
  const signal = new AbortController().signal;
  let received;
  const result = await handleStudySetRequest({
    body: { input: '  photosynthesis  ' },
    ip: '1.2.3.4',
    build: buildGenerateRequest,
    signal,
    limiter: allow,
    generate: async (args) => {
      received = args;
      return { studySet: 'ok' };
    },
  });
  assert.deepEqual(result, { studySet: 'ok' });
  assert.equal(received.topic, 'photosynthesis');
  assert.equal(received.signal, signal);
});

test('an allowed but invalid request still gets its 400', async () => {
  const error = await rejection(
    handleStudySetRequest({ body: { input: '' }, ip: '1.2.3.4', build: buildGenerateRequest, limiter: allow })
  );
  assert.equal(error.status, 400);
});

/* ----------------------------- error responses ---------------------------- */

test('errorResponse adds Retry-After for a rate-limited request', () => {
  const { status, headers, body } = errorResponse(
    new UpstreamError('rate_limited', 'slow down', { status: 429, retryable: true, retryAfter: 12 })
  );
  assert.equal(status, 429);
  assert.deepEqual(headers, { 'Retry-After': '12' });
  assert.deepEqual(body, { error: { code: 'rate_limited', message: 'slow down', retryable: true } });
});

test('errorResponse sends no extra headers for other errors', (t) => {
  t.mock.method(console, 'error', () => {});
  assert.deepEqual(errorResponse(new UpstreamError('bad_request', 'x', { status: 400 })).headers, {});
  assert.deepEqual(errorResponse(new Error('boom')).headers, {});
});

/* ---------------------------- refine keeps ids ---------------------------- */

function mockGroq(t, content) {
  process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || 'test-key';
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return calls;
}

test('refining sends ids to the model and keeps them on the result', async (t) => {
  const previousSet = {
    title: 'Bio',
    summary: '',
    flashcards: [
      { id: 'card-0-1', front: 'What is ATP?', back: 'Energy currency.', hint: '' },
      { id: 'card-1-2', front: 'What is DNA?', back: 'Genetic material.', hint: '' },
    ],
    quiz: [{ id: 'q-0-3', ...question }],
  };

  // The model keeps one id, drops another (but keeps the card), and adds a card.
  const calls = mockGroq(
    t,
    JSON.stringify({
      title: 'Bio',
      flashcards: [
        { id: 'card-0-1', front: 'What is ATP? Explain.', back: 'The energy currency of the cell.' },
        { front: 'What is DNA?', back: 'Genetic material.' },
        { front: 'What is RNA?', back: 'A messenger.' },
      ],
      quiz: [{ ...question }],
    })
  );

  const request = buildRefineRequest({ studySet: previousSet, instruction: 'add a card about RNA' });
  const { studySet } = await generateStudySet(request);

  const sentSet = JSON.parse(calls[0].messages[1].content.match(/\{[\s\S]*\}/)[0]);
  assert.deepEqual(
    sentSet.flashcards.map((c) => c.id),
    ['card-0-1', 'card-1-2']
  );
  assert.match(calls[0].messages[1].content, /Copy it unchanged/);

  assert.deepEqual(
    studySet.flashcards.map((c) => c.id).slice(0, 2),
    ['card-0-1', 'card-1-2']
  );
  assert.ok(!['card-0-1', 'card-1-2'].includes(studySet.flashcards[2].id));
  assert.equal(studySet.quiz[0].id, 'q-0-3');
});

/* --------------------------------- grounding ------------------------------- */

const NOTES =
  'Photosynthesis happens in two stages. The light-dependent reactions take place in the thylakoid membranes ' +
  'and produce ATP and NADPH. The Calvin cycle takes place in the stroma, where carbon dioxide is fixed into ' +
  'sugar using the ATP and NADPH made earlier. Plants cannot run the light reactions at night.';

test('notes get source quotes that are checked against the notes', async (t) => {
  const calls = mockGroq(
    t,
    JSON.stringify({
      title: 'Photosynthesis',
      flashcards: [
        { front: 'Where is the Calvin cycle?', back: 'The stroma', source: 'The Calvin cycle takes place in the stroma' },
        { front: 'What absorbs light?', back: 'Chlorophyll', source: 'Chlorophyll absorbs red and blue light' },
      ],
      quiz: [{ ...question, source: 'produce ATP and NADPH' }],
    })
  );

  const { studySet, meta } = await generateStudySet(buildGenerateRequest({ input: NOTES }));

  assert.match(calls[0].messages[1].content, /"source" field/);
  assert.deepEqual(
    studySet.flashcards.map((c) => c.grounded),
    [true, false]
  );
  assert.equal(studySet.quiz[0].grounded, true);
  assert.deepEqual(meta.grounding, { checked: 3, verified: 2 });
});

test('a bare topic is not asked for sources and is not graded on them', async (t) => {
  const calls = mockGroq(t, JSON.stringify({ title: 'Bio', flashcards: [{ front: 'a?', back: 'b' }], quiz: [] }));
  const { studySet, meta } = await generateStudySet(buildGenerateRequest({ input: 'Photosynthesis' }));
  assert.doesNotMatch(calls[0].messages[1].content, /"source"/);
  assert.equal('grounded' in studySet.flashcards[0], false);
  assert.equal(meta.grounding, undefined);
});

/* ---------------------------------- model --------------------------------- */

import { primaryModel } from '../groq.js';

test('the default model is one Groq still serves', () => {
  // Regression: the default was llama-3.3-70b-versatile, which Groq retired,
  // so every request without a GROQ_MODEL override failed.
  const saved = process.env.GROQ_MODEL;
  delete process.env.GROQ_MODEL;
  try {
    assert.equal(primaryModel(), 'openai/gpt-oss-120b');
  } finally {
    if (saved !== undefined) process.env.GROQ_MODEL = saved;
  }
});

/* ---------------------------------- explain -------------------------------- */

import { buildExplainRequest, generateExplanation, handleExplainRequest } from '../pipeline.js';

const explainSet = () =>
  studySet({
    quiz: [
      { id: 'q-1', type: 'mcq', ...question },
      { id: 'q-2', type: 'blank', question: 'The Calvin cycle is in the _____.', answer: 'stroma', accepted: [] },
    ],
  });

test('buildExplainRequest grounds the prompt in the set and the chosen answer', () => {
  const { messages } = buildExplainRequest({ studySet: explainSet(), questionId: 'q-1', chosen: 'Thylakoid' });
  const user = messages[1].content;
  assert.match(user, /What is ATP\? — Energy currency\./); // the set's cards are the material
  assert.match(user, /Correct answer: Stroma/);
  assert.match(user, /Student's answer: Thylakoid/);
  assert.match(messages[0].content, /ONLY the study material/);
});

test('buildExplainRequest works for a typed answer', () => {
  const { messages } = buildExplainRequest({ studySet: explainSet(), questionId: 'q-2', chosen: 'thylakoid' });
  assert.match(messages[1].content, /Correct answer: stroma/);
});

test('buildExplainRequest rejects unknown questions, missing or oversized answers, and bad sets', () => {
  const cases = [
    [{ studySet: explainSet(), questionId: 'q-nope', chosen: 'x' }, /no longer in this set/],
    [{ studySet: explainSet(), questionId: 'q-1', chosen: '  ' }, /Answer the question first/],
    [{ studySet: explainSet(), questionId: 'q-1', chosen: 'x'.repeat(301) }, /too long/],
    [{ studySet: { nope: 1 }, questionId: 'q-1', chosen: 'x' }, /can no longer be explained/],
    [{ studySet: studySet({ flashcards: Array.from({ length: 41 }, (_, i) => ({ front: `${i}`, back: 'b' })) }), questionId: 'q1', chosen: 'x' }, /41 flashcards/],
  ];
  for (const [body, pattern] of cases) {
    const error = badRequest(() => buildExplainRequest(body));
    assert.equal(error.status, 400);
    assert.match(error.message, pattern);
  }
});

test('generateExplanation returns the model explanation, trimmed and capped', async (t) => {
  mockGroq(t, JSON.stringify({ explanation: `  The stroma is where it happens.  ${'x'.repeat(1000)}` }));
  const { explanation } = await generateExplanation({ messages: [] });
  assert.ok(explanation.startsWith('The stroma is where it happens.'));
  assert.equal(explanation.length, 600);
});

test('generateExplanation fails clearly when the model returns nothing usable', async (t) => {
  mockGroq(t, JSON.stringify({ nope: true }));
  await assert.rejects(generateExplanation({ messages: [] }), (error) => error.code === 'unusable_output' && error.retryable);
});

test('explanations are rate limited in their own bucket', async () => {
  const limiter = denyUntil(Date.now() + 5000);
  const error = await rejection(
    handleExplainRequest({ body: { studySet: explainSet(), questionId: 'q-1', chosen: 'x' }, ip: '1.2.3.4', limiter })
  );
  assert.equal(error.status, 429);
  assert.deepEqual(limiter.seen, ['explain:ip:1.2.3.4']);
});
