// @ts-check
/**
 * @typedef {import('./types.js').StudySet} StudySet
 * @typedef {import('./types.js').Flashcard} Flashcard
 * @typedef {import('./types.js').QuizQuestion} QuizQuestion
 * @typedef {import('./types.js').CardState} CardState
 * @typedef {import('./types.js').Grade} Grade
 */
/**
 * Spaced-repetition scheduling: a pure SM-2 variant with four grades.
 *
 * SM-2 rather than FSRS because every number it produces can be explained in
 * one sentence ("a Good answer multiplies the interval by the card's ease"),
 * it needs no trained parameters, and its behaviour on a deck of eight cards
 * is indistinguishable from FSRS's. The four-grade shape (Again / Hard / Good
 * / Easy) follows Anki, which is what students already know.
 *
 * Pure and dependency-free: the same function runs in the browser and in the
 * tests, and `now` is always passed in so nothing here reads the clock.
 *
 * Card state:
 *   { reps, lapses, ease, interval, due, last }
 *   reps      successful reviews in a row (reset by Again)
 *   lapses    times the card was forgotten after being learned
 *   ease      interval multiplier for Good, 1.3 – 3.5
 *   interval  days until the next review (0 while relearning)
 *   due       epoch ms when the card is next due
 *   last      epoch ms of the last review
 */

export const GRADES = /** @type {const} */ (['again', 'hard', 'good', 'easy']);

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

const START_EASE = 2.5;
const MIN_EASE = 1.3;
const MAX_EASE = 3.5;
const RELEARN_DELAY = 10 * MINUTE;
const MAX_INTERVAL_DAYS = 365;

/**
 * A card that has never been graded.
 * @returns {CardState}
 */
export function newCardState() {
  return { reps: 0, lapses: 0, ease: START_EASE, interval: 0, due: 0, last: 0 };
}

/**
 * The state after answering a card with `grade` at time `now`.
 * @param {ReturnType<typeof newCardState> | null | undefined} state
 * @param {'again' | 'hard' | 'good' | 'easy'} grade
 * @param {number} now epoch ms
 */
export function schedule(state, grade, now) {
  if (!GRADES.includes(grade)) throw new TypeError(`Unknown grade: ${grade}`);
  if (!Number.isFinite(now)) throw new TypeError('`now` must be a timestamp');

  const prev = isValidCardState(state) ? state : newCardState();

  if (grade === 'again') {
    return {
      reps: 0,
      lapses: prev.reps > 0 ? prev.lapses + 1 : prev.lapses,
      ease: clampEase(prev.ease - 0.2),
      interval: 0,
      due: now + RELEARN_DELAY,
      last: now,
    };
  }

  const ease = clampEase(prev.ease + { hard: -0.15, good: 0, easy: 0.15 }[grade]);
  const interval = nextInterval(prev, grade, ease);

  return {
    reps: prev.reps + 1,
    lapses: prev.lapses,
    ease,
    interval,
    due: now + interval * DAY,
    last: now,
  };
}

/**
 * @param {CardState} prev
 * @param {Exclude<Grade, 'again'>} grade
 * @param {number} ease
 * @returns {number}
 */
function nextInterval(prev, grade, ease) {
  let days;
  if (prev.reps === 0) {
    // First successful answer (or first after a lapse).
    days = { hard: 1, good: 1, easy: 4 }[grade];
  } else if (prev.reps === 1) {
    days = { hard: 2, good: 3, easy: 6 }[grade];
  } else {
    const base = Math.max(prev.interval, 1);
    days = {
      hard: base * 1.2,
      good: base * ease,
      easy: base * ease * 1.3,
    }[grade];
    // Never schedule a successful review sooner than the last one.
    days = Math.max(Math.round(days), base + 1);
  }
  return Math.min(days, MAX_INTERVAL_DAYS);
}

/**
 * What each grade would schedule, for labelling the buttons ("10m", "3d").
 * @param {CardState | null | undefined} state
 * @param {number} now
 * @returns {Record<Grade, number>}
 */
export function previewIntervals(state, now) {
  return /** @type {Record<Grade, number>} */ (
    Object.fromEntries(GRADES.map((grade) => [grade, schedule(state, grade, now).due - now]))
  );
}

/**
 * "10m", "1d", "3w", "4mo"
 * @param {number} ms
 * @returns {string}
 */
export function formatInterval(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / MINUTE))}m`;
  if (ms < DAY) return `${Math.round(ms / HOUR)}h`;
  const days = Math.round(ms / DAY);
  if (days < 14) return `${days}d`;
  if (days < 60) return `${Math.round(days / 7)}w`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${Math.round((days / 365) * 10) / 10}y`;
}

/**
 * The last millisecond of the local day containing `now`.
 * @param {number} now
 * @returns {number}
 */
export function endOfDay(now) {
  const date = new Date(now);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

/**
 * Graded at least once, and due at or before the end of today.
 * @param {unknown} state
 * @param {number} now
 * @returns {boolean}
 */
export function isDueToday(state, now) {
  return isValidCardState(state) && state.last > 0 && state.due <= endOfDay(now);
}

/**
 * Storage is untrusted, so state read back from it is checked field by field.
 * @param {any} value
 * @returns {value is CardState}
 */
export function isValidCardState(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    isCount(value.reps) &&
    isCount(value.lapses) &&
    Number.isFinite(value.ease) &&
    value.ease >= MIN_EASE &&
    value.ease <= MAX_EASE &&
    Number.isFinite(value.interval) &&
    value.interval >= 0 &&
    value.interval <= MAX_INTERVAL_DAYS &&
    Number.isFinite(value.due) &&
    value.due >= 0 &&
    Number.isFinite(value.last) &&
    value.last >= 0
  );
}

/**
 * @param {any} n
 * @returns {boolean}
 */
function isCount(n) {
  return Number.isInteger(n) && n >= 0;
}

/**
 * @param {number} ease
 * @returns {number}
 */
function clampEase(ease) {
  return Math.round(Math.min(MAX_EASE, Math.max(MIN_EASE, ease)) * 100) / 100;
}
