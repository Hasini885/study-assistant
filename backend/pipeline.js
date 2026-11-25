/**
 * The request pipeline, independent of how it is being served.
 *
 * Local development runs this behind Express (`backend/server.js`); production on
 * Vercel runs it inside serverless functions (`api/*.js`). Both share this file
 * so there is exactly one implementation of "turn text into a validated study
 * set", and no chance of the two drifting apart.
 */

import { callGroq, callGroqStream, hasApiKey, primaryModel, UpstreamError } from './groq.js';
import { buildExplainMessages, buildGenerateMessages, buildRefineMessages, buildRepairMessages } from './prompt.js';
import { createRateLimiter, secondsUntil } from './rateLimit.js';
import { reconcileIds } from './shared/ids.js';
import { carryGrounding, looksLikeNotes, verifyGrounding } from './shared/grounding.js';
import { extractJson } from './shared/extractJson.js';
import { LIMITS, normalizeStudySet, isValidStudySet, studySetLimitViolation } from './shared/normalize.js';
import { correctAnswerText } from './shared/quiz.js';

const MAX_INPUT_CHARS = 20_000;
const MAX_ATTEMPTS = 2; // one initial call, one self-repair

export { UpstreamError };

export function defaultModel() {
  return primaryModel();
}

export function healthPayload() {
  return {
    ok: true,
    // Same sanitising as the real call, so health can't report a usable key
    // when only whitespace or a BOM is present.
    configured: hasApiKey(),
    model: defaultModel(),
  };
}

/* -------------------------------------------------------------------------- */
/* entry point                                                                */
/* -------------------------------------------------------------------------- */

let sharedLimiter = null;
function defaultLimiter() {
  // Created on first use, so env vars loaded by dotenv are already in place.
  sharedLimiter ??= createRateLimiter();
  return sharedLimiter;
}

/**
 * What both transports call for /api/study-set and /api/refine: rate limit,
 * validate, generate. The transports only work out the client's IP and wire
 * up cancellation.
 *
 * @param {object} args
 * @param {unknown} args.body   the parsed request body
 * @param {string}  args.ip     the client's address, for rate limiting
 * @param {(body: unknown) => {messages: Array, topic: string, previous?: object}} args.build
 * @param {AbortSignal} [args.signal]
 * @param {{check: (id: string) => Promise<{success: boolean, reset?: number}>}} [args.limiter] injectable for tests
 * @param {typeof generateStudySet} [args.generate] injectable for tests
 */
export async function handleStudySetRequest({
  body,
  ip,
  build,
  signal,
  limiter = defaultLimiter(),
  generate = generateStudySet,
}) {
  const request = await prepareStudySetRequest({ body, ip, build, limiter });
  return generate({ ...request, signal });
}

/**
 * Everything that can reject a request before any model call: the rate limit
 * and input validation. Split out so the streaming transport can run it while
 * it can still answer with a real 4xx status, before committing to a 200
 * event stream.
 */
export async function prepareStudySetRequest({ body, ip, build, limiter = defaultLimiter() }) {
  await enforceRateLimit(ip, limiter);
  return build(body);
}

/**
 * @throws {UpstreamError} a 429 with code `rate_limited` — the same code Groq's
 *   own 429 maps to, so the UI already shows it as "slow down" with a Retry.
 */
export async function enforceRateLimit(ip, limiter = defaultLimiter(), scope = '') {
  // Generation and refinement share one bucket; explanations get their own, so
  // asking why you got a question wrong never costs you a generation.
  const result = await limiter.check(`${scope ? `${scope}:` : ''}ip:${ip || 'unknown'}`);
  if (result.success) return;

  const retryAfter = secondsUntil(result.reset);
  throw new UpstreamError(
    'rate_limited',
    `You're generating faster than this app allows. Try again in ${retryAfter} second${retryAfter === 1 ? '' : 's'}.`,
    { status: 429, retryable: true, retryAfter }
  );
}

/* -------------------------------------------------------------------------- */
/* request building                                                           */
/* -------------------------------------------------------------------------- */

