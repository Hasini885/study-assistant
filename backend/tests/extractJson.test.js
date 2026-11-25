import test from 'node:test';
import assert from 'node:assert/strict';

import { extractJson } from '../shared/extractJson.js';

test('parses clean JSON directly', () => {
  const result = extractJson('{"a":1}');
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { a: 1 });
  assert.equal(result.strategy, 'direct');
});

test('unwraps markdown code fences', () => {
  const result = extractJson('```json\n{"a":1}\n```');
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { a: 1 });
  assert.equal(result.strategy, 'unfenced');
});

test('ignores prose around the JSON', () => {
  const result = extractJson('Sure! Here you go:\n{"a":1}\nHope that helps!');
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { a: 1 });
});

test('does not stop at a brace inside a string value', () => {
  const result = extractJson('{"a":"a } brace","b":2}');
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { a: 'a } brace', b: 2 });
});

test('handles escaped quotes inside strings', () => {
  const result = extractJson('{"a":"he said \\"hi\\"","b":2}');
  assert.equal(result.ok, true);
  assert.equal(result.value.b, 2);
});

test('strips trailing commas', () => {
  const result = extractJson('{"a":1,"b":[1,2,],}');
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { a: 1, b: [1, 2] });
});

test('replaces smart quotes', () => {
  const result = extractJson('{“a”:1}');
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { a: 1 });
});

test('keeps curly quotes inside string values when repairing a truncated response', () => {
  // Regression: the repair step used to turn every “ and ” into a straight
  // quote, which ended the string early and made the whole response unparseable.
  const truncated =
    '{"title":"Bio","flashcards":[{"front":"What does “ATP” stand for?","back":"Adenosine triphosphate"},' +
    '{"front":"Define “osmo';
  const result = extractJson(truncated);

  assert.equal(result.ok, true);
  assert.equal(result.strategy, 'repaired');
  assert.equal(result.value.flashcards[0].front, 'What does “ATP” stand for?');
  assert.equal(result.value.flashcards[0].back, 'Adenosine triphosphate');
  assert.equal(result.value.flashcards[1].front, 'Define “osmo');
});

test('keeps curly single quotes inside values when repairing', () => {
  const result = extractJson('{"front":"Ohm’s law","back":"V = IR",');
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { front: 'Ohm’s law', back: 'V = IR' });
});

test('handles curly delimiters and curly content in the same response', () => {
  const result = extractJson('{“front”: "The “mitochondria”", “back”: “Powerhouse”,');
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { front: 'The “mitochondria”', back: 'Powerhouse' });
});

test('escapes a straight quote inside a curly-delimited string', () => {
  const result = extractJson('{“a”: “he said "hi"”}');
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { a: 'he said "hi"' });
});

test('does not rewrite commas, brackets or NaN that are inside string values', () => {
  const result = extractJson('{"a":"one, ]","b":"value: NaN,","c":[1,2,],');
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { a: 'one, ]', b: 'value: NaN,', c: [1, 2] });
});

test('converts NaN and undefined to null', () => {
  const result = extractJson('{"a":NaN,"b":undefined}');
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { a: null, b: null });
});

test('recovers a truncated response by closing what is open', () => {
  const truncated = '{"title":"Bio","flashcards":[{"front":"What is ATP?","back":"Energy currency"},{"front":"What is DN';
  const result = extractJson(truncated);

  assert.equal(result.ok, true);
  assert.equal(result.value.title, 'Bio');
  // The complete card survives intact. The half-written one is still here —
  // extraction is deliberately schema-agnostic, and normalizeStudySet is the
  // layer that drops a card with no back (see normalize.test.js).
  assert.equal(result.value.flashcards[0].back, 'Energy currency');
  assert.equal(result.value.flashcards[1].back, undefined);
});

test('recovers when a fence was never closed', () => {
  const result = extractJson('```json\n{"a":1}');
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { a: 1 });
});

test('reports failure on empty input', () => {
  assert.equal(extractJson('').ok, false);
  assert.equal(extractJson(null).ok, false);
});

test('reports failure on text with no JSON in it', () => {
  const result = extractJson('I am sorry, I cannot help with that request.');
  assert.equal(result.ok, false);
});
