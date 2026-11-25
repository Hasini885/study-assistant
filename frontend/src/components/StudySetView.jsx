import { useCallback, useEffect, useMemo, useState } from 'react';
import { Flashcards } from './Flashcards.jsx';
import { CardGrid } from './CardGrid.jsx';
import { Quiz } from './Quiz.jsx';
import { RepairNotice } from './States.jsx';
import { hashString } from '@contract/ids.js';

const REFINE_EXAMPLES = ['Make the questions harder', 'Add 3 cards about definitions', 'Simplify the wording'];

/**
 * The workspace: three ways to work through a set, plus the refinement loop.
 *
 * The deck and the quiz each remount when their own items change (see
 * cardsKey / quizKey): carrying a half-finished quiz across an edit would show
 * scores for questions that no longer exist.
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

  // Ids are stable across a refinement now, so "the first id changed" no longer
  // means "different content". Each view remounts only when *its* items change:
  // a refine that only touched the quiz leaves the deck where you were, and
  // vice versa. Progress lives above this component and is keyed by id, so it
  // survives either way.
  const cardsKey = useMemo(
    () => hashString(studySet.flashcards.map((c) => `${c.id}\u0000${c.front}\u0000${c.back}`).join('\u0001')),
    [studySet.flashcards]
  );
  const quizKey = useMemo(
    () =>
      hashString(
        studySet.quiz
          .map((q) => [q.id, q.question, ...q.options, q.answerIndex, q.explanation].join('\u0000'))
          .join('\u0001')
      ),
    [studySet.quiz]
  );

  // Changed cards start at the first card.
  useEffect(() => {
    setDeckIndex(0);
  }, [cardsKey]);

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
            key={`cards-${cardsKey}`}
            cards={studySet.flashcards}
            statuses={progress.statuses}
            onMark={progress.setStatus}
            index={deckIndex}
            onIndex={setDeckIndex}
          />
        )}

        {activeTab === 'browse' && hasCards && (
          <CardGrid
            key={`browse-${cardsKey}`}
            cards={studySet.flashcards}
            statuses={progress.statuses}
            onMark={progress.setStatus}
            onStudyCard={studyCard}
          />
        )}

        {activeTab === 'quiz' && hasQuiz && (
          <Quiz key={`quiz-${quizKey}`} questions={studySet.quiz} onRoundComplete={onQuizRound} />
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
