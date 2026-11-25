// @ts-check
/**
 * @typedef {import('./types.js').StudySet} StudySet
 * @typedef {import('./types.js').Flashcard} Flashcard
 * @typedef {import('./types.js').QuizQuestion} QuizQuestion
 * @typedef {import('./types.js').CardState} CardState
 * @typedef {import('./types.js').Grade} Grade
 */
/**
 * Shape validation and repair for study sets.
 *
 * The guiding rule: *salvage, don't reject*. A model that returns 8 good
 * flashcards and 2 malformed ones should give the user 8 flashcards, not an
 * error screen. Only a set with nothing usable in it fails outright.
 *
 * Every repair is recorded so the UI can be honest about what it dropped, and
 * so the server can log which prompts drift.
 *
 * Target shape:
 * {
 *   title: string,
 *   summary: string,
 *   flashcards: [{ id, front, back, hint }],   ids are stable: see ids.js
 *   quiz: [{ id, type: 'mcq' | 'truefalse', question, options: string[], answerIndex: number, explanation }
 *        | { id, type: 'blank', question, answer: string, accepted: string[], explanation }]
 *   (a quiz item with no type is mcq — see quiz.js)
 *
 * Either kind of item may also carry `source` (a quote from the user's notes,
 * see grounding.js) and, once the server has checked that quote, `grounded`.
 * }
 */

import { claimUniqueId, contentId, isWellFormedId } from './ids.js';
import { TRUE_FALSE_OPTIONS, hasGap, normalizeGaps } from './quiz.js';

export const LIMITS = {
  title: 120,
  summary: 400,
  text: 600,
  option: 300,
  source: 300,
  maxFlashcards: 40,
  maxQuizQuestions: 30,
  minOptions: 2,
  maxOptions: 6,
  maxAccepted: 5,
};

/**
 * @returns {{ok: true, data: object, repairs: string[]} | {ok: false, reason: string, repairs: string[]}}
 * @param {unknown} raw
 * @param {{topic?: string}} [options]
 */
