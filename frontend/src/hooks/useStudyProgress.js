import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * Per-card study progress (known / needs review).
 *
 * This used to live inside <Flashcards>, but three views need it now — the
 * deck, the browse grid, and the sidebar progress panel — so it is lifted to
 * the app and passed down. Card ids are regenerated every time a set is
 * normalized, so watching the first id is enough to detect "this is a
 * different set now" and start clean.
 */
export function useStudyProgress(cards = []) {
  const [statuses, setStatuses] = useState({});
  const setIdentity = cards[0]?.id ?? '';

  useEffect(() => {
    setStatuses({});
  }, [setIdentity]);

  /** Marking a card with the status it already has clears it — the button toggles. */
  const setStatus = useCallback((cardId, status) => {
    setStatuses((current) => {
      const next = { ...current };
      if (next[cardId] === status) delete next[cardId];
      else next[cardId] = status;
      return next;
    });
  }, []);

  const reset = useCallback(() => setStatuses({}), []);

  const counts = useMemo(() => {
    let known = 0;
    let review = 0;
    for (const card of cards) {
      if (statuses[card.id] === 'known') known++;
      else if (statuses[card.id] === 'review') review++;
    }
    return { known, review, unseen: cards.length - known - review, total: cards.length };
  }, [cards, statuses]);

  return { statuses, setStatus, reset, counts };
}
