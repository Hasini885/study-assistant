/**
 * Shows whether a card or question is backed by the user's own notes.
 *
 * `grounded` is set by the server, which looked for the item's quote in the
 * notes (backend/shared/grounding.js):
 *   true       "From your notes", with the quote — so you can see the evidence
 *   false      a quiet "Not found in your notes": not an error, a nudge to
 *              double-check this one against your notes
 *   undefined  nothing — a set made from a bare topic has no notes to cite
 *
 * Spans only, so it can sit inside the flip-card <button>.
 */
export function SourceBadge({ item, showQuote = true }) {
  if (item?.grounded === true) {
    return (
      <span className="source source--ok">
        <span className="source__badge">
          <span aria-hidden="true">✓ </span>From your notes
        </span>
        {showQuote && item.source && <q className="source__quote">{item.source}</q>}
      </span>
    );
  }
  if (item?.grounded === false) {
    return (
      <span
        className="source source--warn"
        title="The model's supporting quote couldn't be found in your notes. Worth checking."
      >
        <span className="source__badge">
          <span aria-hidden="true">? </span>Not found in your notes
        </span>
      </span>
    );
  }
  return null;
}

/** One line under the set title: "7 of 8 items verified against your notes". */
export function GroundingSummary({ grounding }) {
  if (!grounding?.checked) return null;
  const { checked, verified } = grounding;
  const all = verified === checked;
  return (
    <p className={`grounding-summary ${all ? 'is-ok' : 'is-partial'}`}>
      {all ? '✓ ' : ''}
      {verified} of {checked} items verified against your notes
      {!all && ' — the rest are marked so you can check them.'}
    </p>
  );
}