/** @throws {UpstreamError} when the input is unusable. */
export function buildGenerateRequest(body) {
  const { input } = body ?? {};
  assertUsableText(input);

  const text = input.trim();
  // Notes (rather than a topic) get source quotes, checked against the notes.
  const notes = looksLikeNotes(text) ? text : null;
  return { messages: buildGenerateMessages({ input: text, withSources: Boolean(notes) }), topic: text, notes };
}

/** @throws {UpstreamError} when the instruction or the set is unusable. */
export function buildRefineRequest(body) {
  const { studySet, instruction } = body ?? {};
  assertUsableText(instruction, 'instruction');
  assertClientStudySet(studySet, 'refined');

  return {
    messages: buildRefineMessages({ studySet, instruction: instruction.trim() }),
    topic: studySet.title,
    // Kept so the refined items can inherit the ids (and so the progress) of
    // the items they came from.
    previous: studySet,
  };
}

/**
 * A study set sent by the browser. Never trusted: it round-tripped through
 * localStorage (or a share link) and could be anything.
 * @throws {UpstreamError} 400
 */
function assertClientStudySet(studySet, verb) {
  if (!isValidStudySet(studySet)) {
    throw new UpstreamError('bad_request', `That study set can no longer be ${verb}. Generate a new one.`, {
      status: 400,
    });
  }
  // A real set always fits — the normalizer produced it. One that doesn't was
  // built by hand to make us send the model a huge prompt.
  const violation = studySetLimitViolation(studySet);
  if (violation) {
    throw new UpstreamError('bad_request', `That study set can't be ${verb} — it has ${violation}.`, { status: 400 });
  }
}

/* -------------------------------------------------------------------------- */
/* explain                                                                    */
/* -------------------------------------------------------------------------- */

const MAX_EXPLANATION_CHARS = 600;

/**
 * POST /api/explain — { studySet, questionId, chosen }. The question is looked
 * up in the (validated) set rather than taken from the body, so the endpoint
 * can only ever explain a question the set really contains, and everything it
 * sends the model is bounded by LIMITS.
 * @throws {UpstreamError} 400 when the request is unusable
 */
export function buildExplainRequest(body) {
  const { studySet, questionId, chosen } = body ?? {};
  assertClientStudySet(studySet, 'explained');

  const question = studySet.quiz.find((q) => q.id === questionId);
  if (!question) {
    throw new UpstreamError('bad_request', 'That question is no longer in this set.', { status: 400 });
  }
  if (typeof chosen !== 'string' || !chosen.trim()) {
    throw new UpstreamError('bad_request', 'Answer the question first.', { status: 400 });
  }
  if (chosen.length > LIMITS.option) {
    throw new UpstreamError('bad_request', `That answer is too long to explain (the limit is ${LIMITS.option} characters).`, {
      status: 400,
    });
  }

  return {
    messages: buildExplainMessages({ studySet, question, chosen: chosen.trim(), correct: correctAnswerText(question) }),
  };
}

/** @returns {Promise<{explanation: string, meta: {model: string}}>} */
export async function generateExplanation({ messages, signal }) {
  const completion = await callGroq({ messages, signal, temperature: 0.2, maxTokens: 600 });
  const extracted = extractJson(completion.content);
  const raw = extracted.ok ? (extracted.value?.explanation ?? extracted.value?.text) : null;
  const explanation = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, MAX_EXPLANATION_CHARS) : '';
  if (!explanation) {
    throw new UpstreamError('unusable_output', 'The model did not return an explanation. Try again.', {
      status: 502,
      retryable: true,
    });
  }
  return { explanation, meta: { model: completion.model ?? defaultModel() } };
}

/** Rate limit, validate, explain. Explanations have their own rate-limit bucket. */
export async function handleExplainRequest({ body, ip, signal, limiter = defaultLimiter(), generate = generateExplanation }) {
  await enforceRateLimit(ip, limiter, 'explain');
  return generate({ ...buildExplainRequest(body), signal });
}

/* -------------------------------------------------------------------------- */
/* generation                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Call the model, parse it, validate it — and if any of that fails, show the
 * model its own bad output and ask once more. Two attempts is the sweet spot:
 * a third rarely converges and the user is already waiting.
 *
 * @param {object} args
 * @param {Array} args.messages
 * @param {string} args.topic
 * @param {object} [args.previous] the set being refined, whose ids carry over
 * @param {string | null} [args.notes] the user's notes, to verify source quotes against
 * @param {AbortSignal} [args.signal]
 * @param {(studySet: object) => void} [args.onPartial] if given, the first attempt is streamed and
 *   this receives the items that have fully arrived so far
 * @returns {Promise<{studySet: object, meta: object}>}
 */
