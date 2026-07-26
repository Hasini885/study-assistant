/**
 * The request pipeline, independent of how it is being served.
 *
 * Local development runs this behind Express (`server/index.js`); production on
 * Vercel runs it inside serverless functions (`api/*.js`). Both share this file
 * so there is exactly one implementation of "turn text into a validated study
 * set", and no chance of the two drifting apart.
 */

import { callGroq, UpstreamError } from './groq.js';
import { buildGenerateMessages, buildRefineMessages, buildRepairMessages } from './prompt.js';
import { extractJson } from '../shared/extractJson.js';
import { normalizeStudySet, isValidStudySet } from '../shared/normalize.js';

const MAX_INPUT_CHARS = 20_000;
const MAX_ATTEMPTS = 2; // one initial call, one self-repair

export { UpstreamError };

export function defaultModel() {
  return process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
}

export function healthPayload() {
  return {
    ok: true,
    configured: Boolean(process.env.GROQ_API_KEY),
    model: defaultModel(),
  };
}

/* -------------------------------------------------------------------------- */
/* request building                                                           */
/* -------------------------------------------------------------------------- */

/** @throws {UpstreamError} when the input is unusable. */
export function buildGenerateRequest(body) {
  const { input } = body ?? {};
  assertUsableText(input);

  return { messages: buildGenerateMessages({ input: input.trim() }), topic: input.trim() };
}

/** @throws {UpstreamError} when the instruction or the set is unusable. */
export function buildRefineRequest(body) {
  const { studySet, instruction } = body ?? {};
  assertUsableText(instruction, 'instruction');

  // Never trust the client's copy of the set; it round-tripped through
  // localStorage and could be anything.
  if (!isValidStudySet(studySet)) {
    throw new UpstreamError('bad_request', 'That study set can no longer be refined. Generate a new one.', {
      status: 400,
    });
  }

  return {
    messages: buildRefineMessages({ studySet, instruction: instruction.trim() }),
    topic: studySet.title,
  };
}

/* -------------------------------------------------------------------------- */
/* generation                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Call the model, parse it, validate it — and if any of that fails, show the
 * model its own bad output and ask once more. Two attempts is the sweet spot:
 * a third rarely converges and the user is already waiting.
 *
 * @returns {Promise<{studySet: object, meta: object}>}
 */
export async function generateStudySet({ messages, topic, signal }) {
  const startedAt = Date.now();
  let attemptMessages = messages;
  let lastProblem = 'Unknown parsing failure.';
  const repairs = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const completion = await callGroq({ messages: attemptMessages, signal });
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

        return {
          studySet: normalized.data,
          meta: {
            repairs: [...repairs, ...normalized.repairs],
            attempts: attempt,
            recovery: extracted.strategy,
            model: defaultModel(),
            durationMs: Date.now() - startedAt,
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

/** Turns any thrown value into the status + body we send to the browser. */
export function errorResponse(error) {
  const known = error instanceof UpstreamError;
  if (!known) console.error('[unexpected]', error);

  const status = known ? error.status : 500;
  return {
    // 499 is a client-disconnect marker, not a real HTTP response code.
    status: status === 499 ? 400 : status,
    body: {
      error: {
        code: known ? error.code : 'internal',
        message: known ? error.message : 'Something went wrong on our side.',
        retryable: known ? error.retryable : true,
      },
    },
  };
}
