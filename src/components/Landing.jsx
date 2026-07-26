import { useEffect } from 'react';

/**
 * Full-screen landing page — the first thing you see.
 *
 * The wordmark is split into per-letter spans so each one can rise in on its
 * own delay. That breaks the text up for assistive tech, so the heading
 * carries an aria-label and the letter spans are hidden from the a11y tree.
 */
export function Landing({ onEnter, recentSession, onResume }) {
  // Enter or Space starts, so you never have to reach for the mouse.
  useEffect(() => {
    const onKeyDown = (event) => {
      const tag = event.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onEnter();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onEnter]);

  return (
    <main className="landing">
      <div className="landing__deck" aria-hidden="true">
        <span className="landing__card landing__card--1" />
        <span className="landing__card landing__card--2" />
        <span className="landing__card landing__card--3" />
      </div>

      <div className="landing__inner">
        <p className="landing__eyebrow">Flashcards · Quiz · Re-test</p>

        <h1 className="landing__wordmark" aria-label="Study Assistant">
          <Word text="STUDY" offset={0} />
          <Word text="ASSISTANT" offset={5} accent />
        </h1>

        <p className="landing__lede">
          Paste your notes. Get flashcards you can flip through and a quiz that keeps re-testing
          whatever you got wrong.
        </p>

        <div className="landing__actions">
          <button type="button" className="btn btn--primary btn--hero" onClick={onEnter}>
            Start studying
          </button>

          {recentSession && (
            <button type="button" className="btn btn--ghost" onClick={() => onResume(recentSession)}>
              Resume “{recentSession.title}”
            </button>
          )}
        </div>

        <p className="landing__hint">
          or press <kbd>Enter</kbd>
        </p>
      </div>
    </main>
  );
}

/** Splits a word into animated letters. Decorative only — see the aria-label above. */
function Word({ text, offset, accent = false }) {
  return (
    <span className={`landing__word ${accent ? 'landing__word--accent' : ''}`} aria-hidden="true">
      {Array.from(text, (char, i) => (
        <span className="landing__char" style={{ '--i': offset + i }} key={`${char}-${i}`}>
          {char}
        </span>
      ))}
    </span>
  );
}
