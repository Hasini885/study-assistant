import { useEffect, useState } from 'react';

/**
 * Loading, error and empty states.
 *
 * The loading state is skeleton-based rather than a spinner so the layout does
 * not jump when content lands, and it exposes a cancel button — a 30 second
 * model call with no way out is a worse experience than an error.
 */
export function LoadingState({ label = 'Building your study set', onCancel }) {
  const elapsed = useElapsedSeconds();

  return (
    <section className="state state--loading" aria-live="polite" aria-busy="true">
      <div className="state__header">
        <span className="spinner" aria-hidden="true" />
        <div>
          <h2 className="state__title">{label}…</h2>
          <p className="state__note">
            {elapsed < 8
              ? 'Usually takes a few seconds.'
              : elapsed < 20
                ? 'Still working — longer notes take longer.'
                : 'This is slower than usual. You can cancel and try again.'}{' '}
            <span className="state__timer">{elapsed}s</span>
          </p>
        </div>
      </div>

      <div className="skeleton-grid" aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => (
          <div className="skeleton-card" key={i} style={{ animationDelay: `${i * 120}ms` }}>
            <div className="skeleton-line skeleton-line--short" />
            <div className="skeleton-line" />
            <div className="skeleton-line skeleton-line--medium" />
          </div>
        ))}
      </div>

      {onCancel && (
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          Cancel
        </button>
      )}
    </section>
  );
}

/** Full-page error, shown when there is no existing content to fall back to. */
export function ErrorState({ error, onRetry, onReset }) {
  return (
    <section className="state state--error" role="alert">
      <div className="state__icon" aria-hidden="true">
        !
      </div>
      <h2 className="state__title">{titleForError(error.code)}</h2>
      <p className="state__message">{error.message}</p>

      <div className="state__actions">
        {error.retryable !== false && onRetry && (
          <button type="button" className="btn btn--primary" onClick={onRetry}>
            Try again
          </button>
        )}
        <button type="button" className="btn btn--ghost" onClick={onReset}>
          Start over
        </button>
      </div>

      {error.code === 'not_configured' && (
        <p className="state__hint">
          Copy <code>.env.example</code> to <code>.env</code>, add your key from{' '}
          <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer">
            console.groq.com/keys
          </a>
          , then restart the server.
        </p>
      )}
    </section>
  );
}

/** Non-blocking error, shown when a refinement fails but the set is still on screen. */
export function ErrorBanner({ error, onRetry, onDismiss }) {
  return (
    <div className="banner banner--error" role="alert">
      <div className="banner__body">
        <strong>{titleForError(error.code)}</strong>
        <span>{error.message}</span>
      </div>
      <div className="banner__actions">
        {error.retryable !== false && onRetry && (
          <button type="button" className="btn btn--small" onClick={onRetry}>
            Retry
          </button>
        )}
        <button type="button" className="btn btn--small btn--ghost" onClick={onDismiss} aria-label="Dismiss">
          Dismiss
        </button>
      </div>
    </div>
  );
}

/**
 * Decorative card stack for the hero. Inline SVG rather than an image so it
 * inherits the current accent and theme colours and costs no extra request.
 */
export function HeroArt() {
  return (
    <svg className="hero-art" viewBox="0 0 132 116" role="presentation" focusable="false" aria-hidden="true">
      <g className="hero-art__back">
        <rect x="14" y="26" width="88" height="62" rx="8" transform="rotate(-9 58 57)" />
      </g>
      <g className="hero-art__mid">
        <rect x="22" y="24" width="88" height="62" rx="8" transform="rotate(-3.5 66 55)" />
      </g>
      <g className="hero-art__front">
        <rect x="30" y="22" width="88" height="62" rx="8" />
        <line x1="43" y1="42" x2="92" y2="42" />
        <line x1="43" y1="54" x2="105" y2="54" />
        <line x1="43" y1="66" x2="79" y2="66" />
      </g>
    </svg>
  );
}

const PERKS = [
  { icon: '🗂', title: 'Flip through cards', text: 'Swipe or drag, mark what you know, drill only what you flagged.' },
  { icon: '✎', title: 'Take the quiz', text: 'Multiple choice with instant feedback and an explanation each time.' },
  { icon: '↻', title: 'Re-test the misses', text: 'Wrong answers come back as their own round until they stick.' },
];

/** Shown before anything has been generated — says what you'll get, not what to do. */
export function EmptyState() {
  return (
    <ul className="perks">
      {PERKS.map(({ icon, title, text }) => (
        <li className="perk" key={title}>
          <span className="perk__icon" aria-hidden="true">
            {icon}
          </span>
          <span className="perk__title">{title}</span>
          <span className="perk__text">{text}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Tells the user when the model's output had to be patched up. Being upfront
 * about "3 cards were dropped" is better than silently showing 5 when 8 were
 * asked for — the user can then decide to regenerate.
 */
export function RepairNotice({ repairs, onRegenerate }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || !repairs?.length) return null;

  return (
    <div className="banner banner--warn">
      <div className="banner__body">
        <strong>The model's output needed cleaning up</strong>
        <ul className="banner__list">
          {repairs.map((repair, i) => (
            <li key={i}>{repair}</li>
          ))}
        </ul>
      </div>
      <div className="banner__actions">
        {onRegenerate && (
          <button type="button" className="btn btn--small" onClick={onRegenerate}>
            Regenerate
          </button>
        )}
        <button
          type="button"
          className="btn btn--small btn--ghost"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss notice"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

function titleForError(code) {
  return (
    {
      offline: 'Cannot reach the server',
      not_configured: 'API key missing',
      bad_key: 'API key rejected',
      rate_limited: 'Slow down a moment',
      timeout: 'The model timed out',
      no_content: 'Not enough to work with',
      unusable_output: 'The model returned something unusable',
      bad_payload: 'Unexpected response',
      too_long: 'Input too long',
      provider_down: 'The model provider is down',
      bad_request: 'Check your input',
    }[code] || 'Something went wrong'
  );
}

function useElapsedSeconds() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return seconds;
}
