import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { fetchHealth } from './api/client.js';
import { hueFromString } from './lib/hue.js';
import { useStudySet } from './hooks/useStudySet.js';
import { useSessions } from './hooks/useSessions.js';
import { useStudyProgress } from './hooks/useStudyProgress.js';
import { useFullscreen } from './hooks/useFullscreen.js';
import { useTheme } from './hooks/useTheme.js';

import { Landing } from './components/Landing.jsx';
import { PromptForm } from './components/PromptForm.jsx';
import { StudySetView } from './components/StudySetView.jsx';
import { ProgressPanel } from './components/ProgressPanel.jsx';
import { SessionList } from './components/SessionList.jsx';
import { EmptyState, ErrorBanner, ErrorState, HeroArt, LoadingState } from './components/States.jsx';
import { FullscreenToggle, ThemeToggle } from './components/DevTools.jsx';

const NO_CARDS = []; // stable identity so progress memos don't churn

export default function App() {
  const { theme, cycleTheme } = useTheme();
  const fullscreen = useFullscreen();
  const { sessions, saveSession, deleteSession } = useSessions();
  const study = useStudySet();

  const cards = useMemo(() => study.studySet?.flashcards ?? NO_CARDS, [study.studySet]);
  const progress = useStudyProgress(cards);

  const [health, setHealth] = useState(null);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [saveState, setSaveState] = useState('idle');
  const [quizStats, setQuizStats] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [entered, setEntered] = useState(false);

  // Kept so "Regenerate" can re-run the original prompt after a refinement.
  const lastInputRef = useRef('');

  useEffect(() => {
    const controller = new AbortController();
    fetchHealth(controller.signal).then(setHealth);
    return () => controller.abort();
  }, []);

  // A new or changed set is unsaved again, and its quiz history no longer applies.
  useEffect(() => {
    setSaveState('idle');
    setQuizStats(null);
  }, [study.studySet]);

  // Close the mobile drawer on Escape.
  useEffect(() => {
    if (!sidebarOpen) return undefined;
    const onKey = (event) => event.key === 'Escape' && setSidebarOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sidebarOpen]);

  const busy = study.status === 'loading' || study.status === 'refining';
  const hasSet = Boolean(study.studySet);

  // Each set carries its own accent, derived from its title. Set on the root so
  // the whole app — rings, tabs, highlights — takes on the set's identity.
  const hue = hasSet ? hueFromString(study.studySet.title) : null;

  const handleGenerate = useCallback(
    ({ input }) => {
      lastInputRef.current = input;
      setActiveSessionId(null);
      setSidebarOpen(false);
      study.generate({ input });
    },
    [study]
  );

  const handleRefine = useCallback(
    (instruction) => {
      if (!study.studySet) return;
      study.refine({ studySet: study.studySet, instruction });
    },
    [study]
  );

  const handleRegenerate = useCallback(() => {
    if (!lastInputRef.current) return;
    study.generate({ input: lastInputRef.current });
  }, [study]);

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
      setSidebarOpen(false);
    },
    [study]
  );

  const handleReset = useCallback(() => {
    study.reset();
    setActiveSessionId(null);
    lastInputRef.current = '';
  }, [study]);

  // A fatal error with nothing on screen takes over the workspace; a failure
  // that happened while a set is loaded is a dismissible banner instead, so the
  // user never loses working material to a failed refinement.
  const fatalError = study.status === 'error' && study.error;

  // The landing page owns the whole viewport, so it replaces the shell rather
  // than rendering inside it. Every hook above still runs, so state (and any
  // in-flight request) survives if we ever come back to it.
  if (!entered) {
    return (
      <Landing
        onEnter={() => setEntered(true)}
        recentSession={sessions[0]}
        onResume={(session) => {
          handleLoadSession(session);
          setEntered(true);
        }}
      />
    );
  }

  return (
    <div className="app" style={hue === null ? undefined : { '--hue': hue }}>
      <header className="topbar">
        <button
          type="button"
          className="topbar__menu btn btn--icon btn--ghost"
          onClick={() => setSidebarOpen((v) => !v)}
          aria-label={sidebarOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={sidebarOpen}
        >
          <span aria-hidden="true">☰</span>
        </button>

        <div className="topbar__brand">
          <span className="topbar__mark" aria-hidden="true">
            ◈
          </span>
          <div>
            <h1 className="topbar__title">Study Assistant</h1>
            <p className="topbar__tagline">Notes in, flashcards and a quiz out.</p>
          </div>
        </div>

        <div className="topbar__actions">
          {hasSet && (
            <button type="button" className="btn btn--small btn--ghost" onClick={handleReset}>
              New set
            </button>
          )}
          <FullscreenToggle
            isFullscreen={fullscreen.isFullscreen}
            onToggle={fullscreen.toggle}
            supported={fullscreen.supported}
          />
          <ThemeToggle theme={theme} onCycle={cycleTheme} />
        </div>
      </header>

      <div className="app__body">
        {sidebarOpen && <div className="scrim" onClick={() => setSidebarOpen(false)} aria-hidden="true" />}

        <aside className={`sidebar ${sidebarOpen ? 'is-open' : ''}`} aria-label="Study controls">
          {hasSet && (
            <section className="panel">
              <h2 className="panel__title">New study set</h2>
              <PromptForm onSubmit={handleGenerate} busy={busy} compact />
            </section>
          )}

          {hasSet && (
            <ProgressPanel counts={progress.counts} quizStats={quizStats} onResetProgress={progress.reset} />
          )}

          <SessionList
            sessions={sessions}
            onLoad={handleLoadSession}
            onDelete={deleteSession}
            activeId={activeSessionId}
          />

          {health?.model && (
            <div className="sidebar__footer">
              <span className="sidebar__model">model: {health.model}</span>
            </div>
          )}
        </aside>

        <main className="main">
          {health && !health.configured && (
            <div className="banner banner--warn" role="alert">
              <div className="banner__body">
                <strong>No API key configured</strong>
                <span>
                  Copy <code>.env.example</code> to <code>.env</code>, add <code>GROQ_API_KEY</code>, and restart
                  the server.
                </span>
              </div>
            </div>
          )}

          {fatalError ? (
            <ErrorState error={study.error} onRetry={study.retry} onReset={handleReset} />
          ) : (
            <>
              {study.error && hasSet && (
                <ErrorBanner error={study.error} onRetry={study.retry} onDismiss={study.dismissError} />
              )}

              {!hasSet && study.status !== 'loading' && (
                <section className="hero">
                  <div className="hero__intro">
                    <div>
                      <h2 className="hero__title">What are you studying?</h2>
                      <p className="hero__lede">
                        Paste a page of notes or name a topic. You'll get flashcards to flip through and a quiz
                        that re-tests whatever you get wrong.
                      </p>
                    </div>
                    <HeroArt />
                  </div>
                  <PromptForm onSubmit={handleGenerate} busy={busy} />
                  <EmptyState />
                </section>
              )}

              {study.status === 'loading' && <LoadingState onCancel={study.cancel} />}

              {hasSet && (
                <StudySetView
                  studySet={study.studySet}
                  meta={study.meta}
                  busy={study.status === 'refining'}
                  onRefine={handleRefine}
                  onRegenerate={lastInputRef.current ? handleRegenerate : null}
                  onSave={handleSave}
                  saveState={saveState}
                  progress={progress}
                  onQuizRound={setQuizStats}
                />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
