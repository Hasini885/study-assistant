import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DAY,
  MINUTE,
  endOfDay,
  formatInterval,
  isDueToday,
  isValidCardState,
  newCardState,
  previewIntervals,
  schedule,
} from '../shared/srs.js';

const NOW = new Date(2026, 0, 15, 10, 0, 0).getTime(); // local 10:00

function answer(grades, start = NOW) {
  let state = newCardState();
  let now = start;
  for (const grade of grades) {
    state = schedule(state, grade, now);
    now = state.due; // review exactly when due
  }
  return state;
}

test('a new card starts unlearned and not due', () => {
  const state = newCardState();
  assert.ok(isValidCardState(state));
  assert.equal(isDueToday(state, NOW), false);
});

test('first answers schedule Anki-style learning steps', () => {
  assert.equal(schedule(null, 'again', NOW).due - NOW, 10 * MINUTE);
  assert.equal(schedule(null, 'hard', NOW).interval, 1);
  assert.equal(schedule(null, 'good', NOW).interval, 1);
  assert.equal(schedule(null, 'easy', NOW).interval, 4);
});

test('second successful answers step up again', () => {
  const once = schedule(null, 'good', NOW);
  assert.equal(schedule(once, 'hard', NOW).interval, 2);
  assert.equal(schedule(once, 'good', NOW).interval, 3);
  assert.equal(schedule(once, 'easy', NOW).interval, 6);
});

test('later Good answers multiply the interval by the ease', () => {
  const state = answer(['good', 'good', 'good']);
  assert.equal(state.interval, Math.round(3 * 2.5)); // 8
  assert.equal(state.reps, 3);
  assert.equal(state.due, state.last + state.interval * DAY);
});

test('Hard grows the interval less than Good, Easy more', () => {
  const base = answer(['good', 'good', 'good']);
  const hard = schedule(base, 'hard', base.due).interval;
  const good = schedule(base, 'good', base.due).interval;
  const easy = schedule(base, 'easy', base.due).interval;
  assert.ok(hard < good && good < easy, `${hard} < ${good} < ${easy}`);
  assert.ok(hard > base.interval, 'a successful review never shrinks the interval');
});

test('Again resets the streak, counts a lapse and lowers the ease', () => {
  const learned = answer(['good', 'good', 'good']);
  const forgot = schedule(learned, 'again', NOW);
  assert.equal(forgot.reps, 0);
  assert.equal(forgot.lapses, 1);
  assert.equal(forgot.interval, 0);
  assert.equal(forgot.ease, 2.3);
  assert.equal(forgot.due, NOW + 10 * MINUTE);
});

test('Again on a card that was never learned is not a lapse', () => {
  assert.equal(schedule(null, 'again', NOW).lapses, 0);
});

test('ease is clamped between 1.3 and 3.5', () => {
  let state = newCardState();
  for (let i = 0; i < 20; i++) state = schedule(state, 'again', NOW);
  assert.equal(state.ease, 1.3);

  state = newCardState();
  for (let i = 0; i < 30; i++) state = schedule(state, 'easy', NOW);
  assert.equal(state.ease, 3.5);
});

test('intervals are capped at a year', () => {
  const state = answer(Array(30).fill('easy'));
  assert.equal(state.interval, 365);
});

test('schedule is pure: it never mutates its input', () => {
  const state = Object.freeze(newCardState());
  schedule(state, 'good', NOW);
  assert.deepEqual(state, newCardState());
});

test('schedule treats corrupt state as a new card', () => {
  assert.deepEqual(schedule({ reps: 'lots' }, 'good', NOW), schedule(null, 'good', NOW));
});

test('schedule rejects an unknown grade or a missing clock', () => {
  assert.throws(() => schedule(null, 'perfect', NOW), /Unknown grade/);
  assert.throws(() => schedule(null, 'good', undefined), /timestamp/);
});

test('previewIntervals reports what each grade would schedule', () => {
  const preview = previewIntervals(null, NOW);
  assert.deepEqual(preview, { again: 10 * MINUTE, hard: DAY, good: DAY, easy: 4 * DAY });
});

test('formatInterval is short and human', () => {
  assert.equal(formatInterval(10 * MINUTE), '10m');
  assert.equal(formatInterval(20_000), '1m');
  assert.equal(formatInterval(3 * 60 * MINUTE), '3h');
  assert.equal(formatInterval(DAY), '1d');
  assert.equal(formatInterval(13 * DAY), '13d');
  assert.equal(formatInterval(21 * DAY), '3w');
  assert.equal(formatInterval(90 * DAY), '3mo');
  assert.equal(formatInterval(365 * DAY), '1y');
  assert.equal(formatInterval(-1), '');
});

test('a card is due today until the end of the local day', () => {
  const tonight = schedule(null, 'again', NOW); // due 10:10
  assert.equal(isDueToday(tonight, NOW), true);

  const tomorrow = schedule(null, 'good', NOW); // due tomorrow 10:00
  assert.equal(isDueToday(tomorrow, NOW), false);
  assert.equal(isDueToday(tomorrow, NOW + DAY), true);
  assert.equal(isDueToday(tomorrow, endOfDay(NOW + DAY) - DAY), false); // 23:59 today
});

test('endOfDay is the last millisecond of the local day', () => {
  const end = new Date(endOfDay(NOW));
  assert.equal(end.getDate(), 15);
  assert.equal(end.getHours(), 23);
  assert.equal(end.getMilliseconds(), 999);
});

test('isValidCardState rejects anything storage could have mangled', () => {
  const good = schedule(null, 'good', NOW);
  assert.equal(isValidCardState(good), true);
  for (const bad of [
    null,
    'state',
    { ...good, reps: -1 },
    { ...good, reps: 1.5 },
    { ...good, ease: 9 },
    { ...good, ease: 0.5 },
    { ...good, interval: -2 },
    { ...good, interval: 10_000 },
    { ...good, due: Number.NaN },
    { ...good, last: undefined },
  ]) {
    assert.equal(isValidCardState(bad), false, JSON.stringify(bad));
  }
});
