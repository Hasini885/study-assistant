/** Previously saved study sets, restored from localStorage. */
export function SessionList({ sessions, onLoad, onDelete, activeId }) {
  if (sessions.length === 0) return null;

  return (
    <section className="sessions">
      <h2 className="sessions__title">Saved sessions</h2>
      <ul className="sessions__list">
        {sessions.map((session) => (
          <li key={session.id} className={`session ${session.id === activeId ? 'is-active' : ''}`}>
            <button type="button" className="session__open" onClick={() => onLoad(session)}>
              <span className="session__name">{session.title}</span>
              <span className="session__meta">
                {session.counts.flashcards} cards · {session.counts.quiz} questions · {formatWhen(session.savedAt)}
              </span>
            </button>
            <button
              type="button"
              className="session__delete"
              onClick={() => onDelete(session.id)}
              aria-label={`Delete ${session.title}`}
              title="Delete"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function formatWhen(timestamp) {
  const diff = Date.now() - timestamp;
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(timestamp).toLocaleDateString();
}
