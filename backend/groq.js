/**
 * Groq chat-completions client.
 *
 * Groq exposes an OpenAI-compatible endpoint. We use `response_format:
 * {type: "json_object"}` (JSON mode), which constrains the model to emit
 * syntactically valid JSON but says nothing about the *shape* — that is what
 * shared/normalize.js is for. Treat JSON mode as a strong hint, not a contract.
 */

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
// llama-3.3-70b-versatile was retired from Groq; requests for it now fail with
// "model does not exist". gpt-oss-120b returned full, valid, well-grounded
// sets in testing. Override with GROQ_MODEL.
const DEFAULT_MODEL = 'openai/gpt-oss-120b';

// Per-call ceiling. A request can make two calls (one generate, one repair), so
// this must stay comfortably under half the serverless function's maxDuration
// — otherwise the platform kills the function and the user gets an opaque
// gateway error instead of our "the model timed out" message.
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS) || 25_000;

/** Errors we can describe to the user, as opposed to unexpected crashes. */
export class UpstreamError extends Error {
  constructor(code, message, { status = 502, retryable = false, retryAfter } = {}) {
    super(message);
    this.name = 'UpstreamError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    /** Seconds; sent as a Retry-After header when set. */
    this.retryAfter = retryAfter;
  }
}

/**
 * The API key, sanitised.
 *
 * Secrets arrive via copy-paste, dashboards and shell pipelines, and pick up
 * passengers on the way: a UTF-8 BOM, a trailing newline, wrapping quotes.
 * Any of those makes the Authorization header throw `Cannot convert argument
 * to a ByteString`, which surfaces as an unhelpful "could not reach the model
 * provider". Cheaper to strip them than to debug them twice.
 */
