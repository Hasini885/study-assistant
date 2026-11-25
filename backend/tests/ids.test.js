import test from 'node:test';
import assert from 'node:assert/strict';

import { claimUniqueId, contentId, hashString, isWellFormedId, matchKey, reconcileIds } from '../shared/ids.js';

test('isWellFormedId accepts short slug-like strings only', () => {
  for (const ok of ['c-1', 'card_9', 'q-abc123', 'A'.repeat(64)]) assert.equal(isWellFormedId(ok), true, ok);
  for (const bad of ['', 'has space', 'x'.repeat(65), 'semi;colon', 7, null, undefined, {}]) {
    assert.equal(isWellFormedId(bad), false, String(bad));
  }
});

test('matchKey ignores case and whitespace', () => {
  assert.equal(matchKey('  What  is\nATP? '), 'what is atp?');
  assert.equal(matchKey(undefined), '');
});

test('hashString is stable and spreads similar inputs apart', () => {
  assert.equal(hashString('abc'), hashString('abc'));
  assert.notEqual(hashString('abc'), hashString('abd'));
  assert.match(hashString(''), /^[0-9a-z]+$/);
});

test('contentId gives the same id to the same text, however it is spaced', () => {
  assert.equal(contentId('c', 'What is ATP?'), contentId('c', '  what is   ATP? '));
  assert.notEqual(contentId('c', 'What is ATP?'), contentId('q', 'What is ATP?'));
  assert.ok(isWellFormedId(contentId('c', 'x'.repeat(5000))));
});

test('claimUniqueId suffixes collisions and records the claim', () => {
  const used = new Set(['c-1']);
  assert.equal(claimUniqueId('c-1', used), 'c-1-2');
  assert.equal(claimUniqueId('c-1', used), 'c-1-3');
  assert.equal(claimUniqueId('c-2', used), 'c-2');
  assert.deepEqual([...used], ['c-1', 'c-1-2', 'c-1-3', 'c-2']);
});

/* ------------------------------- reconcileIds ------------------------------ */

const previous = {
  flashcards: [
    { id: 'card-0-1', front: 'What is ATP?', back: 'Energy currency.' },
    { id: 'card-1-2', front: 'What is DNA?', back: 'Genetic material.' },
    { id: 'card-2-3', front: 'What is RNA?', back: 'A messenger.' },
  ],
  quiz: [{ id: 'q-0-4', question: 'Where is the stroma?', options: ['a', 'b'], answerIndex: 0 }],
};

test('ids the model kept are preserved', () => {
  const next = { flashcards: [{ id: 'card-1-2', front: 'What is DNA? (harder)', back: 'x' }], quiz: [] };
  const { studySet, matched } = reconcileIds(previous, next);
  assert.equal(studySet.flashcards[0].id, 'card-1-2');
  assert.equal(matched, 1);
});

test('items whose id was dropped are matched by their text', () => {
  const next = {
    flashcards: [
      { id: 'c-new1', front: 'what is atp?', back: 'Energy currency.' },
      { front: 'Name the cell energy molecule', back: 'Genetic material.' }, // reworded front, same back
    ],
    quiz: [{ id: 'q-zzz', question: 'Where is the stroma?', options: ['a', 'b'], answerIndex: 0 }],
  };
  const { studySet, matched } = reconcileIds(previous, next);
  assert.deepEqual(
    studySet.flashcards.map((c) => c.id),
    ['card-0-1', 'card-1-2']
  );
  assert.equal(studySet.quiz[0].id, 'q-0-4');
  assert.equal(matched, 3);
});

test('a duplicated id goes to the first item; the second gets a fresh one', () => {
  const next = {
    flashcards: [
      { id: 'card-0-1', front: 'What is ATP?', back: 'Energy currency.' },
      { id: 'card-0-1', front: 'Brand new card', back: 'New.' },
    ],
    quiz: [],
  };
  const ids = reconcileIds(previous, next).studySet.flashcards.map((c) => c.id);
  assert.equal(ids[0], 'card-0-1');
  assert.notEqual(ids[1], 'card-0-1');
  assert.equal(new Set(ids).size, 2);
});

test('an id the model explicitly kept is trusted even if the text was rewritten', () => {
  const next = { flashcards: [{ id: 'card-2-3', front: 'Rewritten entirely', back: 'New.' }], quiz: [] };
  assert.equal(reconcileIds(previous, next).studySet.flashcards[0].id, 'card-2-3');
});

test('new items keep a unique id of their own', () => {
  const next = {
    flashcards: [
      { id: 'c-fresh', front: 'New', back: 'Card' },
      { front: 'Another', back: 'One' },
    ],
    quiz: [],
  };
  const { studySet, matched } = reconcileIds(previous, next);
  assert.equal(studySet.flashcards[0].id, 'c-fresh');
  assert.equal(studySet.flashcards[1].id, contentId('c', 'Another'));
  assert.equal(matched, 0);
});

test('reconcileIds does not mutate its inputs', () => {
  const next = { title: 'T', flashcards: [{ front: 'what is atp?', back: 'x', id: 'c-1' }], quiz: [] };
  const frozen = JSON.parse(JSON.stringify(next));
  const { studySet } = reconcileIds(previous, next);
  assert.deepEqual(next, frozen);
  assert.equal(studySet.title, 'T');
});

test('reconcileIds copes with no previous set', () => {
  const next = { flashcards: [{ id: 'c-1', front: 'a', back: 'b' }], quiz: [] };
  assert.equal(reconcileIds(undefined, next).studySet.flashcards[0].id, 'c-1');
});
