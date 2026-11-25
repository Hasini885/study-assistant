import { useCallback, useMemo } from 'react';
import { isDueToday } from '@contract/srs.js';
import { gradeRecord } from '../lib/sessionStore.js';

/**
 * Per-card study progress: the known/review mark plus the spaced-repetition
 * schedule, keyed by card id.
 *
 * The records themselves are owned by the app — they belong to the saved
 * session when there is one (so every mark is persisted as you make it) and to
 * an in-memory draft otherwise. This hook is the view over them that the deck,
 * the browse grid and the sidebar panel share.
 *
 * @param {Array<{id: string}>} cards
 * @param {Record<string, {status?: string, srs?: object}>} records
 * @param {(change: (records: object) => object) => void} setRecords
 */
export function useStudyProgress(cards, records, setRecords) {
  const statuses = useMemo(() => {
    const out = {};
    for (const [id, record] of Object.entries(records ?? {})) if (record.status) out[id] = record.status;
    return out;
  }, [records]);

  /** Marking a card with the status it already has clears it — the button toggles. */
  const setStatus = useCallback(
    (cardId, status) =>
      setRecords((current) => {
        const record = { ...(current[cardId] ?? {}) };
        if (record.status === status) delete record.status;
        else record.status = status;
        const next = { ...current };
        if (Object.keys(record).length) next[cardId] = record;
        else delete next[cardId];
        return next;
      }),
    [setRecords]
  );

  const grade = useCallback(
    (cardId, value, now = Date.now()) =>
      setRecords((current) => ({ ...current, [cardId]: gradeRecord(current[cardId], value, now) })),
    [setRecords]
  );

  const reset = useCallback(() => setRecords(() => ({})), [setRecords]);

  const counts = useMemo(() => {
    let known = 0;
    let review = 0;
    let due = 0;
    const now = Date.now();
    for (const card of cards) {
      const record = records?.[card.id];
      if (record?.status === 'known') known++;
      else if (record?.status === 'review') review++;
      if (isDueToday(record?.srs, now)) due++;
    }
    return { known, review, unseen: cards.length - known - review, total: cards.length, due };
  }, [cards, records]);

  return { records: records ?? {}, statuses, setStatus, grade, reset, counts };
}
