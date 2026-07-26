/**
 * Live progress for the current set, shown in the sidebar.
 *
 * Card progress comes from useStudyProgress; the quiz figure is the most
 * recent round reported by <Quiz>, which is why it can say "round 2" — a
 * re-test is a new round over just the questions you missed.
 */
export function ProgressPanel({ counts, quizStats, onResetProgress }) {
  const done = counts.known + counts.review;
  const percent = counts.total ? Math.round((counts.known / counts.total) * 100) : 0;

  return (
    <section className="panel">
      <h2 className="panel__title">Progress</h2>

      <div className="panel__ring-row">
        <div className="ring" style={{ '--pct': percent }} role="img" aria-label={`${percent} percent of cards marked known`}>
          <span>{percent}%</span>
        </div>
        <div className="panel__ring-note">
          <strong>
            {counts.known} of {counts.total}
          </strong>
          <span>cards marked known</span>
        </div>
      </div>

      <ul className="statlist">
        <li>
          <span className="dot dot--known" /> Known <strong>{counts.known}</strong>
        </li>
        <li>
          <span className="dot dot--review" /> To review <strong>{counts.review}</strong>
        </li>
        <li>
          <span className="dot dot--unseen" /> Untouched <strong>{counts.unseen}</strong>
        </li>
      </ul>

      {quizStats && (
        <div className="panel__quiz">
          <span className="panel__quiz-label">
            Last quiz{quizStats.round > 1 ? ` · re-test round ${quizStats.round}` : ''}
          </span>
          <strong className="panel__quiz-score">
            {quizStats.correct} / {quizStats.total}
          </strong>
        </div>
      )}

      {done > 0 && (
        <button type="button" className="btn btn--ghost btn--small" onClick={onResetProgress}>
          Reset progress
        </button>
      )}
    </section>
  );
}
