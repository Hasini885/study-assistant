/**
 * Failure-injection picker (development only — the server refuses simulations
 * when NODE_ENV=production, and hides the menu from /api/health).
 *
 * Bad model output is the thing this app is really built around, and you
 * cannot demo it by hoping the model misbehaves on cue. Picking a mode here
 * makes the next request return that specific kind of broken response.
 */
export function SimulationMenu({ modes, value, onChange }) {
  if (!modes) return null;

  return (
    <div className="devtools">
      <label htmlFor="simulate">Test failure handling</label>
      <select id="simulate" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Off — call the real model</option>
        {Object.entries(modes).map(([mode, label]) => (
          <option key={mode} value={mode}>
            {label}
          </option>
        ))}
      </select>
      {value && <span className="devtools__active">Next request will be sabotaged</span>}
    </div>
  );
}

export function ThemeToggle({ theme, onCycle }) {
  const label = { system: 'System', light: 'Light', dark: 'Dark' }[theme];
  const icon = { system: '◐', light: '☀', dark: '☾' }[theme];

  return (
    <button type="button" className="btn btn--icon btn--ghost" onClick={onCycle} title={`Theme: ${label}`} aria-label={`Theme: ${label}. Click to change.`}>
      <span aria-hidden="true">{icon}</span>
    </button>
  );
}
