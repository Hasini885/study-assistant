/**
 * Groq chat-completions client.
 *
 * Groq exposes an OpenAI-compatible endpoint. We use `response_format:
 * {type: "json_object"}` (JSON mode), which constrains the model to emit
 * syntactically valid JSON but says nothing about the *shape* — that is what
 * shared/normalize.js is for. Treat JSON mode as a strong hint, not a contract.
 */

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

// Per-call ceiling. A request can make two calls (one generate, one repair), so
// this must stay comfortably under half the serverless function's maxDuration
// — otherwise the platform kills the function and the user gets an opaque
// gateway error instead of our "the model timed out" message.
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS) || 25_000;

/** Errors we can describe to the user, as opposed to unexpected crashes. */
export class UpstreamError extends Error {
  constructor(code, message, { status = 502, retryable = false } = {}) {
    super(message);
    this.name = 'UpstreamError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export function assertConfigured() {
  if (!process.env.GROQ_API_KEY) {
    throw new UpstreamError(
      'not_configured',
      'No GROQ_API_KEY found. Copy .env.example to .env and add your key from https://console.groq.com/keys',
      { status: 500 }
    );
  }
}

/**
 * @param {object}  args
 * @param {Array}   args.messages
 * @param {AbortSignal} [args.signal] aborted when the browser disconnects
 * @returns {Promise<{content: string, usage: object|undefined}>}
 */
export async function callGroq({ messages, signal, temperature = 0.3, maxTokens = 4096 }) {
  assertConfigured();

  // Our own timeout, plus the caller's cancellation, as one signal.
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  let response;
  try {
    response = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || DEFAULT_MODEL,
        messages,
        temperature,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
      }),
      signal: combined,
    });
  } catch (error) {
    if (signal?.aborted) throw new UpstreamError('client_aborted', 'Request cancelled.', { status: 499 });
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw new UpstreamError('timeout', 'The model took too long to respond.', { status: 504, retryable: true });
    }
    throw new UpstreamError('network', 'Could not reach the model provider.', { status: 502, retryable: true });
  }

  if (!response.ok) {
    throw await describeHttpFailure(response);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new UpstreamError('bad_envelope', 'The model provider returned a malformed response.', {
      status: 502,
      retryable: true,
    });
  }

  const choice = payload?.choices?.[0];
  const content = choice?.message?.content;

  if (typeof content !== 'string' || content.trim() === '') {
    throw new UpstreamError('empty_completion', 'The model returned an empty response.', {
      status: 502,
      retryable: true,
    });
  }

  // Surfaced so the caller can tell "bad JSON" apart from "ran out of room".
  return { content, finishReason: choice?.finish_reason, usage: payload?.usage };
}

async function describeHttpFailure(response) {
  const body = await response.text().catch(() => '');
  let detail = '';
  try {
    detail = JSON.parse(body)?.error?.message || '';
  } catch {
    detail = body.slice(0, 200);
  }

  if (response.status === 401 || response.status === 403) {
    return new UpstreamError('bad_key', 'The API key was rejected. Check GROQ_API_KEY in your .env file.', {
      status: 500,
    });
  }
  if (response.status === 429) {
    return new UpstreamError('rate_limited', 'Rate limit reached. Wait a few seconds and try again.', {
      status: 429,
      retryable: true,
    });
  }
  if (response.status === 400 && /context|token/i.test(detail)) {
    return new UpstreamError('too_long', 'That input is too long for the model. Try trimming your notes.', {
      status: 400,
    });
  }
  if (response.status >= 500) {
    return new UpstreamError('provider_down', 'The model provider is having trouble. Try again in a moment.', {
      status: 502,
      retryable: true,
    });
  }
  return new UpstreamError('upstream', detail || `Model provider returned ${response.status}.`, {
    status: 502,
    retryable: response.status >= 500,
  });
}
