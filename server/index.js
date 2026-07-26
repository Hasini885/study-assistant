/**
 * API server.
 *
 * Exists for one non-negotiable reason: the Groq API key must never reach the
 * browser. The client posts free-form text here; this process talks to Groq,
 * validates and repairs the result, and returns a study set the UI can trust.
 */

import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import { callGroq, UpstreamError } from './groq.js';
import { buildGenerateMessages, buildRefineMessages, buildRepairMessages } from './prompt.js';
import { extractJson } from '../shared/extractJson.js';
import { normalizeStudySet, isValidStudySet } from '../shared/normalize.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8787;
const MAX_INPUT_CHARS = 20_000;
const MAX_ATTEMPTS = 2; // one initial call, one self-repair

const app = express();
app.use(express.json({ limit: '1mb' }));

/* -------------------------------------------------------------------------- */
/* routes                                                                     */
/* -------------------------------------------------------------------------- */

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    configured: Boolean(process.env.GROQ_API_KEY),
    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  });
});

app.post('/api/study-set', async (req, res) => {
  const { input } = req.body ?? {};

  const invalid = validateInput(input);
  if (invalid) return sendError(res, invalid);

  await run(req, res, {
    messages: buildGenerateMessages({ input: input.trim() }),
    topic: input.trim(),
  });
});

app.post('/api/refine', async (req, res) => {
  const { studySet, instruction } = req.body ?? {};

  const invalid = validateInput(instruction, 'instruction');
  if (invalid) return sendError(res, invalid);

  // Never trust the client's copy of the set; it round-tripped through
  // localStorage and could be anything.
  if (!isValidStudySet(studySet)) {
    return sendError(res, new UpstreamError('bad_request', 'That study set can no longer be refined. Generate a new one.', { status: 400 }));
  }

  await run(req, res, {
    messages: buildRefineMessages({ studySet, instruction: instruction.trim() }),
    topic: studySet.title,
  });
});

/* -------------------------------------------------------------------------- */
/* pipeline                                                                   */
/* -------------------------------------------------------------------------- */

async function run(req, res, { messages, topic }) {
  // If the user hits "cancel" or navigates away, stop the upstream call too.
  //
  // This listens on `res`, not `req`: since Node 16 the request stream emits
  // 'close' as soon as its body has been read, so aborting from there would
  // cancel every single request the moment express.json() finished parsing.
  // `res` emits 'close' when the response is done *or* the socket died, and
  // `writableFinished` tells the two apart.
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });

  const startedAt = Date.now();
  try {
    const result = await generate({ messages, topic, signal: controller.signal });
    if (res.writableEnded) return;
    res.json({
      studySet: result.data,
      meta: { ...result.meta, durationMs: Date.now() - startedAt },
    });
  } catch (error) {
    if (controller.signal.aborted || error?.code === 'client_aborted') return; // client is gone
    sendError(res, error);
  }
}

/**
 * Call the model, parse it, validate it — and if any of that fails, show the
 * model its own bad output and ask once more. Two attempts is the sweet spot:
 * a third rarely converges and the user is already waiting.
 */
async function generate({ messages, topic, signal }) {
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
          data: normalized.data,
          meta: {
            repairs: [...repairs, ...normalized.repairs],
            attempts: attempt,
            recovery: extracted.strategy,
            model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
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

function validateInput(value, label = 'input') {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return new UpstreamError('bad_request', `Please enter some ${label} first.`, { status: 400 });
  }
  if (value.trim().length < 3) {
    return new UpstreamError('bad_request', `That ${label} is too short to work with.`, { status: 400 });
  }
  if (value.length > MAX_INPUT_CHARS) {
    return new UpstreamError(
      'bad_request',
      `That is ${value.length.toLocaleString()} characters — the limit is ${MAX_INPUT_CHARS.toLocaleString()}. Try a section at a time.`,
      { status: 400 }
    );
  }
  return null;
}

function describeStrategy(strategy) {
  return {
    unfenced: 'markdown-fenced',
    sliced: 'prose-wrapped',
    repaired: 'malformed',
  }[strategy] || strategy;
}

function sendError(res, error) {
  const known = error instanceof UpstreamError;
  if (!known) console.error('[unexpected]', error);

  const status = known ? error.status : 500;
  res.status(status === 499 ? 400 : status).json({
    error: {
      code: known ? error.code : 'internal',
      message: known ? error.message : 'Something went wrong on our side.',
      retryable: known ? error.retryable : true,
    },
  });
}

// In production the same process serves the built client.
if (process.env.NODE_ENV === 'production') {
  const dist = path.join(__dirname, '..', 'dist');
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((error, req, res, next) => sendError(res, error));

app.listen(PORT, () => {
  const configured = Boolean(process.env.GROQ_API_KEY);
  console.log(`  API listening on http://localhost:${PORT}`);
  if (!configured) {
    console.warn('  ⚠  GROQ_API_KEY is not set — copy .env.example to .env and add your key.');
  }
});
