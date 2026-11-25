// The study-set schema is the contract between the two halves of the app. It
// is defined once, on the backend, and imported here through the `@contract`
// alias so the client validates against the same definition the server does.
import { isValidStudySet } from '@contract/normalize.js';
import { connectionErrorMessage } from './messages.js';

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
    throw new ApiError('offline', connectionErrorMessage(import.meta.env.DEV), { retryable: true });
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

export function createStudySet({ input }, signal) {
  return postJson('/api/study-set', { input }, signal);
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
