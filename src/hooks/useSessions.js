import { useCallback, useEffect, useState } from 'react';
import { isValidStudySet } from '../../shared/normalize.js';

const STORAGE_KEY = 'study-assistant:sessions:v1';
const MAX_SESSIONS = 12;

/**
 * Saved sessions, persisted to localStorage.
 *
 * Storage is treated as untrusted input: it can be absent (Safari private
 * mode), corrupt (hand-edited, or written by an older version of this app), or
 * full. Every read is validated with the same schema check the network uses,
 * and every write is wrapped — a storage failure must never take down the app.
 */
export function useSessions() {
  const [sessions, setSessions] = useState(readSessions);

  // Keep tabs in sync so saving in one doesn't leave another showing stale data.
  useEffect(() => {
    const onStorage = (event) => {
      if (event.key === STORAGE_KEY) setSessions(readSessions());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const persist = useCallback((next) => {
    setSessions(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Quota exceeded or storage disabled. The in-memory list still works for
      // this visit, which is a better outcome than an error dialog.
    }
    return next;
  }, []);

  const saveSession = useCallback(
    (studySet, meta, existingId) => {
      if (!isValidStudySet(studySet)) return null;

      const id = existingId || `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      const entry = {
        id,
        title: studySet.title || 'Untitled set',
        savedAt: Date.now(),
        counts: { flashcards: studySet.flashcards.length, quiz: studySet.quiz.length },
        studySet,
        meta: meta ?? null,
      };

      setSessions((current) => {
        const next = [entry, ...current.filter((s) => s.id !== id)].slice(0, MAX_SESSIONS);
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          /* see persist() */
        }
        return next;
      });

      return id;
    },
    []
  );

  const deleteSession = useCallback(
    (id) => setSessions((current) => persistAndReturn(current.filter((s) => s.id !== id))),
    []
  );

  const clearSessions = useCallback(() => persist([]), [persist]);

  return { sessions, saveSession, deleteSession, clearSessions };
}

function persistAndReturn(next) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* non-fatal */
  }
  return next;
}

function readSessions() {
  let parsed;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    parsed = JSON.parse(raw);
  } catch {
    return []; // unreadable or not JSON — start clean rather than crash on boot
  }

  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter((entry) => entry && typeof entry.id === 'string' && isValidStudySet(entry.studySet))
    .slice(0, MAX_SESSIONS);
}
