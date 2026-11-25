import { afterEach, describe, expect, test, vi } from 'vitest';
import { parseSseChunk } from '../src/api/sse.js';
import { ApiError, createStudySet } from '../src/api/client.js';
import { studySetReducer, initialStudySetState } from '../src/hooks/useStudySet.js';
import { json, studySet } from './fixtures/studySet.js';

afterEach(() => vi.unstubAllGlobals());

function sse(events, { breakAfter, chunkSize = 17 } = {}) {
  const text = events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
  const encoder = new TextEncoder();
  let offset = 0;
  let reads = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (breakAfter !== undefined && reads++ === breakAfter) return controller.error(new TypeError('network'));
      if (offset >= text.length) return controller.close();
      controller.enqueue(encoder.encode(text.slice(offset, (offset += chunkSize))));
    },
  });
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
}

const partial = { ...studySet, flashcards: studySet.flashcards.slice(0, 1), quiz: [] };

describe('parseSseChunk', () => {
  test('returns complete events and keeps the unfinished tail', () => {
    const { events, rest } = parseSseChunk('event: partial\ndata: {"a":1}\n\nevent: done\ndata: {"b"');
    expect(events).toEqual([{ event: 'partial', data: '{"a":1}' }]);
    expect(rest).toBe('event: done\ndata: {"b"');
  });

  test('handles CRLF, comments, default event names and multi-line data', () => {
    const { events } = parseSseChunk(': keep-alive\r\n\r\ndata: one\r\ndata: two\r\n\r\n');
    expect(events).toEqual([{ event: 'message', data: 'one\ntwo' }]);
  });
});

describe('createStudySet streaming', () => {
  test('reports partials as they arrive and resolves with the final set', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sse([['partial', { studySet: partial }], ['done', { studySet, meta: { attempts: 1 } }]]))
    );
    const seen = [];
    const result = await createStudySet({ input: 'Cells' }, undefined, { onPartial: (s) => seen.push(s) });

    expect(fetch.mock.calls[0][1].headers.Accept).toBe('text/event-stream');
    expect(seen).toHaveLength(1);
    expect(seen[0].flashcards).toHaveLength(1);
    expect(result.studySet.flashcards).toHaveLength(2);
    expect(result.meta).toEqual({ attempts: 1 });
  });

  test('an error event is reported, not retried', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sse([['error', { error: { code: 'timeout', message: 'Too slow', retryable: true } }]]))
    );
    await expect(createStudySet({ input: 'Cells' }, undefined, { onPartial: () => {} })).rejects.toMatchObject({
      code: 'timeout',
      retryable: true,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('a stream that breaks off falls back to a plain request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, init) =>
        init.headers.Accept === 'text/event-stream'
          ? sse([['partial', { studySet: partial }], ['done', { studySet }]], { breakAfter: 2 })
          : json({ studySet, meta: {} })
      )
    );
    const result = await createStudySet({ input: 'Cells' }, undefined, { onPartial: () => {} });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][1].headers.Accept).toBe('application/json');
    expect(result.studySet.title).toBe('Cell biology');
  });

  test('a stream that ends without a result falls back too', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, init) =>
        init.headers.Accept === 'text/event-stream' ? sse([['partial', { studySet: partial }]]) : json({ studySet })
      )
    );
    await expect(createStudySet({ input: 'Cells' }, undefined, { onPartial: () => {} })).resolves.toMatchObject({
      studySet: { title: 'Cell biology' },
    });
  });

  test('a JSON answer to a streaming request is read as JSON (e.g. a 429 before generation)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: { code: 'rate_limited', message: 'Slow down', retryable: true } }, 429))
    );
    const error = await createStudySet({ input: 'Cells' }, undefined, { onPartial: () => {} }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('rate_limited');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('an invalid partial is skipped rather than shown', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sse([['partial', { studySet: { flashcards: 'nope' } }], ['done', { studySet }]]))
    );
    const onPartial = vi.fn();
    await createStudySet({ input: 'Cells' }, undefined, { onPartial });
    expect(onPartial).not.toHaveBeenCalled();
  });
});

describe('streamed partials in the reducer', () => {
  const start = (state) => studySetReducer(state, { type: 'start', mode: 'generate', request: {} });

  test('a current partial is shown while loading and cleared by the result', () => {
    let state = start(initialStudySetState);
    state = studySetReducer(state, { type: 'partial', studySet: partial, seq: 1, currentSeq: 1 });
    expect(state.partial).toBe(partial);
    state = studySetReducer(state, { type: 'success', studySet, meta: {}, seq: 1, currentSeq: 1 });
    expect(state.partial).toBeNull();
  });

  test('a partial from a superseded request is ignored', () => {
    const state = studySetReducer(start(initialStudySetState), { type: 'partial', studySet: partial, seq: 1, currentSeq: 2 });
    expect(state.partial).toBeNull();
  });

  test('a partial arriving after cancel is ignored', () => {
    const cancelled = studySetReducer(start(initialStudySetState), { type: 'cancel' });
    expect(studySetReducer(cancelled, { type: 'partial', studySet: partial }).partial).toBeNull();
  });
});
