import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BLANK,
  checkBlankAnswer,
  correctAnswerText,
  editDistance,
  hasGap,
  normalizeAnswerText,
  normalizeGaps,
  quizType,
} from '../shared/quiz.js';
import { isValidStudySet, normalizeStudySet, studySetLimitViolation } from '../shared/normalize.js';

/* ------------------------------- quiz.js -------------------------------- */

test('quizType treats a missing type as mcq', () => {
  assert.equal(quizType({}), 'mcq');
  assert.equal(quizType({ type: 'weird' }), 'mcq');
  assert.equal(quizType({ type: 'blank' }), 'blank');
  assert.equal(quizType({ type: 'truefalse' }), 'truefalse');
});

test('correctAnswerText reads the answer for every type', () => {
  assert.equal(correctAnswerText({ options: ['a', 'b'], answerIndex: 1 }), 'b');
  assert.equal(correctAnswerText({ type: 'blank', answer: 'stroma' }), 'stroma');
});

test('normalizeAnswerText ignores case, accents, punctuation, spacing and a leading article', () => {
  assert.equal(normalizeAnswerText('  The Mitochondria. '), 'mitochondria');
  assert.equal(normalizeAnswerText('Café  au-lait'), 'cafe au lait');
  assert.equal(normalizeAnswerText('an apple'), 'apple');
});

test('editDistance counts single-character edits', () => {
  assert.equal(editDistance('kitten', 'sitting'), 3);
  assert.equal(editDistance('', 'abc'), 3);
  assert.equal(editDistance('same', 'same'), 0);
});

test('checkBlankAnswer accepts the answer and its accepted alternatives', () => {
  const q = { type: 'blank', answer: 'Mitochondria', accepted: ['mitochondrion'] };
  assert.equal(checkBlankAnswer('mitochondria', q), true);
  assert.equal(checkBlankAnswer('The mitochondrion!', q), true);
  assert.equal(checkBlankAnswer('nucleus', q), false);
  assert.equal(checkBlankAnswer('   ', q), false);
});

test('checkBlankAnswer forgives small typos in longer answers only', () => {
  assert.equal(checkBlankAnswer('mitocondria', { answer: 'mitochondria' }), true); // 1 edit, long word
  assert.equal(checkBlankAnswer('mitocondrea', { answer: 'mitochondria' }), true); // 2 edits, 12 letters
  assert.equal(checkBlankAnswer('mitocondira', { answer: 'mitochondria' }), false); // 3 edits
  assert.equal(checkBlankAnswer('stoma', { answer: 'stroma' }), true); // 1 edit, 6 letters
  assert.equal(checkBlankAnswer('stma', { answer: 'stroma' }), false); // 2 edits, 6 letters
  assert.equal(checkBlankAnswer('cat', { answer: 'car' }), false); // short words must be exact
});

test('checkBlankAnswer requires numbers to match exactly', () => {
  assert.equal(checkBlankAnswer('1915', { answer: '1914' }), false);
  assert.equal(checkBlankAnswer('1914', { answer: '1914' }), true);
});

test('gap markers are recognised and made consistent', () => {
  for (const marker of ['__', '_______', '[blank]', '[ ]', '{blank}', '....']) {
    assert.equal(hasGap(`The ${marker} is the powerhouse`), true, marker);
    assert.equal(normalizeGaps(`The ${marker} is the powerhouse`), `The ${BLANK} is the powerhouse`);
  }
  assert.equal(hasGap('No gap here.'), false);
  assert.equal(hasGap('Ellipsis... is not a gap'), false);
});

/* ------------------------------ normalizer -------------------------------- */

function quizOf(items) {
  return normalizeStudySet({ flashcards: [{ front: 'f', back: 'b' }], quiz: items });
}

test('multiple-choice questions are typed mcq', () => {
  const { data } = quizOf([{ question: 'Pick', options: ['a', 'b'], answerIndex: 1 }]);
  assert.equal(data.quiz[0].type, 'mcq');
});

