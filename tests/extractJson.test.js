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
