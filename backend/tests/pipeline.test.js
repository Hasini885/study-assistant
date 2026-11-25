import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRefineRequest, UpstreamError } from '../pipeline.js';

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
