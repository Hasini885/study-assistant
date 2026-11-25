import { useEffect, useRef, useState } from 'react';
import { ACCEPT_ATTRIBUTE, extractTextFromFile } from '../lib/extractText.js';

export const MAX_CHARS = 20_000;

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
 *
 * Notes can also come from a file (PDF, Word, text, Markdown) chosen with the
 * button or dropped on the field. Text is extracted in the browser and lands in
 * the textarea, so the user can see and trim exactly what will be sent.
 */
export function PromptForm({ onSubmit, busy, compact = false }) {
  const [input, setInput] = useState('');
  // { state: 'reading' | 'done' | 'error', name, chars?, message? }
  const [upload, setUpload] = useState(null);
  const [dragging, setDragging] = useState(false);
  const textareaRef = useRef(null);
  const fileRef = useRef(null);
  const readSeq = useRef(0);

  const trimmed = input.trim();
  const tooLong = input.length > MAX_CHARS;
  const reading = upload?.state === 'reading';
  const canSubmit = trimmed.length >= 3 && !tooLong && !busy && !reading;

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

  const readFile = async (file) => {
    if (!file) return;
    // A second file chosen while the first is still parsing wins.
    const seq = ++readSeq.current;
    setUpload({ state: 'reading', name: file.name });
    try {
      const { text } = await extractTextFromFile(file);
      if (seq !== readSeq.current) return;
      // Replace an empty field; otherwise add the file below what's there.
      setInput((current) => (current.trim() ? `${current.trimEnd()}\n\n${text}` : text));
      setUpload({ state: 'done', name: file.name, chars: text.length });
    } catch (error) {
      if (seq !== readSeq.current) return;
      setUpload({ state: 'error', name: file.name, message: error.message || `Couldn’t read ${file.name}.` });
    }
  };

  const onDrop = (event) => {
    event.preventDefault();
    setDragging(false);
    if (busy) return;
    readFile(event.dataTransfer?.files?.[0]);
  };

  return (
    <form className="prompt-form" onSubmit={submit}>
      <label className="prompt-form__label" htmlFor={compact ? 'notes-compact' : 'notes'}>
        Paste your notes, or name a topic
      </label>

      <div
        className={`prompt-form__field ${dragging ? 'is-dragging' : ''}`}
        onDragOver={(event) => {
          if (busy || !event.dataTransfer?.types?.includes('Files')) return;
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <textarea
          id={compact ? 'notes-compact' : 'notes'}
          ref={textareaRef}
          className="prompt-form__textarea"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
          rows={compact ? 3 : 7}
          placeholder="e.g. paste a lecture handout, drop a PDF here, or type “the Krebs cycle”…"
          aria-describedby={compact ? 'prompt-help-compact' : 'prompt-help'}
          disabled={busy}
        />
        <span className={`prompt-form__count ${tooLong ? 'is-over' : ''}`} aria-live="polite">
          {input.length.toLocaleString()} / {MAX_CHARS.toLocaleString()}
        </span>
      </div>

      <div className="prompt-form__upload">
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            readFile(event.target.files?.[0]);
            event.target.value = ''; // choosing the same file again should re-read it
          }}
        />
        <button
          type="button"
          className="btn btn--ghost btn--small"
          onClick={() => fileRef.current?.click()}
          disabled={busy || reading}
        >
          {reading ? 'Reading…' : 'Upload a file'}
        </button>
        <span className="prompt-form__upload-note" role="status">
          <UploadStatus upload={upload} />
        </span>
      </div>

      <p id={compact ? 'prompt-help-compact' : 'prompt-help'} className={`prompt-form__help ${tooLong ? 'is-over' : ''}`}>
        {tooLong ? (
          <>
            That’s {input.length.toLocaleString()} characters — the limit is {MAX_CHARS.toLocaleString()}. Trim it, or{' '}
            <button type="button" className="link-button" onClick={() => setInput(input.slice(0, MAX_CHARS))}>
              keep the first {MAX_CHARS.toLocaleString()}
            </button>
            .
          </>
        ) : (
          'PDF, Word, .txt or .md · Press ⌘/Ctrl + Enter to generate.'
        )}
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
                setUpload(null);
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

function UploadStatus({ upload }) {
  if (!upload) return null;
  if (upload.state === 'reading') return <>Reading {upload.name}…</>;
  if (upload.state === 'error') return <span className="is-error">{upload.message}</span>;
  return (
    <>
      Extracted {upload.chars.toLocaleString()} characters from <strong>{upload.name}</strong>
      {upload.chars > MAX_CHARS && <span className="is-error"> — over the {MAX_CHARS.toLocaleString()} limit</span>}
    </>
  );
}
