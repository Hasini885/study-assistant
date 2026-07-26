import { useEffect, useRef, useState } from 'react';

const MAX_CHARS = 20_000;

const EXAMPLES = [
  'The causes of World War I',
  'React hooks: useState, useEffect, useMemo and when each re-runs',
  'Photosynthesis — light-dependent reactions and the Calvin cycle',
  'Big-O notation for common sorting algorithms',
];

/**
 * The free-form input. Deliberately not a chat box: it takes one block of
 * notes or a topic and produces a study set, and the field is cleared of
 * conversational affordances so nobody expects a reply.
 */
export function PromptForm({ onSubmit, busy, compact = false }) {
  const [input, setInput] = useState('');
  const textareaRef = useRef(null);

  const trimmed = input.trim();
  const tooLong = input.length > MAX_CHARS;
  const canSubmit = trimmed.length >= 3 && !tooLong && !busy;

  useEffect(() => {
    if (!compact) textareaRef.current?.focus();
  }, [compact]);

  const submit = (event) => {
    event?.preventDefault();
    if (!canSubmit) return;
    onSubmit({ input: trimmed });
  };

  const onKeyDown = (event) => {
    // Enter alone inserts a newline — these are notes, not chat messages.
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit(event);
  };

  return (
    <form className="prompt-form" onSubmit={submit}>
      <label className="prompt-form__label" htmlFor="notes">
        Paste your notes, or name a topic
      </label>

      <div className="prompt-form__field">
        <textarea
          id="notes"
          ref={textareaRef}
          className="prompt-form__textarea"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
          rows={compact ? 3 : 7}
          placeholder="e.g. paste a lecture handout, or type “the Krebs cycle”…"
          aria-describedby="prompt-help"
          disabled={busy}
        />
        <span className={`prompt-form__count ${tooLong ? 'is-over' : ''}`} aria-live="polite">
          {input.length.toLocaleString()} / {MAX_CHARS.toLocaleString()}
        </span>
      </div>

      <p id="prompt-help" className="prompt-form__help">
        {tooLong ? 'That is too long — try one section at a time.' : 'Press ⌘/Ctrl + Enter to generate.'}
      </p>

      {!compact && (
        <div className="chips" role="group" aria-label="Example topics">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              className="chip"
              onClick={() => {
                setInput(example);
                textareaRef.current?.focus();
              }}
              disabled={busy}
            >
              {example}
            </button>
          ))}
        </div>
      )}

      <div className="prompt-form__actions">
        <button type="submit" className="btn btn--primary" disabled={!canSubmit}>
          {busy ? 'Generating…' : 'Generate study set'}
        </button>
      </div>
    </form>
  );
}
