import { useCallback, useEffect, useState } from 'react';
import { isValidStudySet } from '@contract/normalize.js';
import { MAX_SESSIONS, STORAGE_KEY, loadSessions, sanitizeProgress, writeSessions } from '../lib/sessionStore.js';

/**
 * Saved sessions — the study set plus your progress through it — persisted to
 * localStorage. All validation and migration lives in lib/sessionStore.js;
 * this hook only holds the list in state and writes it back.
 */
export function useSessions() {
  const [sessions, setSessions] = useState(readFromStorage);

  // Keep tabs in sync so studying in one doesn't leave another showing stale data.
  useEffect(() => {
    const onStorage = (event) => {
      if (event.key === STORAGE_KEY) setSessions(readFromStorage());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  /** Applies `change` to the list and persists the result. */
  const update = useCallback((change) => {
    setSessions((current) => {
      const next = change(current);
      if (next !== current) writeSessions(safeStorage(), next);
      return next;
    });
  }, []);

  const saveSession = useCallback(
    (studySet, meta, existingId, progress) => {
      if (!isValidStudySet(studySet)) return null;

      const id = existingId || `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      const entry = {
        id,
        title: studySet.title || 'Untitled set',
        savedAt: Date.now(),
        counts: { flashcards: studySet.flashcards.length, quiz: studySet.quiz.length },
        studySet,
        meta: meta ?? null,
        progress: sanitizeProgress(progress, studySet.flashcards),
      };

      update((current) => [entry, ...current.filter((s) => s.id !== id)].slice(0, MAX_SESSIONS));
      return id;
    },
    [update]
  );

  /** `change` receives the session's progress map and returns the new one. */
  const updateProgress = useCallback(
    (id, change) =>
      update((current) => {
        const index = current.findIndex((s) => s.id === id);
        if (index === -1) return current;
        const session = current[index];
        const progress = typeof change === 'function' ? change(session.progress ?? {}) : change;
        if (progress === session.progress) return current;
        const next = [...current];
        next[index] = { ...session, progress };
        return next;
      }),
    [update]
  );

  const deleteSession = useCallback((id) => update((current) => current.filter((s) => s.id !== id)), [update]);

  const clearSessions = useCallback(() => update(() => []), [update]);

  return { sessions, saveSession, updateProgress, deleteSession, clearSessions };
}

function readFromStorage() {
  return loadSessions(safeStorage()).sessions;
}

function safeStorage() {
  try {
    return window.localStorage;
  } catch {
    return null; // some browsers throw on access when storage is disabled
  }
}
