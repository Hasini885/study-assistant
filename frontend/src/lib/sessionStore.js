import { isValidStudySet } from '@contract/normalize.js';
import { isWellFormedId } from '@contract/ids.js';
import { isDueToday, isValidCardState, schedule } from '@contract/srs.js';

/**
 * Saved sessions in localStorage, as pure functions over a Storage-like object.
 *
 * Storage is untrusted input: it can be absent (Safari private mode), corrupt
 * (hand-edited, or written by an older version of this app), or full. Every
 * read is validated — the study set with the same check the network uses, the
 * progress record by record — and every write is wrapped, because a storage
 * failure must never take down the app.
 *
 * VERSIONS
 *   v1  [{ id, title, savedAt, counts, studySet, meta }]
 *   v2  the same, plus `progress: { [cardId]: { status?, srs? } }`
 * The key carries the version, so an older build of the app that's still open
 * in another tab never reads a shape it doesn't understand. v1 is migrated on
 * first read and then removed.
 */

export const STORAGE_KEY = 'study-assistant:sessions:v2';
export const LEGACY_KEY_V1 = 'study-assistant:sessions:v1';
export const MAX_SESSIONS = 12;

const STATUSES = new Set(['known', 'review']);

/**
 * Reads sessions, migrating v1 data if that's all there is.
 * @param {Storage | null | undefined} storage
 * @returns {{sessions: object[], migrated: boolean}}
 */
export function loadSessions(storage) {
  const current = readJson(storage, STORAGE_KEY);
  if (current !== undefined) return { sessions: sanitizeSessions(current), migrated: false };

  const legacy = readJson(storage, LEGACY_KEY_V1);
  if (legacy === undefined) return { sessions: [], migrated: false };

  const sessions = sanitizeSessions(Array.isArray(legacy) ? legacy.map(migrateV1Entry) : []);
  // Only drop the old copy once the new one is safely written.
  if (writeSessions(storage, sessions)) {
    try {
      storage.removeItem(LEGACY_KEY_V1);
    } catch {
      /* harmless: v1 is never read again once v2 exists */
    }
  }
  return { sessions, migrated: true };
}

/** @returns {boolean} whether the write succeeded */
export function writeSessions(storage, sessions) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    return true;
  } catch {
    // Quota exceeded or storage disabled. The in-memory list still works for
    // this visit, which beats an error dialog.
    return false;
  }
}

/** v1 entries had no progress. Everything else carries over. */
export function migrateV1Entry(entry) {
  if (!entry || typeof entry !== 'object') return entry;
  return { ...entry, progress: {} };
}

export function sanitizeSessions(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of value) {
    const session = sanitizeSession(entry);
    if (!session || seen.has(session.id)) continue;
    seen.add(session.id);
    out.push(session);
    if (out.length >= MAX_SESSIONS) break;
  }
  return out;
}

/** @returns {object | null} a clean v2 session, or null if it can't be salvaged */
export function sanitizeSession(entry) {
  if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !entry.id) return null;
  if (!isValidStudySet(entry.studySet)) return null;

  const { studySet } = entry;
  return {
    id: entry.id,
    title: typeof entry.title === 'string' && entry.title ? entry.title : studySet.title || 'Untitled set',
    savedAt: Number.isFinite(entry.savedAt) ? entry.savedAt : 0,
    counts: { flashcards: studySet.flashcards.length, quiz: studySet.quiz.length },
    studySet,
    meta: entry.meta && typeof entry.meta === 'object' ? entry.meta : null,
    progress: sanitizeProgress(entry.progress, studySet.flashcards),
  };
}

/**
 * Keeps only well-formed records for cards that are actually in the set, so
 * stale ids from a deleted card can't accumulate forever.
 */
export function sanitizeProgress(value, cards = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const ids = new Set(cards.map((card) => card.id));
  const out = {};
  for (const [id, record] of Object.entries(value)) {
    if (!ids.has(id) || !isWellFormedId(id)) continue;
    const clean = sanitizeRecord(record);
    if (clean) out[id] = clean;
  }
  return out;
}

function sanitizeRecord(record) {
  if (!record || typeof record !== 'object') return null;
  const clean = {};
  if (STATUSES.has(record.status)) clean.status = record.status;
  if (isValidCardState(record.srs)) clean.srs = { ...record.srs };
  return Object.keys(clean).length ? clean : null;
}

/**
 * The record after grading a card. A grade also sets the simpler known/review
 * status, so the progress ring, the stamps and the filters all agree with the
 * scheduler: Again and Hard mean "review", Good and Easy mean "known".
 */
export function gradeRecord(record, grade, now) {
  return {
    ...(record ?? {}),
    status: grade === 'again' || grade === 'hard' ? 'review' : 'known',
    srs: schedule(record?.srs, grade, now),
  };
}

/** Every card due today across all sessions, soonest first. */
export function collectDue(sessions, now) {
  const due = [];
  for (const session of sessions) {
    for (const card of session.studySet.flashcards) {
      const srs = session.progress?.[card.id]?.srs;
      if (isDueToday(srs, now)) due.push({ sessionId: session.id, sessionTitle: session.title, card, due: srs.due });
    }
  }
  return due.sort((a, b) => a.due - b.due);
}

/** { [sessionId]: number of cards due today } — only sessions with something due. */
export function dueCountsBySession(sessions, now) {
  const counts = {};
  for (const item of collectDue(sessions, now)) counts[item.sessionId] = (counts[item.sessionId] ?? 0) + 1;
  return counts;
}

function readJson(storage, key) {
  let raw;
  try {
    raw = storage?.getItem(key);
  } catch {
    return undefined;
  }
  if (raw === null || raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return null; // present but unreadable: start clean rather than crash on boot
  }
}
