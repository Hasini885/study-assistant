import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * Flip-through flashcards.
 *
 * Progress (known / needs-review) lives here rather than in the app-level
 * study-set state, because it is view state: it should survive navigating
 * between cards but reset when a genuinely new set arrives. The `key` on this
 * component in StudySetView does exactly that.
 */
export function Flashcards({ cards }) {
  const [order, setOrder] = useState(() => cards.map((_, i) => i));
  const [position, setPosition] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [statuses, setStatuses] = useState({}); // cardId -> 'known' | 'review'
  const [reviewOnly, setReviewOnly] = useState(false);

  const visible = useMemo(() => {
    const indices = order.filter((i) => cards[i]);
    if (!reviewOnly) return indices;
    return indices.filter((i) => statuses[cards[i].id] === 'review');
  }, [order, cards, reviewOnly, statuses]);

  // Clamp when the visible list shrinks (e.g. after un-flagging the last card).
  const safePosition = Math.min(position, Math.max(visible.length - 1, 0));
  const card = cards[visible[safePosition]];

  const go = useCallback(
    (delta) => {
      setFlipped(false);
      setPosition((current) => {
        const next = current + delta;
        if (next < 0 || next >= visible.length) return current;
        return next;
      });
    },
    [visible.length]
  );

  const mark = useCallback(
    (status) => {
      if (!card) return;
      setStatuses((current) => ({
        ...current,
        [card.id]: current[card.id] === status ? undefined : status,
      }));
      // Marking is the "I'm done with this one" gesture, so advance.
      if (safePosition < visible.length - 1) go(1);
    },
    [card, go, safePosition, visible.length]
  );

  const shuffle = useCallback(() => {
    setOrder((current) => {
      const next = [...current];
      for (let i = next.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [next[i], next[j]] = [next[j], next[i]];
      }
      return next;
    });
    setPosition(0);
    setFlipped(false);
  }, []);

  useKeyboardShortcuts({
    ArrowRight: () => go(1),
    ArrowLeft: () => go(-1),
    '1': () => mark('known'),
    '2': () => mark('review'),
  });

  const knownCount = Object.values(statuses).filter((s) => s === 'known').length;
  const reviewCount = Object.values(statuses).filter((s) => s === 'review').length;

  if (!card) {
    return (
      <div className="deck__done">
        <p>Nothing flagged for review. Turn the filter off to see every card.</p>
        <button type="button" className="btn" onClick={() => setReviewOnly(false)}>
          Show all {cards.length} cards
        </button>
      </div>
    );
  }

  return (
    <div className="deck">
      <div className="deck__meta">
        <span className="deck__position">
          Card {safePosition + 1} of {visible.length}
        </span>
        <div className="deck__tally">
          <span className="tally tally--known">{knownCount} known</span>
          <span className="tally tally--review">{reviewCount} to review</span>
        </div>
      </div>

      <div className="progress" role="progressbar" aria-valuemin={1} aria-valuemax={visible.length} aria-valuenow={safePosition + 1}>
        <div className="progress__bar" style={{ width: `${((safePosition + 1) / visible.length) * 100}%` }} />
      </div>

      {/*
        A <button> so Space and Enter flip the card for free, and screen readers
        announce it as interactive. aria-live carries the newly revealed face.
      */}
      <button
        type="button"
        className={`card ${flipped ? 'is-flipped' : ''} ${statuses[card.id] ? `card--${statuses[card.id]}` : ''}`}
        onClick={() => setFlipped((v) => !v)}
        aria-label={flipped ? 'Answer. Activate to see the question.' : 'Question. Activate to reveal the answer.'}
      >
        <span className="card__inner">
          <span className="card__face card__face--front">
            <span className="card__tag">Question</span>
            <span className="card__text">{card.front}</span>
            {card.hint && <span className="card__hint">Hint: {card.hint}</span>}
          </span>
          <span className="card__face card__face--back">
            <span className="card__tag">Answer</span>
            <span className="card__text">{card.back}</span>
          </span>
        </span>
      </button>

      <p className="sr-only" aria-live="polite">
        {flipped ? card.back : card.front}
      </p>

      <div className="deck__controls">
        <button type="button" className="btn btn--icon" onClick={() => go(-1)} disabled={safePosition === 0} aria-label="Previous card">
          ←
        </button>
        <button type="button" className="btn" onClick={() => setFlipped((v) => !v)}>
          {flipped ? 'Show question' : 'Reveal answer'}
        </button>
        <button
          type="button"
          className="btn btn--icon"
          onClick={() => go(1)}
          disabled={safePosition >= visible.length - 1}
          aria-label="Next card"
        >
          →
        </button>
      </div>

      <div className="deck__marks">
        <button
          type="button"
          className={`btn btn--mark ${statuses[card.id] === 'known' ? 'is-active' : ''}`}
          onClick={() => mark('known')}
        >
          Got it <kbd>1</kbd>
        </button>
        <button
          type="button"
          className={`btn btn--mark btn--mark-review ${statuses[card.id] === 'review' ? 'is-active' : ''}`}
          onClick={() => mark('review')}
        >
          Review later <kbd>2</kbd>
        </button>
      </div>

      <div className="deck__footer">
        <button type="button" className="btn btn--ghost btn--small" onClick={shuffle}>
          Shuffle
        </button>
        <label className="toggle">
          <input
            type="checkbox"
            checked={reviewOnly}
            onChange={(event) => {
              setReviewOnly(event.target.checked);
              setPosition(0);
              setFlipped(false);
            }}
            disabled={reviewCount === 0 && !reviewOnly}
          />
          Only flagged ({reviewCount})
        </label>
      </div>
    </div>
  );
}

/**
 * Global key handling that stays out of the way of text fields — otherwise
 * typing "1" into the refine box would flip a flashcard.
 */
function useKeyboardShortcuts(handlers) {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const tag = event.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable) return;

      const handler = handlers[event.key];
      if (!handler) return;
      event.preventDefault();
      handler();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });
}
