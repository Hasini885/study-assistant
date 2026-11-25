import test from 'node:test';
import assert from 'node:assert/strict';

import {
  carryGrounding,
  looksLikeNotes,
  normalizeForQuote,
  quoteAppearsIn,
  verifyGrounding,
} from '../shared/grounding.js';
import { buildGenerateMessages } from '../prompt.js';

const NOTES = `Photosynthesis happens in two stages.
The light-dependent reactions take place in the thylakoid membranes and produce ATP and NADPH.
The Calvin cycle — also called the light-independent reactions — takes place in the *stroma*,
where CO2 is fixed into sugar using the ATP and NADPH made earlier. Plants can’t do this at night.`;

test('looksLikeNotes separates a topic from pasted notes', () => {
  assert.equal(looksLikeNotes('Photosynthesis'), false);
  assert.equal(looksLikeNotes('React hooks: useState, useEffect, useMemo and when each re-runs'), false);
  assert.equal(looksLikeNotes(NOTES), true);
  assert.equal(looksLikeNotes(undefined), false);
});

test('normalizeForQuote folds quote styles, dashes, emphasis, case and spacing', () => {
  assert.equal(normalizeForQuote('  The “Calvin”  cycle — *stroma*…\nCan’t '), `the "calvin" cycle - stroma... can't`);
});

test('quoteAppearsIn finds an exact quote', () => {
  assert.equal(quoteAppearsIn('produce ATP and NADPH', NOTES), true);
});

test('quoteAppearsIn ignores case, spacing, quote style, dashes and markdown', () => {
  assert.equal(quoteAppearsIn('"The Calvin cycle - also called the light-independent reactions"', NOTES), true);
  assert.equal(quoteAppearsIn('takes place in the stroma,', NOTES), true);
  assert.equal(quoteAppearsIn("Plants can't do this at night.", NOTES), true);
  assert.equal(quoteAppearsIn('the  thylakoid\nmembranes', NOTES), true);
});

test('quoteAppearsIn accepts an ellipsis between parts that appear in order', () => {
  assert.equal(quoteAppearsIn('The Calvin cycle … takes place in the stroma', NOTES), true);
  assert.equal(quoteAppearsIn('takes place in the stroma ... The Calvin cycle', NOTES), false); // wrong order
});

test('quoteAppearsIn rejects paraphrases and invented quotes', () => {
  assert.equal(quoteAppearsIn('The Calvin cycle happens in the stroma', NOTES), false);
  assert.equal(quoteAppearsIn('Chlorophyll absorbs mostly green light', NOTES), false);
});

test('quoteAppearsIn rejects quotes too short to be evidence', () => {
  assert.equal(quoteAppearsIn('ATP', NOTES), false);
  assert.equal(quoteAppearsIn('the Calvin cycle ... ATP', NOTES), false); // fragment too short
  assert.equal(quoteAppearsIn('', NOTES), false);
  assert.equal(quoteAppearsIn(undefined, NOTES), false);
});

test('verifyGrounding marks every item and counts the verified ones', () => {
  const set = {
    title: 'Photosynthesis',
    flashcards: [
      { id: 'c-1', front: 'Where is the Calvin cycle?', back: 'Stroma', source: 'takes place in the *stroma*' },
      { id: 'c-2', front: 'What absorbs light?', back: 'Chlorophyll', source: 'chlorophyll absorbs light' },
      { id: 'c-3', front: 'What do light reactions make?', back: 'ATP, NADPH' },
    ],
    quiz: [{ id: 'q-1', question: 'Where?', options: ['a', 'b'], answerIndex: 0, source: 'produce ATP and NADPH' }],
  };
  const { studySet, checked, verified } = verifyGrounding(set, NOTES);
  assert.deepEqual(
    [...studySet.flashcards, ...studySet.quiz].map((i) => i.grounded),
    [true, false, false, true]
  );
  assert.equal(checked, 4);
  assert.equal(verified, 2);
  assert.equal(set.flashcards[0].grounded, undefined, 'input is not mutated');
});

test('carryGrounding keeps a verdict only for an item with the same id and quote', () => {
  const previous = {
    flashcards: [
      { id: 'c-1', source: 'quote one', grounded: true },
      { id: 'c-2', source: 'quote two', grounded: false },
      { id: 'c-3', source: 'quote three', grounded: true },
    ],
    quiz: [{ id: 'q-1', source: 'q', grounded: true }],
  };
  const next = {
    flashcards: [
      { id: 'c-1', source: 'quote one' }, // unchanged → true
      { id: 'c-2', source: 'quote two' }, // unchanged → false
      { id: 'c-3', source: 'a new quote', grounded: true }, // re-sourced → no verdict, even if claimed
      { id: 'c-4', front: 'new card' }, // new → no verdict
    ],
    quiz: [{ id: 'q-1', source: 'q' }],
  };
  const result = carryGrounding(previous, next);
  assert.deepEqual(
    result.flashcards.map((c) => c.grounded),
    [true, false, undefined, undefined]
  );
  assert.equal('grounded' in result.flashcards[2], false);
  assert.equal(result.quiz[0].grounded, true);
});

test('the prompt asks for source quotes only in notes mode', () => {
  assert.match(buildGenerateMessages({ input: NOTES, withSources: true })[1].content, /"source" field/);
  assert.doesNotMatch(buildGenerateMessages({ input: 'Photosynthesis' })[1].content, /"source"/);
});
