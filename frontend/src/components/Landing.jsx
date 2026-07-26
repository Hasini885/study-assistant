import { useCallback, useEffect, useState } from 'react';
import { usePointerParallax } from '../hooks/usePointerParallax.js';
import { prefersReducedMotion } from '../hooks/useAnimatedNumber.js';

/** Cycled through in the lede, so the page never sits completely still. */
const TOPICS = [
  'the Krebs cycle',
  'React hooks',
  'the causes of World War I',
  'Big-O notation',
  'photosynthesis',
  'Ohm’s law',
];

const TICKER = [
  'FLASHCARDS',
  'MULTIPLE CHOICE',
  'RE-TEST WRONG ANSWERS',
  'SPACED DRILLING',
  'INSTANT FEEDBACK',
  'SAVE & RESUME',
];

const EXIT_MS = 420;

/**
 * Full-screen landing page — the first thing you see.
 *
 * The wordmark is split into per-letter spans so each can rise in on its own
 * delay. That breaks the text up for assistive tech, so the heading carries an
 * aria-label and the letter spans are hidden from the a11y tree.
 */
export function Landing({ onEnter, recentSession, onResume }) {
  const parallax = usePointerParallax();
  const [topic, setTopic] = useState(0);
  const [leaving, setLeaving] = useState(false);

  // Rotate the example topic. Paused once we start leaving, so the exit
  // animation isn't fighting a text swap.
  useEffect(() => {
    if (leaving || prefersReducedMotion()) return undefined;
    const id = setInterval(() => setTopic((i) => (i + 1) % TOPICS.length), 2400);
    return () => clearInterval(id);
  }, [leaving]);

  /** Play the exit, then hand over. Skipped entirely under reduced motion. */
  const leave = useCallback(
    (action) => {
      if (prefersReducedMotion()) {
        action();
        return;
      }
      setLeaving(true);
      setTimeout(action, EXIT_MS);
    },
    []
  );

  const start = useCallback(() => leave(onEnter), [leave, onEnter]);

  useEffect(() => {
    const onKeyDown = (event) => {
      const tag = event.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        start();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [start]);

  return (
    <main
      className={`landing ${leaving ? 'is-leaving' : ''}`}
      style={{ '--px': parallax.x, '--py': parallax.y }}
    >
      {/* Two parallax planes: the cards drift one way, the wordmark the other. */}
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
          Paste your notes on{' '}
          {/* Keyed so the swap replays the animation each time. */}
          <span className="landing__topic" key={topic}>
            {TOPICS[topic]}
          </span>
          . Get flashcards you can flip through and a quiz that keeps re-testing whatever you got
          wrong.
        </p>

        <div className="landing__actions">
          <button type="button" className="btn btn--primary btn--hero" onClick={start}>
            Start studying
          </button>

          {recentSession && (
            <button type="button" className="btn btn--ghost" onClick={() => leave(() => onResume(recentSession))}>
              Resume “{recentSession.title}”
            </button>
          )}
        </div>

        <p className="landing__hint">
          or press <kbd>Enter</kbd>
        </p>
      </div>

      {/* Editorial ticker. Duplicated once so the loop has no visible seam. */}
      <div className="marquee" aria-hidden="true">
        <div className="marquee__track">
          {[...TICKER, ...TICKER].map((item, i) => (
            <span className="marquee__item" key={i}>
              {item}
            </span>
          ))}
        </div>
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
