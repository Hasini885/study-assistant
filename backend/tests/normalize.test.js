import test from 'node:test';
import assert from 'node:assert/strict';

import { extractJson } from '../shared/extractJson.js';
import { normalizeStudySet, isValidStudySet, studySetLimitViolation, LIMITS } from '../shared/normalize.js';

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

/* ------------------------------ input limits ----------------------------- */

function validSet(overrides = {}) {
  return {
    title: 'Cell biology',
    summary: 'Basics.',
    flashcards: [{ id: 'c1', front: 'What is ATP?', back: 'Energy currency.', hint: '' }],
    quiz: [{ id: 'q1', ...goodQuestion }],
    ...overrides,
  };
}

test('studySetLimitViolation accepts a normally sized set', () => {
  assert.equal(studySetLimitViolation(validSet()), null);
});

test('studySetLimitViolation accepts anything the normalizer produced, even at the limits', () => {
  const result = normalizeStudySet({
    title: 't'.repeat(1000),
    summary: 's'.repeat(1000),
    flashcards: Array.from({ length: 60 }, (_, i) => ({
      front: `${i} ${'f'.repeat(900)}`,
      back: 'b'.repeat(900),
      hint: 'h'.repeat(900),
    })),
    quiz: Array.from({ length: 40 }, (_, i) => ({
      question: `${i} ${'q'.repeat(900)}`,
      options: Array.from({ length: 9 }, (__, n) => `${n} ${'o'.repeat(900)}`),
      answerIndex: 0,
      explanation: 'e'.repeat(900),
    })),
  });
  assert.equal(result.ok, true);
  assert.equal(studySetLimitViolation(result.data), null);
});

test('studySetLimitViolation rejects too many flashcards', () => {
  const flashcards = Array.from({ length: LIMITS.maxFlashcards + 1 }, (_, i) => ({ front: `f${i}`, back: 'b' }));
  assert.match(studySetLimitViolation(validSet({ flashcards })), /41 flashcards \(the limit is 40\)/);
});

test('studySetLimitViolation rejects too many quiz questions', () => {
  const quiz = Array.from({ length: LIMITS.maxQuizQuestions + 1 }, () => goodQuestion);
  assert.match(studySetLimitViolation(validSet({ quiz })), /31 quiz questions/);
});

test('studySetLimitViolation rejects too many options', () => {
  const quiz = [{ ...goodQuestion, options: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }];
  assert.match(studySetLimitViolation(validSet({ quiz })), /7 options in question 1/);
});

