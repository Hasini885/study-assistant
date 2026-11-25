import { describe, expect, test } from 'vitest';
import { schedule } from '@contract/srs.js';
import {
  LEGACY_KEY_V1,
  MAX_SESSIONS,
  STORAGE_KEY,
  collectDue,
  dueCountsBySession,
  gradeRecord,
  loadSessions,
  sanitizeProgress,
  sanitizeSession,
  writeSessions,
} from '../src/lib/sessionStore.js';

const NOW = new Date(2026, 0, 15, 10, 0).getTime();
const DAY = 86_400_000;

const studySet = {
  title: 'Cells',
  summary: '',
  flashcards: [
    { id: 'c-1', front: 'What is ATP?', back: 'Energy.', hint: '' },
    { id: 'c-2', front: 'What is DNA?', back: 'Genes.', hint: '' },
  ],
  quiz: [],
};

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

function session(overrides = {}) {
  return { id: 's-1', title: 'Cells', savedAt: 1, counts: {}, studySet, meta: null, progress: {}, ...overrides };
}

describe('loadSessions', () => {
  test('returns nothing when storage is empty', () => {
    expect(loadSessions(memoryStorage())).toEqual({ sessions: [], migrated: false });
  });

  test('survives storage that is missing or throws on access', () => {
    expect(loadSessions(null).sessions).toEqual([]);
    const throwing = {
      getItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(loadSessions(throwing).sessions).toEqual([]);
  });

  test('starts clean on corrupt JSON instead of crashing', () => {
    expect(loadSessions(memoryStorage({ [STORAGE_KEY]: '{not json' })).sessions).toEqual([]);
    expect(loadSessions(memoryStorage({ [STORAGE_KEY]: '"a string"' })).sessions).toEqual([]);
  });

  test('migrates v1 sessions to v2 with empty progress, then removes v1', () => {
    const v1 = [{ id: 's-old', title: 'Old', savedAt: 5, counts: { flashcards: 2, quiz: 0 }, studySet, meta: null }];
    const storage = memoryStorage({ [LEGACY_KEY_V1]: JSON.stringify(v1) });

    const { sessions, migrated } = loadSessions(storage);

    expect(migrated).toBe(true);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ id: 's-old', title: 'Old', progress: {} });
    expect(JSON.parse(storage.getItem(STORAGE_KEY))[0].id).toBe('s-old');
    expect(storage.getItem(LEGACY_KEY_V1)).toBeNull();
  });

  test('keeps v1 data if the migrated copy could not be written', () => {
    const storage = memoryStorage({ [LEGACY_KEY_V1]: JSON.stringify([session()]) });
    storage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    expect(loadSessions(storage).sessions).toHaveLength(1);
    expect(storage.getItem(LEGACY_KEY_V1)).not.toBeNull();
  });

  test('prefers v2 over v1 when both exist', () => {
    const storage = memoryStorage({
      [STORAGE_KEY]: JSON.stringify([session({ id: 'new' })]),
      [LEGACY_KEY_V1]: JSON.stringify([session({ id: 'old' })]),
    });
    expect(loadSessions(storage).sessions.map((s) => s.id)).toEqual(['new']);
  });

  test('drops invalid entries, duplicates and anything past the cap', () => {
    const entries = [
      session({ id: 'a' }),
      session({ id: 'a' }),
      { id: 'bad', studySet: { flashcards: 'nope' } },
      null,
      'text',
      ...Array.from({ length: MAX_SESSIONS + 3 }, (_, i) => session({ id: `n${i}` })),
    ];
    const { sessions } = loadSessions(memoryStorage({ [STORAGE_KEY]: JSON.stringify(entries) }));
    expect(sessions).toHaveLength(MAX_SESSIONS);
    expect(sessions[0].id).toBe('a');
    expect(new Set(sessions.map((s) => s.id)).size).toBe(MAX_SESSIONS);
  });
});

describe('sanitizeSession', () => {
  test('recomputes counts and fills in a missing title', () => {
    const clean = sanitizeSession(session({ title: '', counts: { flashcards: 999 } }));
    expect(clean.counts).toEqual({ flashcards: 2, quiz: 0 });
    expect(clean.title).toBe('Cells');
  });

  test('rejects an entry without an id', () => {
    expect(sanitizeSession(session({ id: '' }))).toBeNull();
    expect(sanitizeSession(session({ id: 7 }))).toBeNull();
  });
});

describe('sanitizeProgress', () => {
  test('keeps valid records for cards that exist', () => {
    const srs = schedule(null, 'good', NOW);
    expect(sanitizeProgress({ 'c-1': { status: 'known', srs } }, studySet.flashcards)).toEqual({
      'c-1': { status: 'known', srs },
    });
  });

  test('drops records for unknown cards, bad statuses and corrupt schedules', () => {
    const progress = {
      'c-1': { status: 'mastered', srs: { reps: 'x' } },
      'c-2': { status: 'review', srs: { ease: 99 } },
      'c-gone': { status: 'known' },
    };
    expect(sanitizeProgress(progress, studySet.flashcards)).toEqual({ 'c-2': { status: 'review' } });
  });

  test('treats non-objects as no progress', () => {
    expect(sanitizeProgress(null, studySet.flashcards)).toEqual({});
    expect(sanitizeProgress([1, 2], studySet.flashcards)).toEqual({});
  });
});

describe('writeSessions', () => {
  test('reports failure instead of throwing when storage is full', () => {
    const storage = memoryStorage();
    storage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    expect(writeSessions(storage, [])).toBe(false);
    expect(writeSessions(null, [])).toBe(false);
  });

  test('round-trips through loadSessions', () => {
    const storage = memoryStorage();
    const srs = schedule(null, 'easy', NOW);
    writeSessions(storage, [session({ progress: { 'c-1': { status: 'known', srs } } })]);
    expect(loadSessions(storage).sessions[0].progress).toEqual({ 'c-1': { status: 'known', srs } });
  });
});

describe('grading and due cards', () => {
  test('gradeRecord schedules the card and sets a matching status', () => {
    expect(gradeRecord(undefined, 'again', NOW).status).toBe('review');
    expect(gradeRecord(undefined, 'hard', NOW).status).toBe('review');
    expect(gradeRecord(undefined, 'good', NOW).status).toBe('known');
    expect(gradeRecord({ status: 'review' }, 'easy', NOW)).toMatchObject({ status: 'known', srs: { reps: 1 } });
  });

  test('collectDue gathers due cards across sessions, soonest first', () => {
    const dueNow = gradeRecord(undefined, 'again', NOW - DAY); // due yesterday
    const dueLater = gradeRecord(undefined, 'good', NOW - DAY); // due today at 10:00
    const notDue = gradeRecord(undefined, 'easy', NOW); // due in 4 days

    const sessions = [
      session({ id: 'a', progress: { 'c-1': dueLater, 'c-2': notDue } }),
      session({ id: 'b', title: 'Other', progress: { 'c-2': dueNow, 'c-1': { status: 'known' } } }),
    ];

    const due = collectDue(sessions, NOW);
    expect(due.map((d) => [d.sessionId, d.card.id])).toEqual([
      ['b', 'c-2'],
      ['a', 'c-1'],
    ]);
    expect(due[0].sessionTitle).toBe('Other');
    expect(dueCountsBySession(sessions, NOW)).toEqual({ a: 1, b: 1 });
  });

  test('ungraded and merely marked cards are never due', () => {
    expect(collectDue([session({ progress: { 'c-1': { status: 'review' } } })], NOW)).toEqual([]);
  });
});
