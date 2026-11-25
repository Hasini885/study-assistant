import { useCallback, useEffect, useMemo, useState } from 'react';
import { GRADES, formatInterval, previewIntervals } from '@contract/srs.js';

const LABELS = { again: 'Again', hard: 'Hard', good: 'Good', easy: 'Easy' };
const KEYS = { a: 'again', h: 'hard', g: 'good', e: 'easy' };

/**
 * "Due today": every card whose review date has come, across all saved
 * sessions, in one queue.
 *
 * The queue is a snapshot taken when you open the view, so grading a card
 * can't make the list jump under you. A card you answer "Again" goes to the
 * back of the queue and comes round once more before you finish — the same
 * thing Anki's relearning step does.
 *
 * Card content is read from the live sessions on every render, so a card
 * deleted in another tab simply drops out.
 */
export function DueReview({ sessions, initialQueue, onGrade, onExit }) {
  const [queue, setQueue] = useState(() => initialQueue.map(({ sessionId, card }) => ({ sessionId, cardId: card.id })));
  const [flipped, setFlipped] = useState(false);
  const [reviewed, setReviewed] = useState(0);

  const lookup = useMemo(() => {
    const map = new Map();
    for (const session of sessions) {
      for (const card of session.studySet.flashcards) {
        map.set(`${session.id}\u0000${card.id}`, { session, card, record: session.progress?.[card.id] });
      }
    }
    return map;
  }, [sessions]);

  const live = queue.filter((item) => lookup.has(`${item.sessionId}\u0000${item.cardId}`));
  const current = live[0] ? lookup.get(`${live[0].sessionId}\u0000${live[0].cardId}`) : null;

  const grade = useCallback(
    (value) => {
      if (!current || !flipped) return;
      onGrade(current.session.id, current.card.id, value);
      setReviewed((n) => n + 1);
      setFlipped(false);
      setQueue((items) => {
        const [first, ...rest] = items.filter((item) => lookup.has(`${item.sessionId}\u0000${item.cardId}`));
        return value === 'again' ? [...rest, first] : rest;
      });
    },
    [current, flipped, onGrade, lookup]
  );

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const tag = event.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable) return;
      const key = event.key.toLowerCase();
      if (KEYS[key] && flipped) {
        event.preventDefault();
        grade(KEYS[key]);
      } else if (event.key === ' ' && tag !== 'BUTTON') {
        // A focused button already flips on Space natively; this covers the
        // moment after grading, when the remounted card has no focus.
        event.preventDefault();
        setFlipped((v) => !v);
      } else if (key === 'escape') {
        onExit();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [flipped, grade, onExit]);

  if (!current) {
    return (
      <section className="due due--done" aria-live="polite">
        <h2 className="due__title">All caught up</h2>
        <p className="due__note">
          {reviewed > 0
            ? `You reviewed ${reviewed} card${reviewed === 1 ? '' : 's'}. Come back when the next ones are due.`
            : 'Nothing is due today. Grade cards as you study and they’ll come back here when it’s time.'}
        </p>
        <button type="button" className="btn btn--primary" onClick={onExit}>
          Back to studying
        </button>
      </section>
    );
  }

  const preview = previewIntervals(current.record?.srs, Date.now());

  return (
    <section className="due" aria-label="Cards due today">
      <header className="due__header">
        <div>
          <h2 className="due__title">Due today</h2>
          <p className="due__note">
            {live.length} left · from <strong>{current.session.title}</strong>
          </p>
        </div>
        <button type="button" className="btn btn--ghost btn--small" onClick={onExit}>
          Done
        </button>
      </header>

      <div className="deck__stage">
        <div className="deck__slide" key={`${current.session.id}-${current.card.id}-${queue.length}`} data-dir="next">
          <button
            type="button"
            className={`card ${flipped ? 'is-flipped' : ''}`}
            onClick={() => setFlipped((v) => !v)}
            aria-label={flipped ? 'Answer. Activate to see the question.' : 'Question. Activate to reveal the answer.'}
          >
            <span className="card__inner">
              <span className="card__face card__face--front">
                <span className="card__tag">Question</span>
                <span className="card__text">{current.card.front}</span>
                {current.card.hint && <span className="card__hint">Hint: {current.card.hint}</span>}
                <span className="card__nudge">Click, or press Space, to flip</span>
              </span>
              <span className="card__face card__face--back">
                <span className="card__tag">Answer</span>
                <span className="card__text">{current.card.back}</span>
              </span>
            </span>
          </button>
        </div>
      </div>

      <p className="sr-only" aria-live="polite">
        {flipped ? current.card.back : current.card.front}
      </p>

      {flipped ? (
        <div className="grades" role="group" aria-label="How well did you know it? Schedules the next review.">
          {GRADES.map((value, i) => (
            <button
              key={value}
              type="button"
              className={`grade grade--${value}`}
              onClick={() => grade(value)}
              style={{ '--i': i }}
              aria-label={`${LABELS[value]}: see it again in ${formatInterval(preview[value])}`}
            >
              <span className="grade__label">{LABELS[value]}</span>
              <span className="grade__when">{formatInterval(preview[value])}</span>
              <kbd>{value[0].toUpperCase()}</kbd>
            </button>
          ))}
        </div>
      ) : (
        <div className="deck__controls">
          <button type="button" className="btn btn--wide btn--primary" onClick={() => setFlipped(true)}>
            Reveal answer
          </button>
        </div>
      )}

      <p className="deck__hint">Space to flip · A / H / G / E to grade · Esc to finish</p>
    </section>
  );
}