export function normalizeStudySet(raw, { topic = '' } = {}) {
  /** @type {string[]} */
  const repairs = [];
  const root = unwrap(raw, repairs);

  if (!isPlainObject(root)) {
    return { ok: false, reason: 'shape', repairs };
  }

  const rawFlashcards = pick(root, ['flashcards', 'cards', 'flash_cards', 'deck']);
  const rawQuiz = pick(root, ['quiz', 'questions', 'quizQuestions', 'quiz_questions', 'mcqs']);

  const flashcards = normalizeFlashcards(Array.isArray(rawFlashcards) ? rawFlashcards : [], repairs);
  const quiz = normalizeQuiz(Array.isArray(rawQuiz) ? rawQuiz : [], repairs);

  if (flashcards.length === 0 && quiz.length === 0) {
    // Distinguish "the model used our schema and had nothing to put in it"
    // from "the model ignored our schema entirely". The first is a real answer
    // and retrying just repeats it; the second is worth one repair attempt.
    const usedOurSchema = Array.isArray(rawFlashcards) || Array.isArray(rawQuiz);
    return { ok: false, reason: usedOurSchema ? 'empty' : 'shape', repairs };
  }

  // A set with only one half is still useful — say so rather than failing.
  if (flashcards.length === 0) repairs.push('No usable flashcards were returned; showing the quiz only.');
  if (quiz.length === 0) repairs.push('No usable quiz questions were returned; showing flashcards only.');

  return {
    ok: true,
    repairs,
    data: {
      title: cleanString(pick(root, ['title', 'topic', 'name']), LIMITS.title) || fallbackTitle(topic),
      summary: cleanString(pick(root, ['summary', 'overview', 'description']), LIMITS.summary),
      flashcards,
      quiz,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* flashcards                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * @param {unknown[]} list
 * @param {string[]} repairs
 * @returns {Flashcard[]}
 */
function normalizeFlashcards(list, repairs) {
  const out = [];
  const seen = new Set();
  const usedIds = new Set();
  let dropped = 0;

  for (const item of list) {
    if (out.length >= LIMITS.maxFlashcards) {
      repairs.push(`Kept the first ${LIMITS.maxFlashcards} flashcards; the model returned more.`);
      break;
    }

    // Some models return ["term - definition"] or [["term","definition"]].
    const card = coerceToPair(
      item,
      ['front', 'question', 'term', 'q', 'prompt', 'name'],
      ['back', 'answer', 'definition', 'a', 'response', 'value']
    );

    if (!card) {
      dropped++;
      continue;
    }

    const front = cleanString(card.front, LIMITS.text);
    const back = cleanString(card.back, LIMITS.text);
    if (!front || !back) {
      dropped++;
      continue;
    }

    const key = front.toLowerCase();
    if (seen.has(key)) {
      dropped++;
      continue;
    }
    seen.add(key);

    out.push({
      id: itemId(item, 'c', front, usedIds),
      front,
      back,
      hint: cleanString(isPlainObject(item) ? pick(item, ['hint', 'clue', 'tip']) : '', LIMITS.text),
      ...sourceField(item),
    });
  }

  if (dropped > 0) repairs.push(`Skipped ${dropped} malformed or duplicate flashcard${dropped === 1 ? '' : 's'}.`);
  return out;
}

/* -------------------------------------------------------------------------- */
/* quiz                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * @param {unknown[]} list
 * @param {string[]} repairs
 * @returns {QuizQuestion[]}
 */
function normalizeQuiz(list, repairs) {
  const out = [];
  const usedIds = new Set();
  let dropped = 0;

  for (const item of list) {
    if (out.length >= LIMITS.maxQuizQuestions) {
      repairs.push(`Kept the first ${LIMITS.maxQuizQuestions} quiz questions; the model returned more.`);
      break;
    }
    if (!isPlainObject(item)) {
      dropped++;
      continue;
    }

    const question = cleanString(pick(item, ['question', 'prompt', 'q', 'text', 'front']), LIMITS.text);
    if (!question) {
      dropped++;
      continue;
    }

    const { options, correctFromObject } = readOptions(item);
    const shape = detectType(item, question, options);

    let body;
    if (shape === 'blank') body = normalizeBlank(item, question);
    else if (shape === 'truefalse') body = normalizeTrueFalse(item, question, options, correctFromObject);
    else body = normalizeChoice(item, question, options, correctFromObject);

    if (!body) {
      dropped++;
      continue;
    }

    out.push({
      id: itemId(item, 'q', body.question, usedIds),
      ...body,
      explanation: cleanString(pick(item, ['explanation', 'rationale', 'why', 'reason']), LIMITS.text),
      ...sourceField(item),
    });
  }

  if (dropped > 0) repairs.push(`Skipped ${dropped} unanswerable quiz question${dropped === 1 ? '' : 's'}.`);
  return out;
}

/**
 * Options sometimes arrive as objects ({text, correct}) or as "A) Paris".
 * @param {Record<string, any>} item
 * @returns {{options: string[], correctFromObject: number}}
 */
function readOptions(item) {
  const rawOptions = pickArray(item, ['options', 'choices', 'answers', 'alternatives']);
  /** @type {string[]} */
  const options = [];
  let correctFromObject = -1;
  for (const opt of rawOptions) {
    if (options.length >= LIMITS.maxOptions) break;
    let text;
    if (isPlainObject(opt)) {
      text = cleanString(pick(opt, ['text', 'option', 'label', 'value', 'answer']), LIMITS.option);
      if (correctFromObject === -1 && isTruthy(pick(opt, ['correct', 'isCorrect', 'is_correct']))) {
        correctFromObject = options.length;
      }
    } else {
      text = cleanString(opt, LIMITS.option);
    }
    text = stripOptionLabel(text);
    if (!text) continue;
    // Case-insensitive dedupe: duplicate options make a question unanswerable.
    if (options.some((o) => o.toLowerCase() === text.toLowerCase())) continue;
    options.push(text);
  }
  return { options, correctFromObject };
}

/**
 * Which kind of question this is. An explicit `type` wins (under any of the
 * names models use for it); otherwise the shape decides — True/False options,
 * or a gap in the question with a typed answer and no options.
 * @param {Record<string, any>} item
 * @param {string} question
 * @param {string[]} options
 * @returns {'mcq' | 'truefalse' | 'blank'}
 */
function detectType(item, question, options) {
  const declared = String(pick(item, ['type', 'kind', 'format', 'questionType', 'question_type']) ?? '').toLowerCase();
  if (/blank|fill|cloze|gap|short/.test(declared)) return 'blank';
  if (/true|false|\btf\b|bool/.test(declared)) return 'truefalse';

  const lower = options.map((o) => o.toLowerCase());
  if (options.length === 2 && lower.includes('true') && lower.includes('false')) return 'truefalse';
  if (options.length === 0 && typeof pick(item, ['answer', 'correctAnswer', 'correct_answer']) === 'boolean') {
    return 'truefalse';
  }
  if (options.length === 0 && hasGap(question)) return 'blank';
  return 'mcq';
}

/**
 * @param {Record<string, any>} item
 * @param {string} question
 * @param {string[]} options
 * @param {number} correctFromObject
 * @returns {{type: 'mcq', question: string, options: string[], answerIndex: number} | null}
 */
function normalizeChoice(item, question, options, correctFromObject) {
  if (options.length < LIMITS.minOptions) return null;
  const answerIndex = resolveAnswerIndex(item, options, correctFromObject);
  if (answerIndex === -1) return null;
  return { type: 'mcq', question, options, answerIndex };
}

/**
 * Always stored as ['True', 'False'] so the answer index means the same thing everywhere.
 * @param {Record<string, any>} item
 * @param {string} question
 * @param {string[]} options
 * @param {number} correctFromObject
 * @returns {{type: 'truefalse', question: string, options: string[], answerIndex: number} | null}
 */
function normalizeTrueFalse(item, question, options, correctFromObject) {
  let isTrue = null;

  if (options.length >= 2) {
    const index = resolveAnswerIndex(item, options, correctFromObject);
    if (index !== -1) isTrue = options[index].toLowerCase() === 'true';
  }
  if (isTrue === null) {
    const raw = pick(item, ['answer', 'correctAnswer', 'correct_answer', 'correct', 'solution', 'isTrue', 'is_true']);
    if (typeof raw === 'boolean') isTrue = raw;
    else if (typeof raw === 'string') {
      const value = raw.trim().toLowerCase().replace(/[.!]$/, '');
      if (['true', 't', 'yes'].includes(value)) isTrue = true;
      else if (['false', 'f', 'no'].includes(value)) isTrue = false;
    }
  }
  if (isTrue === null) return null;

  return { type: 'truefalse', question, options: [...TRUE_FALSE_OPTIONS], answerIndex: isTrue ? 0 : 1 };
}

/**
 * @param {Record<string, any>} item
 * @param {string} question
 * @returns {{type: 'blank', question: string, answer: string, accepted: string[]} | null}
 */
function normalizeBlank(item, question) {
  const answer = cleanString(
    pick(item, ['answer', 'correctAnswer', 'correct_answer', 'solution', 'blank', 'expected']),
    LIMITS.option
  );
  if (!answer) return null;

  const accepted = [];
  for (const alt of pickArray(item, [
    'acceptedAnswers',
    'accepted_answers',
    'accepted',
    'alternatives',
    'answers',
    'synonyms',
  ])) {
    const text = cleanString(alt, LIMITS.option);
    if (!text || accepted.length >= LIMITS.maxAccepted) continue;
    if ([answer, ...accepted].some((a) => a.toLowerCase() === text.toLowerCase())) continue;
    accepted.push(text);
  }

  return { type: 'blank', question: normalizeGaps(question), answer, accepted };
}

/**
 * Work out which option is correct. Models express this at least six
 * different ways, and getting it wrong silently would mark right answers as
 * wrong — the worst possible failure for a study tool. When we can't be sure,
 * we return -1 and drop the question.
 * @param {Record<string, any>} item
 * @param {string[]} options
 * @param {number} correctFromObject
 * @returns {number}
 */
function resolveAnswerIndex(item, options, correctFromObject) {
  if (correctFromObject >= 0) return correctFromObject;

  const raw = pick(item, [
    'answerIndex',
    'answer_index',
    'correctIndex',
    'correct_index',
    'answer',
    'correctAnswer',
    'correct_answer',
    'correct',
    'solution',
  ]);

  if (typeof raw === 'number' && Number.isFinite(raw)) {
    if (raw >= 0 && raw < options.length) return Math.floor(raw);
    // 1-based indexing is a very common off-by-one from models.
    if (raw >= 1 && raw <= options.length) return Math.floor(raw) - 1;
    return -1;
  }

  if (typeof raw !== 'string') return -1;
  const value = raw.trim();
  if (!value) return -1;

  // "2"
  if (/^\d+$/.test(value)) {
    const n = Number(value);
    if (n >= 0 && n < options.length) return n;
    if (n >= 1 && n <= options.length) return n - 1;
    return -1;
  }

  // "B", "b)", "(C)", "Option D"
  const letter = value.match(/^\(?(?:option\s*)?([a-z])\)?[.:]?$/i);
  if (letter) {
    const index = letter[1].toLowerCase().charCodeAt(0) - 97;
    if (index >= 0 && index < options.length) return index;
    return -1;
  }

  // Full answer text, possibly still carrying its "C) " label.
  const target = stripOptionLabel(value).toLowerCase();
  const exact = options.findIndex((o) => o.toLowerCase() === target);
  if (exact !== -1) return exact;

  // Last resort: unambiguous substring match (exactly one option contains it).
  const partial = options
    .map((o, i) => /** @type {[string, number]} */ ([o.toLowerCase(), i]))
    .filter(([o]) => target.length > 2 && (o.includes(target) || target.includes(o)));
  if (partial.length === 1) return partial[0][1];

  return -1;
}

/**
 * "A) Paris" / "3. Paris" / "- Paris" -> "Paris"
 * @param {unknown} text
 * @returns {string}
 */
function stripOptionLabel(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/^\s*(?:[-*•]\s*|\(?[a-zA-Z]\)[.:]?\s*|\(?\d+\)?[.:]\s*)/, '').trim();
}

/* -------------------------------------------------------------------------- */
/* helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Peel off wrappers like {data: {...}} or {studySet: {...}} or [ {...} ].
 * @param {unknown} raw
 * @param {string[]} repairs
 * @returns {unknown}
 */
function unwrap(raw, repairs) {
  /** @type {any} */
  let node = raw;
  for (let depth = 0; depth < 3; depth++) {
    if (Array.isArray(node)) {
      // A bare array is either the whole set or just a list of cards.
      if (node.length === 1 && isPlainObject(node[0])) {
        node = node[0];
        repairs.push('Unwrapped a single-element array.');
        continue;
      }
      return { flashcards: node };
    }
    if (!isPlainObject(node)) return node;
    const wrapperKey = ['data', 'result', 'response', 'studySet', 'study_set', 'output', 'json'].find(
      (k) => isPlainObject(node[k]) && !('flashcards' in node) && !('quiz' in node)
    );
    if (!wrapperKey) return node;
    node = node[wrapperKey];
    repairs.push(`Unwrapped a "${wrapperKey}" envelope.`);
  }
  return node;
}

/**
 * @param {unknown} obj
 * @param {string[]} keys
 * @returns {any}
 */
function pick(obj, keys) {
  if (!isPlainObject(obj)) return undefined;
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return undefined;
}

/**
 * @param {unknown} obj
 * @param {string[]} keys
 * @returns {unknown[]}
 */
function pickArray(obj, keys) {
  const value = pick(obj, keys);
  return Array.isArray(value) ? value : [];
}

const RESERVED_CARD_KEYS = new Set([
  'front',
  'back',
  'question',
  'answer',
  'term',
  'definition',
  'q',
  'a',
  'prompt',
  'response',
  'name',
  'value',
  'hint',
  'clue',
  'tip',
]);

/**
 * Turn strings, tuples, or objects into a {front, back} pair.
 * @param {unknown} item
 * @param {string[]} frontKeys
 * @param {string[]} backKeys
 * @returns {{front: unknown, back: unknown} | null}
 */
function coerceToPair(item, frontKeys, backKeys) {
  if (isPlainObject(item)) {
    const front = pick(item, frontKeys);
    const back = pick(item, backKeys);
    if (front !== undefined && back !== undefined) return { front, back };

    // {"What is X?": "Y"} — a single-entry object used as the pair itself.
    // Guarded against known field names, otherwise a half-written {front: "..."}
    // would become a card reading "front / ..." instead of being dropped.
    const entries = Object.entries(item);
    const [key, value] = entries[0] ?? [];
    if (entries.length === 1 && isScalar(value) && !RESERVED_CARD_KEYS.has(key)) {
      return { front: key, back: value };
    }
    return null;
  }
  if (Array.isArray(item) && item.length >= 2) {
    return { front: item[0], back: item[1] };
  }
  if (typeof item === 'string') {
    const split = item.split(/\s+[–—-]{1,2}\s+|\s*::\s*|\s*\|\s*/);
    if (split.length >= 2) return { front: split[0], back: split.slice(1).join(' - ') };
  }
  return null;
}

/**
 * The optional supporting quote. Only present when the model gave one, so sets
 * made from a bare topic don't carry an empty field around. `grounded` is
 * never read from the model — only the server's own check sets it.
 * @param {unknown} item
 * @returns {{source?: string}}
 */
function sourceField(item) {
  if (!isPlainObject(item)) return {};
  const raw = pick(item, ['source', 'quote', 'evidence', 'citation']);
  const source = cleanString(raw, LIMITS.source);
  return source ? { source } : {};
}

/**
 * @param {unknown} value
 * @param {number} max
 * @returns {string}
 */
function cleanString(value, max) {
  if (typeof value === 'number' || typeof value === 'boolean') value = String(value);
  if (typeof value !== 'string') return '';
  // Collapse runaway whitespace but keep the string readable.
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

/**
 * @param {string} topic
 * @returns {string}
 */
function fallbackTitle(topic) {
  const clean = cleanString(topic, 60);
  return clean ? `Study set: ${clean}` : 'Study set';
}

/**
 * @param {unknown} v
 * @returns {v is Record<string, any>}
 */
function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * @param {unknown} v
 * @returns {v is string | number | boolean}
 */
function isScalar(v) {
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

/**
 * @param {unknown} v
 * @returns {boolean}
 */
function isTruthy(v) {
  return v === true || v === 'true' || v === 1 || v === '1';
}

/**
 * An id the model sent back (refinement round-trips them), or one derived from
 * the item's text — so the same card gets the same id every time it's
 * normalized, which is what lets progress survive a refine. See ids.js.
 * @param {unknown} item
 * @param {string} prefix
 * @param {string} text
 * @param {Set<string>} usedIds
 * @returns {string}
 */
function itemId(item, prefix, text, usedIds) {
  const given = isPlainObject(item) ? item.id : undefined;
  return claimUniqueId(isWellFormedId(given) ? given : contentId(prefix, text), usedIds);
}

/**
 * Checks a study set that arrived from outside — the browser, which may have
 * read it back from localStorage — against LIMITS.
 *
 * normalizeStudySet *enforces* the same limits on model output by truncating,
 * because there the model made a mistake and salvaging is right. Here it's the
 * opposite: every normalized set already fits, so one that doesn't was built by
 * hand, and repairing it would mean spending model quota on a payload we never
 * produced. So this reports instead of repairing.
 *
 * @returns {string | null} what is wrong, phrased to follow "it has…", or null when the set is fine
 * @param {unknown} value
 */
export function studySetLimitViolation(value) {
  if (!isValidStudySet(value)) return 'an invalid shape';

  const { flashcards, quiz } = value;
  if (flashcards.length > LIMITS.maxFlashcards) {
    return `${flashcards.length} flashcards (the limit is ${LIMITS.maxFlashcards})`;
  }
  if (quiz.length > LIMITS.maxQuizQuestions) {
    return `${quiz.length} quiz questions (the limit is ${LIMITS.maxQuizQuestions})`;
  }

  const fieldProblem =
    textProblem(value.title, 'the title', LIMITS.title, { optional: true }) ||
    textProblem(value.summary, 'the summary', LIMITS.summary, { optional: true });
  if (fieldProblem) return fieldProblem;

  for (const [i, card] of flashcards.entries()) {
    const where = `flashcard ${i + 1}`;
    const problem =
      textProblem(card.front, `${where}'s front`, LIMITS.text) ||
      textProblem(card.back, `${where}'s back`, LIMITS.text) ||
      textProblem(card.hint, `${where}'s hint`, LIMITS.text, { optional: true }) ||
      textProblem(card.source, `${where}'s source`, LIMITS.source, { optional: true }) ||
      flagProblem(card.grounded, `${where}'s grounded flag`);
    if (problem) return problem;
  }

  for (const [i, q] of quiz.entries()) {
    const where = `question ${i + 1}`;
    if (q.type === 'blank') {
      if (q.accepted && q.accepted.length > LIMITS.maxAccepted) {
        return `${q.accepted.length} accepted answers in ${where} (the limit is ${LIMITS.maxAccepted})`;
      }
      const problem =
        textProblem(q.question, where, LIMITS.text) ||
        textProblem(q.answer, `${where}'s answer`, LIMITS.option) ||
        textProblem(q.explanation, `${where}'s explanation`, LIMITS.text, { optional: true }) ||
        textProblem(q.source, `${where}'s source`, LIMITS.source, { optional: true }) ||
        flagProblem(q.grounded, `${where}'s grounded flag`) ||
        (q.accepted ?? []).reduce(
          (found, alt, n) => found || textProblem(alt, `accepted answer ${n + 1} of ${where}`, LIMITS.option),
          /** @type {string | null} */ (null)
        );
      if (problem) return problem;
      continue;
    }
    if (q.options.length > LIMITS.maxOptions) {
      return `${q.options.length} options in ${where} (the limit is ${LIMITS.maxOptions})`;
    }
    const problem =
      textProblem(q.question, where, LIMITS.text) ||
      textProblem(q.explanation, `${where}'s explanation`, LIMITS.text, { optional: true }) ||
      textProblem(q.source, `${where}'s source`, LIMITS.source, { optional: true }) ||
      flagProblem(q.grounded, `${where}'s grounded flag`) ||
      q.options.reduce(
        (found, option, n) => found || textProblem(option, `option ${n + 1} of ${where}`, LIMITS.option),
        /** @type {string | null} */ (null)
      );
    if (problem) return problem;
  }

  return null;
}

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {string | null}
 */
function flagProblem(value, label) {
  return value === undefined || typeof value === 'boolean' ? null : `a non-boolean value for ${label}`;
}

/**
 * @param {unknown} value
 * @param {string} label
 * @param {number} max
 * @param {{optional?: boolean}} [options]
 * @returns {string | null}
 */
function textProblem(value, label, max, { optional = false } = {}) {
  if (value === undefined || value === null) return optional ? null : `no text for ${label}`;
  if (typeof value !== 'string') return `a non-text value for ${label}`;
  if (value.length > max) return `${value.length.toLocaleString('en-US')} characters in ${label} (the limit is ${max})`;
  return null;
}

/**
 * @param {any} q
 * @returns {q is QuizQuestion}
 */
function isValidQuestion(q) {
  if (!isPlainObject(q) || typeof q.question !== 'string') return false;
  if (q.type === 'blank') {
    return (
      typeof q.answer === 'string' &&
      q.answer.trim() !== '' &&
      (q.accepted === undefined || (Array.isArray(q.accepted) && q.accepted.every((a) => typeof a === 'string')))
    );
  }
  return (
    (q.type === undefined || q.type === 'mcq' || q.type === 'truefalse') &&
    Array.isArray(q.options) &&
    q.options.length >= LIMITS.minOptions &&
    q.options.every((o) => typeof o === 'string') &&
    Number.isInteger(q.answerIndex) &&
    q.answerIndex >= 0 &&
    q.answerIndex < q.options.length
  );
}

/**
 * Cheap client-side guard. The server already normalizes, but the client
 * shouldn't trust that a response on the wire matches what it expects.
 * @param {any} value
 * @returns {value is StudySet}
 */
export function isValidStudySet(value) {
  return (
    isPlainObject(value) &&
    Array.isArray(value.flashcards) &&
    Array.isArray(value.quiz) &&
    value.flashcards.every((c) => isPlainObject(c) && typeof c.front === 'string' && typeof c.back === 'string') &&
    value.quiz.every(isValidQuestion) &&
    value.flashcards.length + value.quiz.length > 0
  );
}
