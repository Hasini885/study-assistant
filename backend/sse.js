/**
 * Server-sent events for /api/study-set and /api/refine, shared by Express
 * and the Vercel functions.
 *
 * A client that sends `Accept: text/event-stream` gets:
 *   event: partial  data: {studySet}          zero or more, as items arrive
 *   event: done     data: {studySet, meta}    exactly once on success
 *   event: error    data: {error}             instead of done on failure
 *
 * Anything that can fail *before* the model is called (rate limit, bad input)
 * is answered as an ordinary JSON error with a real status code, because once
 * the stream's 200 has been sent there is no way to change it.
 */

import { errorResponse, generateStudySet, prepareStudySetRequest } from './pipeline.js';

export function wantsEventStream(headers) {
  const accept = headers?.accept;
  return typeof accept === 'string' && accept.includes('text/event-stream');
}

/** Formats one SSE message. */
export function formatEvent(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * @param {object} args
 * @param {import('node:http').ServerResponse} args.res
 * @param {unknown} args.body
 * @param {string} args.ip
 * @param {(body: unknown) => object} args.build
 * @param {AbortSignal} args.signal aborted when the client disconnects
 * @param {object} [args.limiter] injectable for tests
 * @param {typeof generateStudySet} [args.generate] injectable for tests
 */
export async function streamStudySet({ res, body, ip, build, signal, limiter, generate = generateStudySet }) {
  let request;
  try {
    request = await prepareStudySetRequest({ body, ip, build, ...(limiter && { limiter }) });
  } catch (error) {
    const { status, headers, body: errorBody } = errorResponse(error);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
    res.end(JSON.stringify(errorBody));
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    // no-transform stops proxies from compressing (and so buffering) the stream.
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const send = (event, data) => {
    if (!res.writableEnded && !res.destroyed) res.write(formatEvent(event, data));
  };

  try {
    const result = await generate({ ...request, signal, onPartial: (studySet) => send('partial', { studySet }) });
    send('done', result);
  } catch (error) {
    if (!(signal?.aborted || error?.code === 'client_aborted')) send('error', errorResponse(error).body);
  }
  if (!res.writableEnded) res.end();
}
