// The study-set schema is the contract between the two halves of the app. It
// is defined once, on the backend, and imported here through the `@contract`
// alias so the client validates against the same definition the server does.
import { isValidStudySet } from '@contract/normalize.js';
import { connectionErrorMessage } from './messages.js';
import { parseSseChunk } from './sse.js';

/** An error we can show the user, with enough detail to decide about retrying. */
export class ApiError extends Error {
  constructor(code, message, { retryable = false } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.retryable = retryable;
  }
}

/** The stream ended or broke without a result — worth one plain retry. */
class StreamInterrupted extends Error {}

/**
 * POST helper that turns every failure mode into an ApiError.
 *
 * The server already validates and repairs the study set, but the client
 * re-checks the shape anyway: a proxy, a cached 200, or a future server change
 * could all put something unexpected on the wire, and rendering `undefined.map`
 * is exactly the crash the brief asks us to avoid.
 */
async function postJson(url, body, signal) {
  const response = await post(url, body, signal, 'application/json');
  return readJsonResult(response);
}

async function post(url, body, signal, accept) {
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: accept },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error; // cancellation is not a failure
    throw new ApiError('offline', connectionErrorMessage(import.meta.env.DEV), { retryable: true });
  }
}

async function readJsonResult(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || payload?.error) throw toApiError(payload?.error, response.status);
  return checkResult(payload);
}

function checkResult(payload) {
  if (!isValidStudySet(payload?.studySet)) {
    throw new ApiError('bad_payload', 'The server returned a study set in an unexpected format.', { retryable: true });
  }
  return { studySet: payload.studySet, meta: payload.meta ?? {} };
}

function toApiError(error, status) {
  return new ApiError(error?.code || 'http_error', error?.message || `Request failed (${status}).`, {
    retryable: error?.retryable ?? status >= 500,
  });
}

/**
 * Generates a study set. With `onPartial`, the response is streamed and
 * `onPartial(studySet)` is called each time more items have arrived.
 *
 * Streaming is an enhancement, never a requirement:
 *  - a server that answers with JSON instead (an error before generation
 *    started, or a host that doesn't stream) is read as JSON
 *  - a stream that breaks off, or ends without a result, is retried once as
 *    a plain request
 * An error the server *sent* in the stream (rate limit, timeout…) is real,
 * and is reported rather than retried.
 */
export async function createStudySet({ input }, signal, { onPartial } = {}) {
  if (!onPartial) return postJson('/api/study-set', { input }, signal);

  const response = await post('/api/study-set', { input }, signal, 'text/event-stream');
  if (!(response.headers.get('content-type') ?? '').includes('text/event-stream')) {
    return readJsonResult(response);
  }

  try {
    return await readEventStream(response, onPartial);
  } catch (error) {
    if (!(error instanceof StreamInterrupted)) throw error;
    return postJson('/api/study-set', { input }, signal);
  }
}

async function readEventStream(response, onPartial) {
  if (!response.body) throw new StreamInterrupted('no body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      let chunk;
      try {
        chunk = await reader.read();
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        throw new StreamInterrupted(error.message);
      }
      if (chunk.done) break;

      buffer += decoder.decode(chunk.value, { stream: true });
      const { events, rest } = parseSseChunk(buffer);
      buffer = rest;

      for (const { event, data } of events) {
        let payload;
        try {
          payload = JSON.parse(data);
        } catch {
          throw new StreamInterrupted('malformed event');
        }
        if (event === 'partial') {
          // Partials are a preview; one that doesn't validate is just skipped.
          if (isValidStudySet(payload?.studySet)) onPartial(payload.studySet);
        } else if (event === 'done') {
          return checkResult(payload);
        } else if (event === 'error') {
          throw toApiError(payload?.error, 500);
        }
      }
    }
  } finally {
    reader.releaseLock?.();
  }

  throw new StreamInterrupted('stream ended without a result');
}

export function refineStudySet({ studySet, instruction }, signal) {
  return postJson('/api/refine', { studySet, instruction }, signal);
}

export async function fetchHealth(signal) {
  try {
    const response = await fetch('/api/health', { signal });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null; // health is advisory; never block the UI on it
  }
}
