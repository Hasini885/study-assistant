import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const SWIPE_THRESHOLD = 70; // px of travel before a drag counts as a swipe

/**
 * Flip-through flashcards.
 *
 * The current card is controlled by the parent (`index` / `onIndex`) so the
 * browse grid can drop you straight onto a specific card. Ordering and
 * filtering stay local — they are view state that belongs to the deck.
 *
 * `index` always refers to a position in the full `cards` array; `visible` maps
 * the filtered/shuffled view back onto it.
 */
export function Flashcards({ cards, statuses, onMark, index, onIndex }) {
  const [order, setOrder] = useState(() => cards.map((_, i) => i));
  const [flipped, setFlipped] = useState(false);
  const [reviewOnly, setReviewOnly] = useState(false);
  // Which way the next card should fly in from. Purely presentational.
  const [direction, setDirection] = useState('next');

  const visible = useMemo(() => {
    const inRange = order.filter((i) => cards[i]);
    if (!reviewOnly) return inRange;
    return inRange.filter((i) => statuses[cards[i].id] === 'review');
  }, [order, cards, reviewOnly, statuses]);

  // Where the controlled index sits in the current view.
  const position = Math.max(visible.indexOf(index), 0);
  const cardIndex = visible[position];
  const card = cards[cardIndex];

  const go = useCallback(
    (delta) => {
      const next = position + delta;
      if (next < 0 || next >= visible.length) return;
      setDirection(delta > 0 ? 'next' : 'prev');
      setFlipped(false);
      onIndex(visible[next]);
    },
    [position, visible, onIndex]
  );

  /** Jump straight to a card from the jump bar or the rail. */
  const jumpTo = useCallback(
    (cardArrayIndex, viewPosition) => {
      setDirection(viewPosition >= position ? 'next' : 'prev');
      setFlipped(false);
      onIndex(cardArrayIndex);
    },
    [position, onIndex]
  );

  const mark = useCallback(
    (status) => {
      if (!card) return;
      onMark(card.id, status);
      if (position < visible.length - 1) go(1); // marking means "done with this one"
    },
    [card, onMark, position, visible.length, go]
  );

  const { dragX, dragging, handlers, wasDragged } = useSwipe({
    onSwipeLeft: () => go(1),
    onSwipeRight: () => go(-1),
    canSwipeLeft: position < visible.length - 1,
    canSwipeRight: position > 0,
  });

  useKeyboardShortcuts({
    ArrowRight: () => go(1),
    ArrowLeft: () => go(-1),
    1: () => mark('known'),
    2: () => mark('review'),
  });

  // If the filter empties the view, offer a way back rather than a blank panel.
  if (!card) {
    return (
      <div className="deck__done">
        <p>Nothing flagged for review yet. Mark a card “Review later” to build a drill list.</p>
        <button type="button" className="btn" onClick={() => setReviewOnly(false)}>
          Show all {cards.length} cards
        </button>
      </div>
    );
  }

  const status = statuses[card.id];

  return (
    <div className="deck">
      <div className="deck__meta">
        <span className="deck__position">
          <strong>{position + 1}</strong> / {visible.length}
        </span>
        <div className="deck__tools">
          <label className="toggle">
            <input
              type="checkbox"
              checked={reviewOnly}
              onChange={(event) => setReviewOnly(event.target.checked)}
            />
            Flagged only
          </label>
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={() => {
              setOrder((current) => shuffled(current));
              setFlipped(false);
            }}
          >
            Shuffle
          </button>
        </div>
      </div>

      <div className="deck__layout">
        <div className="deck__main">
          <div
            className={`deck__stage ${dragging ? 'is-dragging' : ''}`}
            style={{ '--drag': `${dragX}px`, '--drag-turn': `${dragX / 28}deg` }}
            {...handlers}
          >
            {/*
              Ghost layers behind the active card, so the deck reads as a
              physical stack. They thin out as you advance, which makes
              "how much is left" legible without reading the counter.
            */}
            {[2, 1]
              .filter((layer) => visible.length - position - 1 >= layer)
              .map((layer) => (
                <span key={layer} className={`deck__ghost deck__ghost--${layer}`} aria-hidden="true" />
              ))}

            {/*
              Keyed on the card so React remounts this wrapper on every move,
              which restarts the entrance animation. data-dir picks the side it
              flies in from, so movement reads as travel through the deck.
            */}
            <div className="deck__slide" key={cardIndex} data-dir={direction}>
              <button
                type="button"
                className={`card ${flipped ? 'is-flipped' : ''} ${status ? `card--${status}` : ''}`}
                onClick={() => {
                  // A drag that ends on the card would otherwise also fire a click.
                  if (wasDragged()) return;
                  setFlipped((v) => !v);
                }}
                aria-label={
                  flipped ? 'Answer. Activate to see the question.' : 'Question. Activate to reveal the answer.'
                }
              >
                <span className="card__inner">
                  <span className="card__face card__face--front">
                    <span className="card__tag">Question</span>
                    <span className="card__text">{card.front}</span>
                    {card.hint && <span className="card__hint">Hint: {card.hint}</span>}
                    <span className="card__nudge">Click, or press Space, to flip</span>
                    {/* Rubber stamp for marked cards — the status is already
                        conveyed by the buttons below, so this is decorative. */}
                    {status && (
                      <span className={`card__stamp card__stamp--${status}`} aria-hidden="true">
                        {status === 'known' ? 'Mastered' : 'Review'}
                      </span>
                    )}
                  </span>
                  <span className="card__face card__face--back">
                    <span className="card__tag">Answer</span>
                    <span className="card__text">{card.back}</span>
                  </span>
                </span>
              </button>
            </div>
          </div>

          <p className="sr-only" aria-live="polite">
            {flipped ? card.back : card.front}
          </p>

          <div className="deck__controls">
            <button type="button" className="btn btn--icon" onClick={() => go(-1)} disabled={position === 0} aria-label="Previous card">
              ←
            </button>
            <button type="button" className="btn btn--wide" onClick={() => setFlipped((v) => !v)}>
              {flipped ? 'Show question' : 'Reveal answer'}
            </button>
            <button
              type="button"
              className="btn btn--icon"
              onClick={() => go(1)}
              disabled={position >= visible.length - 1}
              aria-label="Next card"
            >
              →
            </button>
          </div>

          <div className="deck__marks">
            <button type="button" className={`btn btn--mark ${status === 'known' ? 'is-active' : ''}`} onClick={() => mark('known')}>
              Got it <kbd>1</kbd>
            </button>
            <button
              type="button"
              className={`btn btn--mark btn--mark-review ${status === 'review' ? 'is-active' : ''}`}
              onClick={() => mark('review')}
            >
              Review later <kbd>2</kbd>
            </button>
          </div>

          {/* Compact jump bar, for screens too narrow to justify the rail. */}
          <div className="jumpbar" role="group" aria-label="Jump to card">
            {visible.map((i, n) => {
              const tickStatus = statuses[cards[i].id];
              return (
                <button
                  key={cards[i].id}
                  type="button"
                  className={`jumpbar__tick ${n === position ? 'is-current' : ''} ${tickStatus ? `is-${tickStatus}` : ''}`}
                  onClick={() => jumpTo(i, n)}
                  aria-label={`Go to card ${n + 1}`}
                  aria-current={n === position}
                />
              );
            })}
          </div>

          <p className="deck__hint">Swipe or drag the card sideways · ← → to move · 1 / 2 to mark</p>
        </div>

        {/*
          Wide screens get a rail listing every card in the current view, so the
          set as a whole stays visible while you drill one card. Hidden by CSS
          below 1100px, where the jump bar covers the same ground in less space.
        */}
        <aside className="rail" aria-label="Cards in this deck">
          <ol className="rail__list">
            {visible.map((i, n) => {
              const item = cards[i];
              const itemStatus = statuses[item.id];
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`rail__item ${n === position ? 'is-current' : ''}`}
                    onClick={() => jumpTo(i, n)}
                    aria-current={n === position}
                    style={{ '--i': n }}
                  >
                    <span className="rail__num">{n + 1}</span>
                    <span className="rail__text">{item.front}</span>
                    <span className={`dot ${itemStatus ? `dot--${itemStatus}` : 'dot--unseen'}`} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ol>
        </aside>
      </div>
    </div>
  );
}

/**
 * Pointer-based swipe, using Pointer Events so mouse drag, touch and pen all
 * take the same path. The card follows your finger and snaps back if you don't
 * cross the threshold, which makes the gesture discoverable.
 */
function useSwipe({ onSwipeLeft, onSwipeRight, canSwipeLeft, canSwipeRight }) {
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startRef = useRef(null);
  // When the last real drag happened. A timestamp rather than a boolean: a drag
  // that ends off the card never produces a click to clear the flag, and a
  // stale `true` would then swallow the next keyboard-triggered flip.
  const draggedAtRef = useRef(0);

  const end = useCallback(() => {
    if (!startRef.current) return;
    const dx = dragX;
    startRef.current = null;
    setDragging(false);
    setDragX(0);

    if (dx <= -SWIPE_THRESHOLD && canSwipeLeft) onSwipeLeft();
    else if (dx >= SWIPE_THRESHOLD && canSwipeRight) onSwipeRight();
  }, [dragX, canSwipeLeft, canSwipeRight, onSwipeLeft, onSwipeRight]);

  const handlers = {
    onPointerDown: (event) => {
      // Ignore secondary buttons; let real clicks through untouched.
      if (event.button !== 0) return;
      startRef.current = { x: event.clientX, y: event.clientY };
      setDragging(true);
    },
    onPointerMove: (event) => {
      if (!startRef.current) return;
      const dx = event.clientX - startRef.current.x;
      const dy = event.clientY - startRef.current.y;

      // Vertical intent means the user is scrolling the page, not swiping.
      if (Math.abs(dx) < 6 && Math.abs(dy) > Math.abs(dx)) {
        startRef.current = null;
        setDragging(false);
        setDragX(0);
        return;
      }

      if (Math.abs(dx) > 6) draggedAtRef.current = Date.now();
      // Resist dragging toward an edge there is nothing beyond.
      const blocked = (dx < 0 && !canSwipeLeft) || (dx > 0 && !canSwipeRight);
      setDragX(blocked ? dx * 0.25 : dx);
    },
    onPointerUp: end,
    onPointerCancel: end,
    onPointerLeave: () => {
      if (startRef.current) end();
    },
  };

  // The click that follows a drag fires within a frame or two of pointerup.
  return { dragX, dragging, handlers, wasDragged: () => Date.now() - draggedAtRef.current < 300 };
}

function shuffled(list) {
  const next = [...list];
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

/** Global keys, suppressed while typing so the refine box stays usable. */
function useKeyboardShortcuts(handlers) {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const tag = event.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable) return;

      const handler = ref.current[event.key];
      if (!handler) return;
      event.preventDefault();
      handler();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
