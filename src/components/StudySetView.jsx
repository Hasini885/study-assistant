import { useMemo, useState } from 'react';
import { Flashcards } from './Flashcards.jsx';
import { Quiz } from './Quiz.jsx';
import { RepairNotice } from './States.jsx';

const REFINE_EXAMPLES = ['Make the questions harder', 'Add 3 cards about definitions', 'Simplify the wording'];

/**
 * The generated set: flashcards, quiz, and the refinement loop.
 *
 * `resetKey` remounts the two study components whenever the underlying set
 * changes. Card-level progress belongs to a specific set of cards; carrying a
 * half-finished quiz across a regeneration would show scores for questions
 * that no longer exist.
 */
export function StudySetView({ studySet, meta, busy, onRefine, onRegenerate, onSave, saveState }) {
  const [tab, setTab] = useState(() => (studySet.flashcards.length ? 'cards' : 'quiz'));

  const resetKey = useMemo(
    () => studySet.flashcards[0]?.id ?? studySet.quiz[0]?.id ?? 'empty',
    [studySet]
  );

  const hasCards = studySet.flashcards.length > 0;
  const hasQuiz = studySet.quiz.length > 0;
  const activeTab = tab === 'cards' && !hasCards ? 'quiz' : tab === 'quiz' && !hasQuiz ? 'cards' : tab;

  return (
    <section className="study-set" aria-busy={busy}>
      <header className="study-set__header">
        <div>
          <h2 className="study-set__title">{studySet.title}</h2>
          {studySet.summary && <p className="study-set__summary">{studySet.summary}</p>}
        </div>
        <button type="button" className="btn btn--small" onClick={onSave} disabled={saveState === 'saved'}>
          {saveState === 'saved' ? 'Saved ✓' : 'Save session'}
        </button>
      </header>

      <RepairNotice repairs={meta?.repairs} onRegenerate={onRegenerate} />

      <div className="tabs" role="tablist" aria-label="Study modes">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'cards'}
          className={`tab ${activeTab === 'cards' ? 'is-active' : ''}`}
          onClick={() => setTab('cards')}
          disabled={!hasCards}
        >
          Flashcards <span className="tab__count">{studySet.flashcards.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'quiz'}
          className={`tab ${activeTab === 'quiz' ? 'is-active' : ''}`}
          onClick={() => setTab('quiz')}
          disabled={!hasQuiz}
        >
          Quiz <span className="tab__count">{studySet.quiz.length}</span>
        </button>
      </div>

      {/* The set stays interactive during a refinement; it just dims. */}
      <div className={`study-set__body ${busy ? 'is-busy' : ''}`}>
        {busy && (
          <div className="study-set__overlay" role="status">
            <span className="spinner" aria-hidden="true" /> Updating…
          </div>
        )}

        {activeTab === 'cards' && hasCards && <Flashcards key={`cards-${resetKey}`} cards={studySet.flashcards} />}
        {activeTab === 'quiz' && hasQuiz && <Quiz key={`quiz-${resetKey}`} questions={studySet.quiz} />}
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
      <label className="refine__label" htmlFor="refine-input">
        Refine this set
      </label>
      <div className="refine__row">
        <input
          id="refine-input"
          className="refine__input"
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder="e.g. add 3 harder questions about the Calvin cycle"
          disabled={busy}
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
