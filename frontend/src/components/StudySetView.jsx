import { useCallback, useEffect, useMemo, useState } from 'react';
import { Flashcards } from './Flashcards.jsx';
import { CardGrid } from './CardGrid.jsx';
import { Quiz } from './Quiz.jsx';
import { RepairNotice } from './States.jsx';

const REFINE_EXAMPLES = ['Make the questions harder', 'Add 3 cards about definitions', 'Simplify the wording'];

/**
 * The workspace: three ways to work through a set, plus the refinement loop.
 *
 * `resetKey` remounts the study components whenever the underlying set
 * changes. Card-level progress belongs to a specific set of cards; carrying a
 * half-finished quiz across a regeneration would show scores for questions
 * that no longer exist.
 */
export function StudySetView({
  studySet,
  meta,
  busy,
  onRefine,
  onRegenerate,
  onSave,
  saveState,
  progress,
  onQuizRound,
}) {
  const hasCards = studySet.flashcards.length > 0;
  const hasQuiz = studySet.quiz.length > 0;

  const [tab, setTab] = useState(() => (hasCards ? 'cards' : 'quiz'));
  const [deckIndex, setDeckIndex] = useState(0);

  const resetKey = useMemo(() => studySet.flashcards[0]?.id ?? studySet.quiz[0]?.id ?? 'empty', [studySet]);

  // A new set starts at the first card.
  useEffect(() => {
    setDeckIndex(0);
  }, [resetKey]);

  const studyCard = useCallback((index) => {
    setDeckIndex(index);
    setTab('cards');
  }, []);

  const tabs = [
    { id: 'cards', label: 'Flashcards', count: studySet.flashcards.length, enabled: hasCards },
    { id: 'browse', label: 'Browse', count: studySet.flashcards.length, enabled: hasCards },
    { id: 'quiz', label: 'Quiz', count: studySet.quiz.length, enabled: hasQuiz },
  ];

  const activeTab = tabs.find((t) => t.id === tab)?.enabled ? tab : tabs.find((t) => t.enabled)?.id;

  return (
    <section className="workspace" aria-busy={busy}>
      <header className="workspace__header">
        <div className="workspace__heading">
          <h2 className="workspace__title">{studySet.title}</h2>
          {studySet.summary && <p className="workspace__summary">{studySet.summary}</p>}
        </div>
        <button type="button" className="btn btn--small" onClick={onSave} disabled={saveState === 'saved'}>
          {saveState === 'saved' ? 'Saved ✓' : 'Save session'}
        </button>
      </header>

      <RepairNotice repairs={meta?.repairs} onRegenerate={onRegenerate} />

      <div className="tabs" role="tablist" aria-label="Study modes">
        {tabs.map(({ id, label, count, enabled }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            className={`tab ${activeTab === id ? 'is-active' : ''}`}
            onClick={() => setTab(id)}
            disabled={!enabled}
          >
            {label} <span className="tab__count">{count}</span>
          </button>
        ))}
      </div>

      {/* The set stays visible during a refinement; it just dims. */}
      <div className={`workspace__body ${busy ? 'is-busy' : ''}`}>
        {busy && (
          <div className="workspace__overlay" role="status">
            <span className="spinner" aria-hidden="true" /> Updating…
          </div>
        )}

        {activeTab === 'cards' && hasCards && (
          <Flashcards
            key={`cards-${resetKey}`}
            cards={studySet.flashcards}
            statuses={progress.statuses}
            onMark={progress.setStatus}
            index={deckIndex}
            onIndex={setDeckIndex}
          />
        )}

        {activeTab === 'browse' && hasCards && (
          <CardGrid
            key={`browse-${resetKey}`}
            cards={studySet.flashcards}
            statuses={progress.statuses}
            onMark={progress.setStatus}
            onStudyCard={studyCard}
          />
        )}

        {activeTab === 'quiz' && hasQuiz && (
          <Quiz key={`quiz-${resetKey}`} questions={studySet.quiz} onRoundComplete={onQuizRound} />
        )}
      </div>

      <RefineBar onRefine={onRefine} busy={busy} />
    </section>
  );
}

/**
 * Follow-up prompts that edit the existing set instead of regenerating it. The
 * current set is sent back to the model, so untouched items come back
 * unchanged.
 */
function RefineBar({ onRefine, busy }) {
  const [instruction, setInstruction] = useState('');

  const submit = (event) => {
    event.preventDefault();
    const trimmed = instruction.trim();
    if (trimmed.length < 3 || busy) return;
    onRefine(trimmed);
    setInstruction('');
  };

  return (
    <form className="refine" onSubmit={submit}>
      <div className="refine__row">
        <input
          id="refine-input"
          className="refine__input"
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder="Refine this set — e.g. add 3 harder questions about the Calvin cycle"
          disabled={busy}
          aria-label="Refine this set"
        />
        <button type="submit" className="btn btn--primary" disabled={busy || instruction.trim().length < 3}>
          {busy ? 'Updating…' : 'Apply'}
        </button>
      </div>
      <div className="chips chips--small">
        {REFINE_EXAMPLES.map((example) => (
          <button key={example} type="button" className="chip" onClick={() => setInstruction(example)} disabled={busy}>
            {example}
          </button>
        ))}
      </div>
    </form>
  );
}
