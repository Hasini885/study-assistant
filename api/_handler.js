/**
 * Shared plumbing for the Vercel serverless functions.
 *
 * WHY THIS FOLDER IS AT THE REPO ROOT
 * Vercel only creates serverless functions from an `api/` directory at the root
 * of the project. Moving these into `backend/` fails the build outright:
 *   "The pattern backend/api/*.js defined in functions doesn't match any
 *    Serverless Functions inside the api directory."
 * So `api/` is Vercel's entry point, deliberately kept as thin as possible —
 * every line of real logic lives in `backend/`.
 *
 * Files here whose names start with an underscore are not turned into routes,
 * so this is a safe place for helpers.
 */

import 'dotenv/config'; // no-op in production; lets `vercel dev` read .env
import { errorResponse, handleExplainRequest, handleStudySetRequest } from '../backend/pipeline.js';
import { clientIpFromHeaders } from '../backend/rateLimit.js';
import { streamStudySet, wantsEventStream } from '../backend/sse.js';

/**
 * /api/study-set and /api/refine: JSON, or server-sent events when asked for.
 * @param {(body: unknown) => object} build
 */
export function createStudySetHandler(build) {
  return post(async ({ req, res, body, ip, signal }) => {
    if (wantsEventStream(req.headers)) {
      await streamStudySet({ res, body, ip, build, signal });
      return undefined; // the stream wrote its own response
    }
    return handleStudySetRequest({ body, ip, build, signal });
  });
}

/** /api/explain */
export function createExplainHandler() {
  return post(({ body, ip, signal }) => handleExplainRequest({ body, ip, signal }));
}

/**
 * The plumbing every POST endpoint shares: method check, cancellation when
 * the client disconnects, the client's IP, and error mapping.
 */
function post(run) {
  return async function handler(req, res) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: { code: 'method_not_allowed', message: 'Use POST.', retryable: false } });
    }

    // If the client goes away mid-generation, stop paying for the model call.
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) controller.abort();
    });

    try {
      const result = await run({
        req,
        res,
        body: parseBody(req),
        // Vercel's edge sets these and overwrites any client-supplied value.
        ip: clientIpFromHeaders(req.headers, req.socket?.remoteAddress),
        signal: controller.signal,
      });
      if (result === undefined || res.writableEnded) return undefined;
      return res.status(200).json(result);
    } catch (error) {
      if (controller.signal.aborted || error?.code === 'client_aborted') return undefined;
      const { status, headers, body } = errorResponse(error);
      for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
      return res.status(status).json(body);
    }
  };
}

/**
 * Vercel parses JSON bodies for us, but only when the Content-Type says so.
 * A string body (or none) shouldn't throw before validation gets to explain
 * what was wrong.
 */
function parseBody(req) {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body ?? {};
}
