import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSessions } from '../src/hooks/useSessions.js';
import { LEGACY_KEY_V1, STORAGE_KEY } from '../src/lib/sessionStore.js';
import { studySet } from './fixtures/studySet.js';

afterEach(() => vi.restoreAllMocks());

const entry = (id, overrides = {}) => ({ id, title: 'Cells', savedAt: 1, counts: {}, studySet, meta: null, progress: {}, ...overrides });

describe('useSessions with untrusted storage', () => {
  test('starts empty when storage holds corrupt JSON', () => {
    window.localStorage.setItem(STORAGE_KEY, '{"broken');
    const { result } = renderHook(() => useSessions());
    expect(result.current.sessions).toEqual([]);
  });

  test('keeps the valid sessions and drops the rest', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([entry('good'), { id: 'bad', studySet: { quiz: 'no' } }, 42, entry('also-good', { progress: 'junk' })])
    );
    const { result } = renderHook(() => useSessions());
    expect(result.current.sessions.map((s) => s.id)).toEqual(['good', 'also-good']);
    expect(result.current.sessions[1].progress).toEqual({});
  });

  test('migrates v1 sessions on first read', () => {
    const { progress: _p, ...v1 } = entry('old');
    window.localStorage.setItem(LEGACY_KEY_V1, JSON.stringify([v1]));
    const { result } = renderHook(() => useSessions());
    expect(result.current.sessions[0]).toMatchObject({ id: 'old', progress: {} });
    expect(window.localStorage.getItem(LEGACY_KEY_V1)).toBeNull();
  });

  test('survives storage that throws on read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const { result } = renderHook(() => useSessions());
    expect(result.current.sessions).toEqual([]);
  });

  test('saving still works in memory when storage is full', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const { result } = renderHook(() => useSessions());
    let id;
    act(() => {
      id = result.current.saveSession(studySet, null, undefined, { 'c-atp': { status: 'known' } });
    });
    expect(id).toBeTruthy();
    expect(result.current.sessions[0].progress).toEqual({ 'c-atp': { status: 'known' } });
  });

  test('refuses to save an invalid set', () => {
    const { result } = renderHook(() => useSessions());
    let id;
    act(() => {
      id = result.current.saveSession({ flashcards: 'nope' });
    });
    expect(id).toBeNull();
    expect(result.current.sessions).toEqual([]);
  });

  test('picks up changes made in another tab', () => {
    const { result } = renderHook(() => useSessions());
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([entry('from-other-tab')]));
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY })));
    expect(result.current.sessions.map((s) => s.id)).toEqual(['from-other-tab']);
  });

  test('updateProgress writes through and ignores unknown sessions', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([entry('s1')]));
    const { result } = renderHook(() => useSessions());
    act(() => result.current.updateProgress('s1', (p) => ({ ...p, 'c-atp': { status: 'review' } })));
    act(() => result.current.updateProgress('missing', () => ({ x: 1 })));
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY))[0].progress).toEqual({ 'c-atp': { status: 'review' } });
  });
});
