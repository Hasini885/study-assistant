import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchHealth } from './api/client.js';
import { useStudySet } from './hooks/useStudySet.js';
import { useSessions } from './hooks/useSessions.js';
import { useTheme } from './hooks/useTheme.js';

import { PromptForm } from './components/PromptForm.jsx';
import { StudySetView } from './components/StudySetView.jsx';
import { SessionList } from './components/SessionList.jsx';
import { EmptyState, ErrorBanner, ErrorState, LoadingState } from './components/States.jsx';
import { SimulationMenu, ThemeToggle } from './components/DevTools.jsx';

export default function App() {
  const { theme, cycleTheme } = useTheme();
  const { sessions, saveSession, deleteSession } = useSessions();
  const study = useStudySet();

  const [health, setHealth] = useState(null);
  const [simulate, setSimulate] = useState('');
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [saveState, setSaveState] = useState('idle');

  // Kept so "Regenerate" can re-run the original prompt after a refinement.
  const lastInputRef = useRef('');

  useEffect(() => {
    const controller = new AbortController();
    fetchHealth(controller.signal).then(setHealth);
    return () => controller.abort();
  }, []);

  // A new or changed set is unsaved again.
  useEffect(() => {
    setSaveState('idle');
  }, [study.studySet]);

  const busy = study.status === 'loading' || study.status === 'refining';

  const handleGenerate = useCallback(
    ({ input, cardCount, questionCount }) => {
      lastInputRef.current = input;
      setActiveSessionId(null);
      study.generate({ input, cardCount, questionCount, simulate: simulate || undefined });
    },
    [study, simulate]
  );

  const handleRefine = useCallback(
    (instruction) => {
      if (!study.studySet) return;
      study.refine({ studySet: study.studySet, instruction, simulate: simulate || undefined });
    },
    [study, simulate]
  );

  const handleRegenerate = useCallback(() => {
    if (!lastInputRef.current) return;
    study.generate({ input: lastInputRef.current, simulate: simulate || undefined });
  }, [study, simulate]);

  const handleSave = useCallback(() => {
    const id = saveSession(study.studySet, study.meta, activeSessionId);
    if (id) {
      setActiveSessionId(id);
      setSaveState('saved');
    }
  }, [saveSession, study.studySet, study.meta, activeSessionId]);

  const handleLoadSession = useCallback(
    (session) => {
      study.load(session.studySet, session.meta);
      setActiveSessionId(session.id);
      setSaveState('saved');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [study]
  );

  const handleReset = useCallback(() => {
    study.reset();
    setActiveSessionId(null);
    lastInputRef.current = '';
  }, [study]);

  // A fatal error with nothing on screen takes over the page; a failure that
  // happened while a set is already loaded is shown as a dismissible banner
  // instead, so the user never loses working material to a failed refinement.
  const fatalError = study.status === 'error' && study.error;

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__brand">
          <h1 className="app__title">Study Assistant</h1>
          <p className="app__tagline">Notes in, flashcards and a quiz out.</p>
        </div>
        <div className="app__header-actions">
          {study.studySet && (
            <button type="button" className="btn btn--small btn--ghost" onClick={handleReset}>
              New set
            </button>
          )}
          <ThemeToggle theme={theme} onCycle={cycleTheme} />
        </div>
      </header>

      {health && !health.configured && (
        <div className="banner banner--warn" role="alert">
          <div className="banner__body">
            <strong>No API key configured</strong>
            <span>
              Copy <code>.env.example</code> to <code>.env</code>, add <code>GROQ_API_KEY</code>, and restart the
              server.
            </span>
          </div>
        </div>
      )}

      <main className="app__main">
        {fatalError ? (
          <ErrorState error={study.error} onRetry={study.retry} onReset={handleReset} />
        ) : (
          <>
            <PromptForm onSubmit={handleGenerate} busy={busy} compact={Boolean(study.studySet)} />

            {study.error && study.studySet && (
              <ErrorBanner error={study.error} onRetry={study.retry} onDismiss={study.dismissError} />
            )}

            {study.status === 'loading' && <LoadingState onCancel={study.cancel} />}

            {study.studySet && (
              <StudySetView
                studySet={study.studySet}
                meta={study.meta}
                busy={study.status === 'refining'}
                onRefine={handleRefine}
                onRegenerate={lastInputRef.current ? handleRegenerate : null}
                onSave={handleSave}
                saveState={saveState}
              />
            )}

            {study.status === 'idle' && !study.studySet && <EmptyState />}

            {!study.studySet && (
              <SessionList
                sessions={sessions}
                onLoad={handleLoadSession}
                onDelete={deleteSession}
                activeId={activeSessionId}
              />
            )}
          </>
        )}
      </main>

      <footer className="app__footer">
        <SimulationMenu modes={health?.simulations} value={simulate} onChange={setSimulate} />
        {health?.model && <span className="app__model">model: {health.model}</span>}
      </footer>
    </div>
  );
}
