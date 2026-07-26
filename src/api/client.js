import { isValidStudySet } from '../../shared/normalize.js';

/** An error we can show the user, with enough detail to decide about retrying. */
export class ApiError extends Error {
  constructor(code, message, { retryable = false } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.retryable = retryable;
  }
}

/**
 * POST helper that turns every failure mode into an ApiError.
 *
 * The server already validates and repairs the study set, but the client
 * re-checks the shape anyway: a proxy, a cached 200, or a future server change
 * could all put something unexpected on the wire, and rendering `undefined.map`
 * is exactly the crash the brief asks us to avoid.
 */
async function postJson(url, body, signal) {
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error; // cancellation is not a failure
    throw new ApiError('offline', 'Could not reach the server. Is it running on port 8787?', { retryable: true });
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || payload?.error) {
    const error = payload?.error;
    throw new ApiError(
      error?.code || 'http_error',
      error?.message || `Request failed (${response.status}).`,
      { retryable: error?.retryable ?? response.status >= 500 }
    );
  }

  if (!isValidStudySet(payload?.studySet)) {
    throw new ApiError('bad_payload', 'The server returned a study set in an unexpected format.', { retryable: true });
  }

  return { studySet: payload.studySet, meta: payload.meta ?? {} };
}

export function createStudySet({ input, cardCount, questionCount, simulate }, signal) {
  return postJson('/api/study-set', { input, cardCount, questionCount, simulate }, signal);
}

export function refineStudySet({ studySet, instruction, simulate }, signal) {
  return postJson('/api/refine', { studySet, instruction, simulate }, signal);
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
