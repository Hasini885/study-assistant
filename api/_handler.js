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
import { errorResponse, generateStudySet } from '../backend/pipeline.js';

/**
 * @param {(body: unknown) => {messages: Array, topic: string}} build
 */
export function createStudySetHandler(build) {
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
      const { messages, topic } = build(parseBody(req));
      const result = await generateStudySet({ messages, topic, signal: controller.signal });
      if (res.writableEnded) return undefined;
      return res.status(200).json(result);
    } catch (error) {
      if (controller.signal.aborted || error?.code === 'client_aborted') return undefined;
      const { status, body } = errorResponse(error);
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