test('studySetLimitViolation rejects over-long strings in every field', () => {
  const long = 'x'.repeat(5000);
  const cases = [
    [{ title: long }, /the title/],
    [{ summary: long }, /the summary/],
    [{ flashcards: [{ front: long, back: 'b' }] }, /flashcard 1's front/],
    [{ flashcards: [{ front: 'f', back: long }] }, /flashcard 1's back/],
    [{ flashcards: [{ front: 'f', back: 'b', hint: long }] }, /flashcard 1's hint/],
    [{ quiz: [{ ...goodQuestion, question: long }] }, /in question 1/],
    [{ quiz: [{ ...goodQuestion, explanation: long }] }, /question 1's explanation/],
    [{ quiz: [{ ...goodQuestion, options: ['a', long] }] }, /option 2 of question 1/],
  ];
  for (const [overrides, pattern] of cases) {
    assert.match(studySetLimitViolation(validSet(overrides)), pattern);
  }
});

test('studySetLimitViolation rejects non-text values that would crash the UI', () => {
  // An object among the options would crash the UI when rendered, so the
  // shape check itself refuses it.
  assert.equal(
    studySetLimitViolation(validSet({ quiz: [{ ...goodQuestion, options: ['a', { evil: true }] }] })),
    'an invalid shape'
  );
  assert.equal(isValidStudySet(validSet({ quiz: [{ ...goodQuestion, options: ['a', { evil: true }] }] })), false);
  assert.match(studySetLimitViolation(validSet({ title: 42 })), /non-text value for the title/);
});

test('studySetLimitViolation reports an invalid shape', () => {
  assert.equal(studySetLimitViolation({ flashcards: 'nope' }), 'an invalid shape');
});

/* ---------------------------------- ids ---------------------------------- */

test('ids are derived from content, so normalizing twice gives the same ids', () => {
  const raw = { flashcards: [goodCard], quiz: [goodQuestion] };
  const a = normalizeStudySet(raw).data;
  const b = normalizeStudySet(JSON.parse(JSON.stringify(raw))).data;
  assert.equal(a.flashcards[0].id, b.flashcards[0].id);
  assert.equal(a.quiz[0].id, b.quiz[0].id);
  assert.match(a.flashcards[0].id, /^c-/);
  assert.match(a.quiz[0].id, /^q-/);
});

test('a well-formed id sent by the model is kept', () => {
  const result = normalizeStudySet({
    flashcards: [{ ...goodCard, id: 'card-0-7' }],
    quiz: [{ ...goodQuestion, id: 'q-3' }],
  });
  assert.equal(result.data.flashcards[0].id, 'card-0-7');
  assert.equal(result.data.quiz[0].id, 'q-3');
});

test('malformed or duplicate ids from the model are replaced', () => {
  const result = normalizeStudySet({
    flashcards: [
      { ...goodCard, id: 'not ok!' },
      { front: 'Second', back: 'card', id: 'dup' },
      { front: 'Third', back: 'card', id: 'dup' },
    ],
    quiz: [
      { ...goodQuestion, id: 42 },
      { ...goodQuestion, question: 'Same text?', id: 'dup' },
    ],
  });
  const ids = result.data.flashcards.map((c) => c.id);
  assert.match(ids[0], /^c-/);
  assert.equal(ids[1], 'dup');
  assert.equal(ids[2], 'dup-2');
  assert.match(result.data.quiz[0].id, /^q-/);
});

/* -------------------------------- sources -------------------------------- */

test('a source quote from the model is kept, under any of its aliases', () => {
  const result = normalizeStudySet({
    flashcards: [
      { ...goodCard, source: '  ATP is the  energy currency ' },
      { front: 'B', back: 'b', quote: 'from notes' },
    ],
    quiz: [{ ...goodQuestion, evidence: 'It happens in the stroma.' }],
  });
  assert.equal(result.data.flashcards[0].source, 'ATP is the energy currency');
  assert.equal(result.data.flashcards[1].source, 'from notes');
  assert.equal(result.data.quiz[0].source, 'It happens in the stroma.');
});

test('items without a source have no source field at all', () => {
  const result = normalizeStudySet({ flashcards: [goodCard], quiz: [goodQuestion] });
  assert.equal('source' in result.data.flashcards[0], false);
  assert.equal('source' in result.data.quiz[0], false);
});

test('a grounded flag from the model is ignored: only the server sets it', () => {
  const result = normalizeStudySet({ flashcards: [{ ...goodCard, source: 'x', grounded: true }] });
  assert.equal('grounded' in result.data.flashcards[0], false);
});

test('over-long sources are truncated, and non-text ones dropped', () => {
  const result = normalizeStudySet({
    flashcards: [
      { ...goodCard, source: 's'.repeat(2000) },
      { front: 'B', back: 'b', source: { nope: 1 } },
    ],
  });
  assert.ok(result.data.flashcards[0].source.length <= LIMITS.source);
  assert.equal('source' in result.data.flashcards[1], false);
});

test('studySetLimitViolation checks sources and grounded flags', () => {
  assert.match(
    studySetLimitViolation(validSet({ flashcards: [{ front: 'f', back: 'b', source: 's'.repeat(301) }] })),
    /flashcard 1's source/
  );
  assert.match(
    studySetLimitViolation(validSet({ quiz: [{ ...goodQuestion, grounded: 'yes' }] })),
    /non-boolean value for question 1's grounded flag/
  );
  assert.equal(
    studySetLimitViolation(validSet({ flashcards: [{ front: 'f', back: 'b', source: 'quote', grounded: true }] })),
    null
  );
});
