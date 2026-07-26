import { useMemo, useState } from 'react';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'unseen', label: 'Unseen' },
  { id: 'known', label: 'Known' },
  { id: 'review', label: 'To review' },
];

/**
 * Browse view: every card at once.
 *
 * The deck is for drilling one card at a time; this is for getting your
 * bearings — scanning the whole set, spotting a card the model got wrong, and
 * jumping straight to it. Tiles flip in place, independently of each other.
 */
export function CardGrid({ cards, statuses, onMark, onStudyCard }) {
  const [filter, setFilter] = useState('all');
  const [flipped, setFlipped] = useState(() => new Set());

  const shown = useMemo(
    () =>
      cards
        .map((card, index) => ({ card, index }))
        .filter(({ card }) => {
          const status = statuses[card.id];
          if (filter === 'all') return true;
          if (filter === 'unseen') return !status;
          return status === filter;
        }),
    [cards, statuses, filter]
  );

  const toggleFlip = (id) =>
    setFlipped((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const counts = useMemo(() => {
    const tally = { all: cards.length, unseen: 0, known: 0, review: 0 };
    for (const card of cards) {
      const status = statuses[card.id];
      if (status === 'known') tally.known++;
      else if (status === 'review') tally.review++;
      else tally.unseen++;
    }
    return tally;
  }, [cards, statuses]);

  return (
    <div className="browse">
      <div className="browse__bar">
        <div className="chips chips--filter" role="group" aria-label="Filter cards">
          {FILTERS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={`chip ${filter === id ? 'is-active' : ''}`}
              onClick={() => setFilter(id)}
              aria-pressed={filter === id}
            >
              {label} <span className="chip__count">{counts[id]}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn btn--ghost btn--small"
          onClick={() => setFlipped((current) => (current.size ? new Set() : new Set(cards.map((c) => c.id))))}
        >
          {flipped.size ? 'Hide all answers' : 'Reveal all answers'}
        </button>
      </div>

      {shown.length === 0 ? (
        <p className="browse__empty">No cards in this filter yet.</p>
      ) : (
        <ul className="grid">
          {shown.map(({ card, index }, n) => {
            const status = statuses[card.id];
            const isFlipped = flipped.has(card.id);

            return (
              // --i drives a staggered entrance, so the grid cascades in.
              <li key={card.id} className={`tile ${status ? `tile--${status}` : ''}`} style={{ '--i': n }}>
                <button
                  type="button"
                  className="tile__face"
                  onClick={() => toggleFlip(card.id)}
                  aria-expanded={isFlipped}
                >
                  <span className="tile__index">{index + 1}</span>
                  <span className="tile__question">{card.front}</span>
                  {isFlipped ? (
                    <span className="tile__answer">{card.back}</span>
                  ) : (
                    <span className="tile__prompt">Show answer</span>
                  )}
                </button>

                <div className="tile__actions">
                  <button
                    type="button"
                    className={`tile__mark ${status === 'known' ? 'is-active' : ''}`}
                    onClick={() => onMark(card.id, 'known')}
                    title="Mark as known"
                  >
                    ✓
                  </button>
                  <button
                    type="button"
                    className={`tile__mark tile__mark--review ${status === 'review' ? 'is-active' : ''}`}
                    onClick={() => onMark(card.id, 'review')}
                    title="Flag for review"
                  >
                    ★
                  </button>
                  <button type="button" className="tile__study" onClick={() => onStudyCard(index)}>
                    Study
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
