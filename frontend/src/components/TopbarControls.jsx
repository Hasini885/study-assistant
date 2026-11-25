/** The icon buttons on the right of the topbar: fullscreen and theme. */

export function FullscreenToggle({ isFullscreen, onToggle, supported }) {
  if (!supported) return null;

  return (
    <button
      type="button"
      className="btn btn--icon btn--ghost"
      onClick={onToggle}
      title={isFullscreen ? 'Exit fullscreen' : 'Go fullscreen'}
      aria-label={isFullscreen ? 'Exit fullscreen' : 'Go fullscreen'}
      aria-pressed={isFullscreen}
    >
      <span aria-hidden="true">{isFullscreen ? '⤡' : '⤢'}</span>
    </button>
  );
}

export function ThemeToggle({ theme, onCycle }) {
  const label = { system: 'System', light: 'Light', dark: 'Dark' }[theme];
  const icon = { system: '◐', light: '☀', dark: '☾' }[theme];

  return (
    <button
      type="button"
      className="btn btn--icon btn--ghost"
      onClick={onCycle}
      title={`Theme: ${label}`}
      aria-label={`Theme: ${label}. Click to change.`}
    >
      <span aria-hidden="true">{icon}</span>
    </button>
  );
}
