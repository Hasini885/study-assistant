import test from 'node:test';
import assert from 'node:assert/strict';

import { extractJson } from '../shared/extractJson.js';
import { normalizeStudySet, isValidStudySet } from '../shared/normalize.js';

const goodCard = { front: 'What is ATP?', back: 'The energy currency of the cell.' };
const goodQuestion = {
  question: 'Where does the Calvin cycle occur?',
  options: ['Stroma', 'Thylakoid', 'Cytosol', 'Nucleus'],
  answerIndex: 0,
  explanation: 'It happens in the stroma.',
};

test('accepts a well-formed study set', () => {
  const result = normalizeStudySet({
    title: 'Cell biology',
    summary: 'Basics.',
    flashcards: [goodCard],
    quiz: [goodQuestion],
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.flashcards.length, 1);
  assert.equal(result.data.quiz.length, 1);
  assert.deepEqual(result.repairs, []);
  assert.ok(isValidStudySet(result.data));
});

test('drops malformed cards but keeps the good ones', () => {
  const result = normalizeStudySet({
    flashcards: [goodCard, { front: 'no back' }, { back: 'no front' }, null, 'nonsense'],
    quiz: [goodQuestion],
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.flashcards.length, 1);
  assert.ok(result.repairs.some((r) => /Skipped 4/.test(r)));
});

test('removes duplicate flashcards', () => {
  const result = normalizeStudySet({ flashcards: [goodCard, { ...goodCard, back: 'different' }] });
  assert.equal(result.data.flashcards.length, 1);
});

test('accepts alternative key names', () => {
  const result = normalizeStudySet({
    cards: [{ term: 'Mitochondrion', definition: 'The powerhouse of the cell.' }],
    questions: [{ prompt: 'Pick one', choices: ['a', 'b'], correct_answer: 'b' }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.flashcards[0].front, 'Mitochondrion');
  assert.equal(result.data.quiz[0].answerIndex, 1);
});

test('unwraps an envelope object', () => {
  const result = normalizeStudySet({ data: { flashcards: [goodCard], quiz: [] } });
  assert.equal(result.ok, true);
  assert.equal(result.data.flashcards.length, 1);
});

test('treats a bare array as a list of flashcards', () => {
  const result = normalizeStudySet([goodCard, goodCard]);
  assert.equal(result.ok, true);
  assert.equal(result.data.flashcards.length, 1); // deduped
});

test('reads pair-shaped cards from tuples and strings', () => {
  const result = normalizeStudySet({
    flashcards: [['Osmosis', 'Water moving across a membrane.'], 'Diffusion - Movement down a gradient.'],
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.flashcards.length, 2);
  assert.equal(result.data.flashcards[0].front, 'Osmosis');
  assert.equal(result.data.flashcards[1].back, 'Movement down a gradient.');
});

/* ------------------------------- answer keys ------------------------------ */

test('resolves an answer given as a letter', () => {
  const result = normalizeStudySet({ quiz: [{ ...goodQuestion, answerIndex: undefined, answer: 'C' }] });
  assert.equal(result.data.quiz[0].answerIndex, 2);
});

test('resolves an answer given as "(b)"', () => {
  const result = normalizeStudySet({ quiz: [{ ...goodQuestion, answerIndex: undefined, answer: '(b)' }] });
  assert.equal(result.data.quiz[0].answerIndex, 1);
});

test('resolves an answer given as the option text', () => {
  const result = normalizeStudySet({ quiz: [{ ...goodQuestion, answerIndex: undefined, correctAnswer: 'Thylakoid' }] });
  assert.equal(result.data.quiz[0].answerIndex, 1);
});

test('resolves option text that still carries its label', () => {
  const result = normalizeStudySet({
    quiz: [{ ...goodQuestion, answerIndex: undefined, correctAnswer: 'B) Thylakoid' }],
  });
  assert.equal(result.data.quiz[0].answerIndex, 1);
});

test('corrects a 1-based answer index', () => {
  // 4 is out of range for a 4-option question, so it must be 1-based.
  const result = normalizeStudySet({ quiz: [{ ...goodQuestion, answerIndex: 4 }] });
  assert.equal(result.data.quiz[0].answerIndex, 3);
});

test('reads a correct flag on option objects', () => {
  const result = normalizeStudySet({
    quiz: [
      {
        question: 'Which is correct?',
        options: [
          { text: 'Wrong', correct: false },
          { text: 'Right', correct: true },
        ],
      },
    ],
  });
  assert.equal(result.data.quiz[0].answerIndex, 1);
  assert.equal(result.data.quiz[0].options[1], 'Right');
});

test('strips "A) " prefixes from options', () => {
  const result = normalizeStudySet({
    quiz: [{ question: 'Pick', options: ['A) Stroma', 'B) Thylakoid'], answerIndex: 0 }],
  });
  assert.deepEqual(result.data.quiz[0].options, ['Stroma', 'Thylakoid']);
});

test('drops a question whose answer cannot be determined', () => {
  const result = normalizeStudySet({
    flashcards: [goodCard],
    quiz: [{ ...goodQuestion, answerIndex: undefined }],
  });

  assert.equal(result.data.quiz.length, 0);
  assert.ok(result.repairs.some((r) => /unanswerable/.test(r)));
});

test('drops a question with fewer than two distinct options', () => {
  const result = normalizeStudySet({
    flashcards: [goodCard],
    quiz: [{ question: 'Only one', options: ['Same', 'same'], answerIndex: 0 }],
  });
  assert.equal(result.data.quiz.length, 0);
});

/* --------------------------------- failure -------------------------------- */

test('flags a deliberately empty set as empty, not broken', () => {
  const result = normalizeStudySet({ title: '', summary: '', flashcards: [], quiz: [] });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'empty');
});

test('flags an off-schema object as a shape problem', () => {
  const result = normalizeStudySet({ topic: 'Bio', content: 'stuff', items: ['a', 'b'] });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'shape');
});

test('rejects non-objects', () => {
  assert.equal(normalizeStudySet(null).ok, false);
  assert.equal(normalizeStudySet('a string').ok, false);
  assert.equal(normalizeStudySet(42).ok, false);
});

test('falls back to a title derived from the topic', () => {
  const result = normalizeStudySet({ flashcards: [goodCard] }, { topic: 'Cell biology' });
  assert.equal(result.data.title, 'Study set: Cell biology');
});

test('truncates runaway strings instead of rendering them', () => {
  const result = normalizeStudySet({ flashcards: [{ front: 'a'.repeat(5000), back: 'b' }] });
  assert.ok(result.data.flashcards[0].front.length <= 600);
});

/* ------------------------------ end to end -------------------------------- */

test('a truncated model response becomes a shorter but valid study set', () => {
  const raw =
    'Here you go!\n```json\n{"title":"Bio","flashcards":[' +
    '{"front":"What is ATP?","back":"The energy currency of the cell."},' +
    '{"front":"What is DN';

  const extracted = extractJson(raw);
  assert.equal(extracted.ok, true);

  const result = normalizeStudySet(extracted.value);
  assert.equal(result.ok, true);
  assert.equal(result.data.flashcards.length, 1); // the half-written card is dropped
  assert.ok(isValidStudySet(result.data));
});

/* -------------------------------- guard ---------------------------------- */

test('isValidStudySet rejects an out-of-range answer index', () => {
  assert.equal(
    isValidStudySet({ flashcards: [], quiz: [{ question: 'q', options: ['a', 'b'], answerIndex: 5 }] }),
    false
  );
});

test('isValidStudySet rejects missing arrays', () => {
  assert.equal(isValidStudySet({ flashcards: [] }), false);
  assert.equal(isValidStudySet(null), false);
});