function apiKey() {
  return (process.env.GROQ_API_KEY || '')
    .replace(/^﻿/, '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim();
}

export function hasApiKey() {
  return apiKey().length > 0;
}

export function assertConfigured() {
  if (!hasApiKey()) {
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
export async function callGroq({ messages, signal, model = primaryModel(), temperature = 0.3, maxTokens = 4096 }) {
  const response = await send({ model, messages, temperature, max_tokens: maxTokens }, signal);

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
  return { content, finishReason: choice?.finish_reason, usage: payload?.usage, model };
}

/**
 * The same call, streamed. `onText` receives the whole response so far each
 * time a chunk arrives, so the caller can parse partial JSON as it grows.
 *
 * Groq streams OpenAI-style server-sent events: `data: {choices:[{delta}]}`
 * lines, ending with `data: [DONE]`.
 *
 * @param {object} args
 * @param {(textSoFar: string) => void} [args.onText]
 * @returns {Promise<{content: string, finishReason: string | undefined, model: string}>}
 */
export async function callGroqStream({ messages, signal, onText, model = primaryModel(), temperature = 0.3, maxTokens = 4096 }) {
  const response = await send({ model, messages, temperature, max_tokens: maxTokens, stream: true }, signal);
  if (!response.body) {
    throw new UpstreamError('stream_failed', 'The model provider did not stream a response.', { status: 502, retryable: true });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let finishReason;

  const handleLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return false;
    const data = trimmed.slice(5).trim();
    if (data === '[DONE]') return true;

    let chunk;
    try {
      chunk = JSON.parse(data);
    } catch {
      throw new UpstreamError('stream_failed', 'The model provider sent a malformed stream.', { status: 502, retryable: true });
    }
    if (chunk?.error) {
      throw new UpstreamError('upstream', chunk.error.message || 'The model provider reported an error.', {
        status: 502,
        retryable: true,
      });
    }
    const choice = chunk?.choices?.[0];
    const delta = choice?.delta?.content;
    if (typeof delta === 'string' && delta) {
      content += delta;
      onText?.(content);
    }
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    return false;
  };

  try {
    let done = false;
    while (!done) {
      const { value, done: ended } = await reader.read();
      if (ended) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (handleLine(line)) {
          done = true;
          break;
        }
      }
    }
    if (!done && buffer) handleLine(buffer);
  } catch (error) {
    if (error instanceof UpstreamError) throw error;
    const mapped = transportError(error, signal);
    // The connection worked and then broke: worth one non-streamed try.
    if (mapped.code === 'network') {
      throw new UpstreamError('stream_failed', 'The stream from the model provider broke off.', {
        status: 502,
        retryable: true,
      });
    }
    throw mapped;
  } finally {
    reader.releaseLock?.();
  }

  if (content.trim() === '') {
    throw new UpstreamError('empty_completion', 'The model returned an empty response.', { status: 502, retryable: true });
  }
  return { content, finishReason, model };
}

export function primaryModel() {
  return process.env.GROQ_MODEL || DEFAULT_MODEL;
}

/**
 * The model to retry with when the primary is rate-limited or down. Groq's
 * rate limits are per model, so a second model usually has headroom when the
 * first has none. Set GROQ_FALLBACK_MODEL=none to turn this off.
 */
const DEFAULT_FALLBACK_MODEL = 'qwen/qwen3.8-27b';

export function fallbackModel() {
  const value = (process.env.GROQ_FALLBACK_MODEL ?? DEFAULT_FALLBACK_MODEL).trim();
  return !value || value.toLowerCase() === 'none' ? null : value;
}

/** Failures that say "this model, right now" rather than "this request". */
const FALLBACK_CODES = new Set(['rate_limited', 'provider_down']);

/**
 * Runs `call(model)` with the primary model, and once more with the fallback
 * if the primary was rate-limited or the provider returned a 5xx. Bad input,
 * a bad key, timeouts and cancellation are not retried — another model
 * wouldn't change them.
 *
 * @template {object} T
 * @param {(model: string) => Promise<T>} call
 * @returns {Promise<T & {fallback?: {from: string, to: string, reason: string}}>}
 */
export async function withModelFallback(call) {
  const primary = primaryModel();
  try {
    return await call(primary);
  } catch (error) {
    const backup = fallbackModel();
    if (!(error instanceof UpstreamError) || !FALLBACK_CODES.has(error.code) || !backup || backup === primary) {
      throw error;
    }
    console.warn(`[groq] ${primary} ${error.code}; retrying once with ${backup}`);
    const result = await call(backup);
    return { ...result, fallback: { from: primary, to: backup, reason: error.code } };
  }
}

/**
 * POSTs a chat-completions request and returns the response if it's a 2xx.
 * Every failure becomes an UpstreamError the UI knows how to describe.
 */
async function send(body, signal) {
  assertConfigured();

  // Our own timeout, plus the caller's cancellation, as one signal. It also
  // covers reading a streamed body, not just waiting for the headers.
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  let response;
  try {
    response = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey()}`,
      },
      body: JSON.stringify({ ...body, response_format: { type: 'json_object' } }),
      signal: combined,
    });
  } catch (error) {
    throw transportError(error, signal);
  }

  if (!response.ok) throw await describeHttpFailure(response);
  return response;
}

function transportError(error, signal) {
  if (signal?.aborted) return new UpstreamError('client_aborted', 'Request cancelled.', { status: 499 });
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
    return new UpstreamError('timeout', 'The model took too long to respond.', { status: 504, retryable: true });
  }
  // `fetch` reports transport failures as a bare TypeError and hides the real
  // reason (DNS, TLS, ECONNREFUSED…) on `cause`. Log it: without this, a
  // deploy that cannot reach Groq looks identical to one that can't resolve
  // it, and the user-facing message is the same either way.
  console.error('[groq] request failed:', error?.name, error?.message, '| cause:', error?.cause ?? '(none)');
  return new UpstreamError('network', 'Could not reach the model provider.', { status: 502, retryable: true });
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
