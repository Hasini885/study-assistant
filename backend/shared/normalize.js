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
 *   flashcards: [{ id, front, back, hint }],
 *   quiz: [{ id, question, options: string[], answerIndex: number, explanation }]
 * }
 */

export const LIMITS = {
  title: 120,
  summary: 400,
  text: 600,
  option: 300,
  maxFlashcards: 40,
  maxQuizQuestions: 30,
  minOptions: 2,
  maxOptions: 6,
};

/** @returns {{ok: true, data: object, repairs: string[]} | {ok: false, reason: string, repairs: string[]}} */
export function normalizeStudySet(raw, { topic = '' } = {}) {
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

function normalizeFlashcards(list, repairs) {
  const out = [];
  const seen = new Set();
  let dropped = 0;

  for (const item of list) {
    if (out.length >= LIMITS.maxFlashcards) {
      repairs.push(`Kept the first ${LIMITS.maxFlashcards} flashcards; the model returned more.`);
      break;
    }

    // Some models return ["term - definition"] or [["term","definition"]].
    const card = coerceToPair(item, ['front', 'question', 'term', 'q', 'prompt', 'name'], ['back', 'answer', 'definition', 'a', 'response', 'value']);

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
      id: makeId('card', out.length),
      front,
      back,
      hint: cleanString(isPlainObject(item) ? pick(item, ['hint', 'clue', 'tip']) : '', LIMITS.text),
    });
  }

  if (dropped > 0) repairs.push(`Skipped ${dropped} malformed or duplicate flashcard${dropped === 1 ? '' : 's'}.`);
  return out;
}

/* -------------------------------------------------------------------------- */
/* quiz                                                                       */
/* -------------------------------------------------------------------------- */

function normalizeQuiz(list, repairs) {
  const out = [];
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

    const rawOptions = pickArray(item, ['options', 'choices', 'answers', 'alternatives']);
    // Options sometimes arrive as objects ({text, correct}) or as "A) Paris".
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

    if (options.length < LIMITS.minOptions) {
      dropped++;
      continue;
    }

    const answerIndex = resolveAnswerIndex(item, options, correctFromObject);
    if (answerIndex === -1) {
      dropped++;
      continue;
    }

    out.push({
      id: makeId('q', out.length),
      question,
      options,
      answerIndex,
      explanation: cleanString(pick(item, ['explanation', 'rationale', 'why', 'reason']), LIMITS.text),
    });
  }

  if (dropped > 0) repairs.push(`Skipped ${dropped} unanswerable quiz question${dropped === 1 ? '' : 's'}.`);
  return out;
}

/**
 * Work out which option is correct. Models express this at least six
 * different ways, and getting it wrong silently would mark right answers as
 * wrong — the worst possible failure for a study tool. When we can't be sure,
 * we return -1 and drop the question.
 */
function resolveAnswerIndex(item, options, correctFromObject) {
  if (correctFromObject >= 0) return correctFromObject;

  const raw = pick(item, [
    'answerIndex', 'answer_index', 'correctIndex', 'correct_index',
    'answer', 'correctAnswer', 'correct_answer', 'correct', 'solution',
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
    .map((o, i) => [o.toLowerCase(), i])
    .filter(([o]) => target.length > 2 && (o.includes(target) || target.includes(o)));
  if (partial.length === 1) return partial[0][1];

  return -1;
}

/** "A) Paris" / "3. Paris" / "- Paris" -> "Paris" */
function stripOptionLabel(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/^\s*(?:[-*•]\s*|\(?[a-zA-Z]\)[.:]?\s*|\(?\d+\)?[.:]\s*)/, '').trim();
}

/* -------------------------------------------------------------------------- */
/* helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Peel off wrappers like {data: {...}} or {studySet: {...}} or [ {...} ]. */
function unwrap(raw, repairs) {
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
    const wrapperKey = ['data', 'result', 'response', 'studySet', 'study_set', 'output', 'json']
      .find((k) => isPlainObject(node[k]) && !('flashcards' in node) && !('quiz' in node));
    if (!wrapperKey) return node;
    node = node[wrapperKey];
    repairs.push(`Unwrapped a "${wrapperKey}" envelope.`);
  }
  return node;
}

function pick(obj, keys) {
  if (!isPlainObject(obj)) return undefined;
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return undefined;
}

function pickArray(obj, keys) {
  const value = pick(obj, keys);
  return Array.isArray(value) ? value : [];
}

const RESERVED_CARD_KEYS = new Set([
  'front', 'back', 'question', 'answer', 'term', 'definition',
  'q', 'a', 'prompt', 'response', 'name', 'value', 'hint', 'clue', 'tip',
]);

/** Turn strings, tuples, or objects into a {front, back} pair. */
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

function cleanString(value, max) {
  if (typeof value === 'number' || typeof value === 'boolean') value = String(value);
  if (typeof value !== 'string') return '';
  // Collapse runaway whitespace but keep the string readable.
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

function fallbackTitle(topic) {
  const clean = cleanString(topic, 60);
  return clean ? `Study set: ${clean}` : 'Study set';
}

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isScalar(v) {
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

function isTruthy(v) {
  return v === true || v === 'true' || v === 1 || v === '1';
}

let idCounter = 0;
function makeId(prefix, index) {
  idCounter += 1;
  return `${prefix}-${index}-${idCounter.toString(36)}`;
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
      textProblem(card.hint, `${where}'s hint`, LIMITS.text, { optional: true });
    if (problem) return problem;
  }

  for (const [i, q] of quiz.entries()) {
    const where = `question ${i + 1}`;
    if (q.options.length > LIMITS.maxOptions) {
      return `${q.options.length} options in ${where} (the limit is ${LIMITS.maxOptions})`;
    }
    const problem =
      textProblem(q.question, where, LIMITS.text) ||
      textProblem(q.explanation, `${where}'s explanation`, LIMITS.text, { optional: true }) ||
      q.options.reduce((found, option, n) => found || textProblem(option, `option ${n + 1} of ${where}`, LIMITS.option), null);
    if (problem) return problem;
  }

  return null;
}

function textProblem(value, label, max, { optional = false } = {}) {
  if (value === undefined || value === null) return optional ? null : `no text for ${label}`;
  if (typeof value !== 'string') return `a non-text value for ${label}`;
  if (value.length > max) return `${value.length.toLocaleString('en-US')} characters in ${label} (the limit is ${max})`;
  return null;
}

/**
 * Cheap client-side guard. The server already normalizes, but the client
 * shouldn't trust that a response on the wire matches what it expects.
 */
export function isValidStudySet(value) {
  return (
    isPlainObject(value) &&
    Array.isArray(value.flashcards) &&
    Array.isArray(value.quiz) &&
    value.flashcards.every((c) => isPlainObject(c) && typeof c.front === 'string' && typeof c.back === 'string') &&
    value.quiz.every(
      (q) =>
        isPlainObject(q) &&
        typeof q.question === 'string' &&
        Array.isArray(q.options) &&
        q.options.length >= LIMITS.minOptions &&
        Number.isInteger(q.answerIndex) &&
        q.answerIndex >= 0 &&
        q.answerIndex < q.options.length
    ) &&
    value.flashcards.length + value.quiz.length > 0
  );
}
