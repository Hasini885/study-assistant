// @ts-check
/**
 * @typedef {import('./types.js').StudySet} StudySet
 * @typedef {import('./types.js').Flashcard} Flashcard
 * @typedef {import('./types.js').QuizQuestion} QuizQuestion
 * @typedef {import('./types.js').CardState} CardState
 * @typedef {import('./types.js').Grade} Grade
 */
/**
 * Grounding: checking that study material drawn from pasted notes really
 * comes from those notes.
 *
 * When the input is notes (not a bare topic), the model is asked to attach a
 * short word-for-word "source" quote to every flashcard and quiz question.
 * Models paraphrase, embellish and occasionally invent quotes, so the quote is
 * never taken on trust: the server looks for it in the notes and marks the
 * item `grounded: true` only if it's actually there. The UI shows verified
 * items as "From your notes" and unverified ones with a quiet warning.
 *
 * This proves the quote is real, not that the card is a fair reading of it —
 * but a card whose quote can't be found is exactly the one worth a second look.
 */

/** Quotes shorter than this match almost anything, so they don't count as evidence. */
const MIN_QUOTE_CHARS = 12;
/** A fragment between "…" must still be long enough to be specific. */
const MIN_FRAGMENT_CHARS = 6;

/**
 * Is this input notes to draw from, rather than a topic to write about?
 * A topic is a phrase; notes are prose. 40 words is comfortably above any
 * topic anyone types and below a single paragraph of notes.
 * @param {unknown} input
 * @returns {boolean}
 */
export function looksLikeNotes(input) {
  const words = String(input ?? '').trim().split(/\s+/).filter(Boolean);
  return words.length >= 40;
}

/**
 * Folds away differences that don't change the words: case, curly vs
 * straight quotes, dash styles, ellipsis characters, markdown emphasis,
 * zero-width characters and whitespace.
 * @param {unknown} text
 * @returns {string}
 */
export function normalizeForQuote(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[​-‍﻿]/g, '')
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐‑‒–—―−]/g, '-')
    .replace(/…/g, '...')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Does `quote` appear in `notes`? A quote with an ellipsis in the middle
 * ("the stroma ... light-independent") matches if each part appears, in order.
 * @param {unknown} quote
 * @param {unknown} notes
 * @returns {boolean}
 */
export function quoteAppearsIn(quote, notes) {
  const cleanQuote = normalizeForQuote(quote)
    // Wrapping quote marks and trailing punctuation aren't part of the source.
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .replace(/^\.{3}\s*|\s*\.{3}$/g, '')
    .replace(/[.,;:!?]+$/, '');
  if (cleanQuote.length < MIN_QUOTE_CHARS) return false;

  const haystack = normalizeForQuote(notes);
  const fragments = cleanQuote
    .split(/\s*\.{3}\s*/)
    .map((f) => f.trim())
    .filter(Boolean);
  if (fragments.some((f) => f.length < MIN_FRAGMENT_CHARS)) return false;

  let from = 0;
  for (const fragment of fragments) {
    const at = haystack.indexOf(fragment, from);
    if (at === -1) return false;
    from = at + fragment.length;
  }
  return true;
}

/**
 * Marks every flashcard and quiz question with `grounded`, checked against the
 * notes. An item with no quote is ungrounded: in notes mode every item was
 * asked for one.
 *
 * @returns {{studySet: object, checked: number, verified: number}} a new set
 * @param {StudySet} studySet
 * @param {string} notes
 */
export function verifyGrounding(studySet, notes) {
  let verified = 0;
  /** @type {<T extends Flashcard | QuizQuestion>(item: T) => T} */
  const mark = (item) => {
    const grounded = Boolean(item.source) && quoteAppearsIn(item.source, notes);
    if (grounded) verified++;
    return { ...item, grounded };
  };

  const flashcards = studySet.flashcards.map(mark);
  const quiz = studySet.quiz.map(mark);
  return {
    studySet: { ...studySet, flashcards, quiz },
    checked: flashcards.length + quiz.length,
    verified,
  };
}

/**
 * After a refinement there are no notes to check against — the request only
 * carries the set. An item keeps its verdict if it kept its id and its quote;
 * anything new or re-sourced has no verdict (`grounded` absent) rather than a
 * wrong one.
 * @param {StudySet | null | undefined} previous
 * @param {StudySet} next
 * @returns {StudySet}
 */
export function carryGrounding(previous, next) {
  const verdicts = new Map();
  for (const item of [...(previous?.flashcards ?? []), ...(previous?.quiz ?? [])]) {
    if (typeof item.grounded === 'boolean') verdicts.set(`${item.id}\u0000${item.source ?? ''}`, item.grounded);
  }

  /** @type {<T extends Flashcard | QuizQuestion>(item: T) => T} */
  const carry = (item) => {
    const { grounded: _ignored, ...rest } = item;
    const verdict = verdicts.get(`${item.id}\u0000${item.source ?? ''}`);
    return /** @type {typeof item} */ (verdict === undefined ? rest : { ...rest, grounded: verdict });
  };

  return { ...next, flashcards: next.flashcards.map(carry), quiz: next.quiz.map(carry) };
}
