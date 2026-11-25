// @ts-check
/**
 * The contract, as types.
 *
 * These typedefs describe what normalizeStudySet produces and what every
 * other part of the app (the pipeline, storage, share links, the UI) may rely
 * on. `npm run typecheck` checks backend/shared against them; the runtime
 * guards (isValidStudySet, studySetLimitViolation) enforce the same shape on
 * data that arrives from outside.
 */

/**
 * @typedef {object} Flashcard
 * @property {string} id      stable across refinement — see ids.js
 * @property {string} front
 * @property {string} back
 * @property {string} [hint]
 * @property {string} [source]    a quote from the user's notes — see grounding.js
 * @property {boolean} [grounded] set only by the server's check of `source`
 */

/**
 * @typedef {object} ChoiceQuestion  multiple choice or true/false
 * @property {string} id
 * @property {'mcq' | 'truefalse'} [type]  absent on sets saved before quiz types existed
 * @property {string} question
 * @property {string[]} options    true/false is always ['True', 'False']
 * @property {number} answerIndex  zero-based index into options
 * @property {string} [explanation]
 * @property {string} [source]
 * @property {boolean} [grounded]
 */

/**
 * @typedef {object} BlankQuestion  fill in the blank
 * @property {string} id
 * @property {'blank'} type
 * @property {string} question     contains a gap marker, "_____"
 * @property {string} answer
 * @property {string[]} [accepted]  other answers that count as right
 * @property {string} [explanation]
 * @property {string} [source]
 * @property {boolean} [grounded]
 */

/** @typedef {ChoiceQuestion | BlankQuestion} QuizQuestion */

/**
 * @typedef {object} StudySet
 * @property {string} title
 * @property {string} summary
 * @property {Flashcard[]} flashcards
 * @property {QuizQuestion[]} quiz
 */

/**
 * Spaced-repetition state for one card — see srs.js.
 * @typedef {object} CardState
 * @property {number} reps      successful reviews in a row
 * @property {number} lapses    times forgotten after being learned
 * @property {number} ease      interval multiplier, 1.3 – 3.5
 * @property {number} interval  days until the next review
 * @property {number} due       epoch ms
 * @property {number} last      epoch ms of the last review
 */

/** @typedef {'again' | 'hard' | 'good' | 'easy'} Grade */

export {};