test('true/false questions are normalized to canonical options from any answer format', () => {
  const cases = [
    [{ type: 'truefalse', question: 'Sky is blue', answer: true }, 0],
    [{ type: 'true_false', question: 'Sky is green', answer: 'False' }, 1],
    [{ type: 'boolean', question: 'Water is wet', correctAnswer: 'yes' }, 0],
    [{ question: 'Fire is cold', options: ['true', 'false'], answerIndex: 1 }, 1], // detected by its options
    [{ question: 'Ice is cold', options: ['False', 'True'], answer: 'True' }, 0], // reordered options
    [{ question: 'Snow is white', answer: true }, 0], // detected by a boolean answer
  ];
  for (const [item, answerIndex] of cases) {
    const q = quizOf([item]).data.quiz[0];
    assert.equal(q.type, 'truefalse', JSON.stringify(item));
    assert.deepEqual(q.options, ['True', 'False']);
    assert.equal(q.answerIndex, answerIndex, JSON.stringify(item));
  }
});

test('a true/false question with no readable answer is dropped', () => {
  const result = quizOf([{ type: 'truefalse', question: 'Unclear', answer: 'maybe' }]);
  assert.equal(result.data.quiz.length, 0);
  assert.ok(result.repairs.some((r) => /unanswerable/.test(r)));
});

test('fill-in-the-blank questions keep their answer and alternatives', () => {
  const { data } = quizOf([
    {
      type: 'fill_in_the_blank',
      question: 'The Calvin cycle happens in the ________.',
      answer: 'stroma',
      acceptedAnswers: ['the stroma', 'Stroma', 'chloroplast stroma'],
      explanation: 'Not the thylakoid.',
    },
  ]);
  assert.deepEqual(data.quiz[0], {
    id: data.quiz[0].id,
    type: 'blank',
    question: `The Calvin cycle happens in the ${BLANK}.`,
    answer: 'stroma',
    accepted: ['the stroma', 'chloroplast stroma'], // the duplicate of the answer is dropped
    explanation: 'Not the thylakoid.',
  });
});

test('a gap in the question with a typed answer is detected as a blank', () => {
  const { data } = quizOf([{ question: 'ATP stands for adenosine ___.', answer: 'triphosphate' }]);
  assert.equal(data.quiz[0].type, 'blank');
});

test('numeric blank answers are kept as text', () => {
  const { data } = quizOf([{ type: 'blank', question: 'WWI began in ___.', answer: 1914 }]);
  assert.equal(data.quiz[0].answer, '1914');
});

test('a blank with no answer is dropped', () => {
  assert.equal(quizOf([{ type: 'blank', question: 'The ___ is.' }]).data.quiz.length, 0);
});

test('accepted answers are capped', () => {
  const { data } = quizOf([{ type: 'blank', question: '___', answer: 'a', accepted: ['b', 'c', 'd', 'e', 'f', 'g', 'h'] }]);
  assert.equal(data.quiz[0].accepted.length, 5);
});

test('isValidStudySet accepts every type, and sets saved before types existed', () => {
  const base = { flashcards: [] };
  assert.equal(isValidStudySet({ ...base, quiz: [{ question: 'q', options: ['a', 'b'], answerIndex: 0 }] }), true);
  assert.equal(isValidStudySet({ ...base, quiz: [{ type: 'truefalse', question: 'q', options: ['True', 'False'], answerIndex: 1 }] }), true);
  assert.equal(isValidStudySet({ ...base, quiz: [{ type: 'blank', question: 'q ___', answer: 'a', accepted: [] }] }), true);
});

test('isValidStudySet rejects malformed blanks and unknown types', () => {
  const base = { flashcards: [] };
  assert.equal(isValidStudySet({ ...base, quiz: [{ type: 'blank', question: 'q', answer: '' }] }), false);
  assert.equal(isValidStudySet({ ...base, quiz: [{ type: 'blank', question: 'q', answer: 'a', accepted: [1] }] }), false);
  assert.equal(isValidStudySet({ ...base, quiz: [{ type: 'essay', question: 'q', options: ['a', 'b'], answerIndex: 0 }] }), false);
});

test('studySetLimitViolation checks blank answers', () => {
  const set = (q) => ({ title: 't', summary: '', flashcards: [], quiz: [{ type: 'blank', question: 'q', ...q }] });
  assert.equal(studySetLimitViolation(set({ answer: 'a', accepted: ['b'] })), null);
  assert.match(studySetLimitViolation(set({ answer: 'a'.repeat(400) })), /question 1's answer/);
  assert.match(studySetLimitViolation(set({ answer: 'a', accepted: Array(9).fill('b') })), /9 accepted answers/);
  assert.match(studySetLimitViolation(set({ answer: 'a', accepted: ['b'.repeat(400)] })), /accepted answer 1/);
});
