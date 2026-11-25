/**
 * Sidebar entry point for spaced repetition: how many cards are due today
 * across every saved session, and a button to review them.
 *
 * Hidden until something has been scheduled — before your first graded card
 * there is nothing useful to say here.
 */
export function DuePanel({ count, hasSchedule, reviewing, onStart }) {
  if (!hasSchedule && count === 0) return null;

  return (
    <section className="panel due-panel">
      <h2 className="panel__title">Due today</h2>
      <div className="due-panel__row">
        <strong className="due-panel__count" aria-live="polite">
          {count}
        </strong>
        <span className="due-panel__label">
          {count === 1 ? 'card to review' : 'cards to review'}
          {count === 0 && <span className="due-panel__done"> · all caught up</span>}
        </span>
      </div>
      {count > 0 && !reviewing && (
        <button type="button" className="btn btn--primary btn--small" onClick={onStart}>
          Review now
        </button>
      )}
    </section>
  );
}
