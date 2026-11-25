// @ts-check
/**
 * @typedef {import('./types.js').StudySet} StudySet
 * @typedef {import('./types.js').Flashcard} Flashcard
 * @typedef {import('./types.js').QuizQuestion} QuizQuestion
 * @typedef {import('./types.js').CardState} CardState
 * @typedef {import('./types.js').Grade} Grade
 */
/**
 * Quiz question types, and checking a typed answer.
 *
 *   mcq        options[] + answerIndex (the original shape; a missing `type`
 *              means mcq, so sets saved before types existed still work)
 *   truefalse  options are always exactly ['True', 'False'] + answerIndex,
 *              so everything that handles options handles these unchanged
 *   blank      a question with a gap ("_____") + `answer`, plus optional
 *              `accepted` alternatives; answered by typing
 *
 * Pure and dependency-free, shared by the normalizer, the server and the UI.
 */

export const QUIZ_TYPES = /** @type {const} */ (['mcq', 'truefalse', 'blank']);
export const TRUE_FALSE_OPTIONS = Object.freeze(['True', 'False']);
export const BLANK = '_____';

/**
 * @returns {'mcq' | 'truefalse' | 'blank'}
 * @param {Partial<QuizQuestion> | null | undefined} question
 */
export function quizType(question) {
  return question?.type === 'blank' || question?.type === 'truefalse' ? question.type : 'mcq';
}

/**
 * The correct answer as text, whatever the type.
 * @param {QuizQuestion} question
 * @returns {string | undefined}
 */
export function correctAnswerText(question) {
  return question.type === 'blank' ? question.answer : question.options?.[question.answerIndex];
}

/**
 * Case, accents, punctuation, spacing and a leading article don't make an
 * answer wrong: "The Mitochondria." matches "mitochondria".
 * @param {unknown} text
 * @returns {string}
 */
export function normalizeAnswerText(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:a|an|the) /, '');
}

/**
 * Is a typed answer right?
 *
 * Exact after normalizing, or within a small typo budget for longer words —
 * one slip from 5 characters, two from 9 — because a misspelt "mitocondria"
 * shows the student knows it. Anything with a digit in it must match exactly:
 * "1914" is not "1915".
 * @param {unknown} input
 * @param {{answer?: string, accepted?: string[]} | null | undefined} question
 * @returns {boolean}
 */
export function checkBlankAnswer(input, question) {
  const given = normalizeAnswerText(input);
  if (!given) return false;

  const candidates = [question?.answer, ...(Array.isArray(question?.accepted) ? question.accepted : [])]
    .map(normalizeAnswerText)
    .filter(Boolean);

  return candidates.some((expected) => {
    if (given === expected) return true;
    if (/\d/.test(expected) || /\d/.test(given)) return false;
    const budget = expected.length >= 9 ? 2 : expected.length >= 5 ? 1 : 0;
    return budget > 0 && Math.abs(given.length - expected.length) <= budget && editDistance(given, expected) <= budget;
  });
}

/**
 * Levenshtein distance. Inputs here are short answers, so O(n·m) is fine.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

/** Gap markers models use, all rewritten to one consistent BLANK. */
const GAP_PATTERN = /_{2,}|\[(?:blank|\s*)\]|\{blank\}|\.{4,}|…{2,}/gi;

/**
 * @param {unknown} text
 * @returns {boolean}
 */
export function hasGap(text) {
  GAP_PATTERN.lastIndex = 0;
  return GAP_PATTERN.test(String(text ?? ''));
}

/**
 * @param {unknown} text
 * @returns {string}
 */
export function normalizeGaps(text) {
  return String(text ?? '').replace(GAP_PATTERN, BLANK);
}