export async function generateStudySet({ messages, topic, previous, notes, signal, onPartial }) {
  const startedAt = Date.now();
  let attemptMessages = messages;
  let lastProblem = 'Unknown parsing failure.';
  const repairs = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Only the first attempt streams. A repair attempt follows a failure the
    // user has already waited through; it should just arrive whole.
    const completion =
      onPartial && attempt === 1
        ? await streamAttempt({ messages: attemptMessages, signal, topic, onPartial })
        : await callGroq({ messages: attemptMessages, signal });
    const truncated = completion.finishReason === 'length';

    const extracted = extractJson(completion.content);

    if (!extracted.ok) {
      lastProblem = truncated ? 'the response was cut off before the JSON closed' : extracted.error;
    } else {
      const normalized = normalizeStudySet(extracted.value, { topic });

      if (normalized.ok) {
        if (extracted.strategy !== 'direct') {
          repairs.push(`Recovered the JSON from a ${describeStrategy(extracted.strategy)} response.`);
        }
        if (truncated) repairs.push('The response was cut short, so the set may be shorter than requested.');

        const { studySet, grounding } = finishStudySet(normalized.data, { previous, notes });

        return {
          studySet,
          meta: {
            repairs: [...repairs, ...normalized.repairs],
            attempts: attempt,
            recovery: extracted.strategy,
            model: completion.model ?? defaultModel(),
            durationMs: Date.now() - startedAt,
            ...(grounding && { grounding }),
          },
        };
      }

      // The model followed instructions and said "nothing to make here".
      // Retrying would just burn time and produce the same answer.
      if (normalized.reason === 'empty') {
        throw new UpstreamError(
          'no_content',
          'The model could not find anything to build a study set from. Try adding more detail or pasting more notes.',
          { status: 422 }
        );
      }
      lastProblem = 'the JSON did not match the required study-set shape';
    }

    if (attempt < MAX_ATTEMPTS) {
      repairs.push('The first response was unusable, so it was regenerated.');
      attemptMessages = buildRepairMessages({
        previousMessages: messages,
        badOutput: completion.content,
        problem: lastProblem,
      });
    }
  }

  throw new UpstreamError(
    'unusable_output',
    `The model returned something we could not use (${lastProblem}). Retrying often fixes this.`,
    { status: 502, retryable: true }
  );
}

/** Stream failures where an ordinary request is still worth trying. */
const STREAM_FALLBACK_CODES = new Set(['stream_failed', 'bad_envelope', 'upstream']);

/**
 * One streamed model call, reporting each newly completed item through
 * `onPartial`. Parsing is only attempted when a `}` arrives — nothing can have
 * completed otherwise — so a long response isn't re-parsed on every token.
 *
 * If streaming itself fails (the provider rejects it, or the stream breaks
 * off), the same request is made again without streaming. Cancellation,
 * timeouts and rate limits are not retried.
 */
async function streamAttempt({ messages, signal, topic, onPartial }) {
  let scanned = 0;
  let braces = 0;
  let parsedAtBraces = 0;
  let lastSignature = '';

  const onText = (text) => {
    for (let i = scanned; i < text.length; i++) if (text[i] === '}') braces++;
    scanned = text.length;
    if (braces === parsedAtBraces) return;
    parsedAtBraces = braces;

    const partial = partialStudySet(text, { topic });
    if (!partial) return;
    const signature = `${partial.flashcards.length}:${partial.quiz.length}`;
    if (signature === lastSignature) return;
    lastSignature = signature;
    try {
      onPartial(partial);
    } catch {
      /* a listener that has gone away must not fail the generation */
    }
  };

  try {
    return await callGroqStream({ messages, signal, onText });
  } catch (error) {
    if (!(error instanceof UpstreamError) || !STREAM_FALLBACK_CODES.has(error.code)) throw error;
    console.warn(`[stream] ${error.code}: falling back to a non-streamed request`);
    return callGroq({ messages, signal });
  }
}

