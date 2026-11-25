import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { studySet } from './fixtures/studySet.js';

/**
 * The request lifecycle's race guards, tested with a client whose requests
 * resolve only when the test says so.
 */
const pending = [];

vi.mock('../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal();
  const deferred = (kind) => (payload, signal, options) =>
    new Promise((resolve, reject) => {
      const request = { kind, payload, signal, options, resolve, reject };
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      pending.push(request);
    });
  return { ...actual, createStudySet: vi.fn(deferred('generate')), refineStudySet: vi.fn(deferred('refine')) };
});

const { useStudySet } = await import('../src/hooks/useStudySet.js');
const { ApiError } = await import('../src/api/client.js');

const setNamed = (title) => ({ ...studySet, title });
const result = (title) => ({ studySet: setNamed(title), meta: { repairs: [] } });

beforeEach(() => {
  pending.length = 0;
});
afterEach(() => vi.clearAllMocks());

describe('useStudySet', () => {
  test('a slow first response cannot overwrite a newer one', async () => {
    const { result: hook } = renderHook(() => useStudySet());

    act(() => void hook.current.generate({ input: 'first' }));
    act(() => void hook.current.generate({ input: 'second' }));
    const [first, second] = pending;

    // The newer request lands first, then the stale one arrives late.
    await act(async () => second.resolve(result('Second')));
    await act(async () => first.resolve(result('First')));

    expect(hook.current.studySet.title).toBe('Second');
    expect(hook.current.status).toBe('ready');
  });

  test('starting a new request aborts the previous fetch', () => {
    const { result: hook } = renderHook(() => useStudySet());
    act(() => void hook.current.generate({ input: 'first' }));
    act(() => void hook.current.generate({ input: 'second' }));
    expect(pending[0].signal.aborted).toBe(true);
    expect(pending[1].signal.aborted).toBe(false);
  });

  test('cancel aborts the request and a late response is ignored', async () => {
    const { result: hook } = renderHook(() => useStudySet());
    act(() => void hook.current.generate({ input: 'topic' }));
    const [request] = pending;

    act(() => hook.current.cancel());
    expect(hook.current.status).toBe('idle');
    expect(request.signal.aborted).toBe(true);

    // Even if the response had already been on its way, it can't apply now.
    await act(async () => request.resolve(result('Too late')));
    expect(hook.current.studySet).toBeNull();
    expect(hook.current.status).toBe('idle');
  });

  test('streamed partials show while loading, and stale ones are ignored', async () => {
    const { result: hook } = renderHook(() => useStudySet());
    act(() => void hook.current.generate({ input: 'first' }));
    const [first] = pending;
    act(() => first.options.onPartial(setNamed('Partial one')));
    expect(hook.current.partial.title).toBe('Partial one');

    act(() => void hook.current.generate({ input: 'second' }));
    act(() => first.options.onPartial(setNamed('Stale partial')));
    expect(hook.current.partial).toBeNull();
  });

  test('a failed refinement keeps the set on screen and offers a retry', async () => {
    const { result: hook } = renderHook(() => useStudySet());
    act(() => hook.current.load(setNamed('Mine'), {}));

    act(() => void hook.current.refine({ studySet: setNamed('Mine'), instruction: 'harder' }));
    expect(hook.current.status).toBe('refining');
    expect(hook.current.studySet.title).toBe('Mine');

    await act(async () => pending[0].reject(new ApiError('rate_limited', 'Slow down', { retryable: true })));
    expect(hook.current.status).toBe('ready');
    expect(hook.current.studySet.title).toBe('Mine');
    expect(hook.current.error).toMatchObject({ code: 'rate_limited', retryable: true });

    act(() => hook.current.retry());
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[1].kind).toBe('refine');
  });

  test('a failed first generation is an error state', async () => {
    const { result: hook } = renderHook(() => useStudySet());
    act(() => void hook.current.generate({ input: 'x' }));
    await act(async () => pending[0].reject(new Error('boom')));
    expect(hook.current.status).toBe('error');
    expect(hook.current.error).toMatchObject({ code: 'unknown', message: 'boom' });
  });

  test('loading a session cancels whatever was in flight', async () => {
    const { result: hook } = renderHook(() => useStudySet());
    act(() => void hook.current.generate({ input: 'x' }));
    act(() => hook.current.load(setNamed('Saved'), {}));
    await act(async () => pending[0].resolve(result('In flight')));
    expect(hook.current.studySet.title).toBe('Saved');
  });
});