/**
 * The items that have fully arrived in a response that is still streaming.
 *
 * extractJson's truncation recovery closes whatever is open, so the text so
 * far parses — but the item being written when the text was cut may be
 * half-finished ("back": "The energy curr…). The list whose key appears last
 * in the text is the one still being written, so it loses its last item; a
 * list that came before it is already closed and is kept whole. (The schema
 * puts flashcards first, but this doesn't rely on the model honouring that.)
 *
 * @returns {object | null} a study set, or null if no complete item has arrived yet
 */
export function partialStudySet(text, { topic = '' } = {}) {
  const extracted = extractJson(text);
  if (!extracted.ok) return null;

  // Drop the raw element being written *before* normalizing. Afterwards it's
  // too late to tell: the normalizer may already have discarded it (a card
  // with no back yet), and trimming then would lose a complete item instead.
  let raw = extracted.value;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const writingQuiz = lastKeyIndex(text, QUIZ_KEYS) > lastKeyIndex(text, FLASHCARD_KEYS);
    const key = (writingQuiz ? QUIZ_KEYS : FLASHCARD_KEYS).find((k) => Array.isArray(raw[k]));
    if (key) raw = { ...raw, [key]: raw[key].slice(0, -1) };
  }

  const normalized = normalizeStudySet(raw, { topic });
  return normalized.ok ? normalized.data : null;
}

// Mirrors the key aliases normalizeStudySet accepts.
const FLASHCARD_KEYS = ['flashcards', 'cards', 'flash_cards', 'deck'];
const QUIZ_KEYS = ['quiz', 'questions', 'quizQuestions', 'quiz_questions', 'mcqs'];

function lastKeyIndex(text, keys) {
  let last = -1;
  for (const key of keys) {
    const pattern = new RegExp(`"${key}"\\s*:`, 'g');
    for (const match of text.matchAll(pattern)) last = Math.max(last, match.index);
  }
  return last;
}

/**
 * The steps after a set validates: carry ids over from the set being refined,
 * then either check every source quote against the notes, or — on a refine,
 * where there are no notes — carry over the verdicts of unchanged items.
 *
 * @returns {{studySet: object, grounding: {checked: number, verified: number} | null}}
 */
export function finishStudySet(data, { previous, notes } = {}) {
  let studySet = previous ? reconcileIds(previous, data).studySet : data;

  if (notes) {
    const { studySet: checked, checked: count, verified } = verifyGrounding(studySet, notes);
    return { studySet: checked, grounding: { checked: count, verified } };
  }
  if (previous) studySet = carryGrounding(previous, studySet);
  return { studySet, grounding: null };
}

/* -------------------------------------------------------------------------- */
/* helpers                                                                    */
/* -------------------------------------------------------------------------- */

function assertUsableText(value, label = 'input') {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new UpstreamError('bad_request', `Please enter some ${label} first.`, { status: 400 });
  }
  if (value.trim().length < 3) {
    throw new UpstreamError('bad_request', `That ${label} is too short to work with.`, { status: 400 });
  }
  if (value.length > MAX_INPUT_CHARS) {
    throw new UpstreamError(
      'bad_request',
      `That is ${value.length.toLocaleString()} characters — the limit is ${MAX_INPUT_CHARS.toLocaleString()}. Try a section at a time.`,
      { status: 400 }
    );
  }
}

function describeStrategy(strategy) {
  return (
    {
      unfenced: 'markdown-fenced',
      sliced: 'prose-wrapped',
      repaired: 'malformed',
    }[strategy] || strategy
  );
}

/**
 * Turns any thrown value into the status, headers and body we send to the browser.
 * @returns {{status: number, headers: Record<string, string>, body: object}}
 */
export function errorResponse(error) {
  const known = error instanceof UpstreamError;
  if (!known) console.error('[unexpected]', error);

  const status = known ? error.status : 500;
  return {
    // 499 is a client-disconnect marker, not a real HTTP response code.
    status: status === 499 ? 400 : status,
    headers: known && error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {},
    body: {
      error: {
        code: known ? error.code : 'internal',
        message: known ? error.message : 'Something went wrong on our side.',
        retryable: known ? error.retryable : true,
      },
    },
  };
}
