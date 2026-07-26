import { useEffect, useMemo, useReducer } from 'react';

/**
 * Multiple-choice quiz with immediate feedback and a re-test loop.
 *
 * A reducer rather than a pile of useState calls: "select an answer" has to
 * update the current selection, the answer log and the score together, and
 * those must never get out of sync — especially across rounds, where a wrong
 * answer from round 1 must not linger once it is answered correctly in round 2.
 */

function prepareQuestions(questions) {
  return questions.map((question) => {
    // Models have a strong positional bias for the correct option (often A).
    // Shuffling per round means the user learns the material, not the layout.
    const indices = question.options.map((_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    return {
      ...question,
      options: indices.map((i) => question.options[i]),
      answerIndex: indices.indexOf(question.answerIndex),
    };
  });
}

function init(questions) {
  return {
    round: 1,
    queue: prepareQuestions(questions),
    index: 0,
    selected: null,
    answers: {}, // questionId -> { chosen, correct }
    finished: false,
  };
}

function reducer(state, action) {
  switch (action.type) {
    case 'select': {
      if (state.selected !== null) return state; // answers are final
      const question = state.queue[state.index];
      if (!question || action.optionIndex >= question.options.length) return state;

      return {
        ...state,
        selected: action.optionIndex,
        answers: {
          ...state.answers,
          [question.id]: { chosen: action.optionIndex, correct: action.optionIndex === question.answerIndex },
        },
      };
    }

    case 'next': {
      if (state.selected === null) return state; // must answer before advancing
      if (state.index >= state.queue.length - 1) return { ...state, finished: true, selected: null };
      return { ...state, index: state.index + 1, selected: null };
    }

    case 'retestWrong': {
      const wrong = state.queue.filter((q) => state.answers[q.id] && !state.answers[q.id].correct);
      if (wrong.length === 0) return state;

      // Clear only the retested questions from the log; questions already
      // answered correctly keep their result.
      const answers = { ...state.answers };
      for (const q of wrong) delete answers[q.id];

      return {
        round: state.round + 1,
        queue: prepareQuestions(wrong),
        index: 0,
        selected: null,
        answers,
        finished: false,
      };
    }

    case 'restart':
      return init(action.questions);

    default:
      return state;
  }
}

export function Quiz({ questions, onRoundComplete }) {
  const [state, dispatch] = useReducer(reducer, questions, init);

  const question = state.queue[state.index];
  const answered = state.selected !== null;

  const roundResults = useMemo(
    () => state.queue.map((q) => ({ question: q, result: state.answers[q.id] })),
    [state.queue, state.answers]
  );
  const correctCount = roundResults.filter((r) => r.result?.correct).length;
  const wrongCount = roundResults.filter((r) => r.result && !r.result.correct).length;

  // Publish the round's score so the sidebar can show it. Reporting the latest
  // result (rather than accumulating) keeps this idempotent, so StrictMode's
  // double-invoked effects in development can't double-count anything.
  useEffect(() => {
    if (!state.finished) return;
    onRoundComplete?.({ round: state.round, correct: correctCount, total: state.queue.length });
  }, [state.finished, state.round, state.queue.length, correctCount, onRoundComplete]);

  // Number keys pick an option; Enter moves on.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const tag = event.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable) return;
      if (state.finished || !question) return;

      if (/^[1-9]$/.test(event.key)) {
        event.preventDefault();
        dispatch({ type: 'select', optionIndex: Number(event.key) - 1 });
      } else if ((event.key === 'Enter' || event.key === 'ArrowRight') && answered) {
        event.preventDefault();
        dispatch({ type: 'next' });
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [answered, question, state.finished]);

  if (state.finished) {
    return (
      <QuizResults
        results={roundResults}
        round={state.round}
        correctCount={correctCount}
        wrongCount={wrongCount}
        onRetestWrong={() => dispatch({ type: 'retestWrong' })}
        onRestart={() => dispatch({ type: 'restart', questions })}
      />
    );
  }

  if (!question) return null;

  return (
    <div className="quiz">
      <div className="quiz__meta">
        <span>
          Question {state.index + 1} of {state.queue.length}
        </span>
        {state.round > 1 && <span className="pill pill--round">Re-test · round {state.round}</span>}
      </div>

      <div className="progress">
        <div className="progress__bar" style={{ width: `${((state.index + (answered ? 1 : 0)) / state.queue.length) * 100}%` }} />
      </div>

      <h3 className="quiz__question">{question.question}</h3>

      <ul className="options" role="radiogroup" aria-label="Answer options">
        {question.options.map((option, i) => {
          const isCorrect = i === question.answerIndex;
          const isChosen = state.selected === i;
          const revealed = answered && (isCorrect || isChosen);

          return (
            <li key={`${question.id}-${i}`}>
              <button
                type="button"
                role="radio"
                aria-checked={isChosen}
                className={`option ${revealed ? (isCorrect ? 'is-correct' : 'is-wrong') : ''} ${isChosen ? 'is-chosen' : ''}`}
                onClick={() => dispatch({ type: 'select', optionIndex: i })}
                disabled={answered}
              >
                <kbd className="option__key">{i + 1}</kbd>
                <span className="option__text">{option}</span>
                {revealed && <span className="option__mark">{isCorrect ? '✓' : '✕'}</span>}
              </button>
            </li>
          );
        })}
      </ul>

      {answered && (
        <div className={`feedback ${state.selected === question.answerIndex ? 'is-correct' : 'is-wrong'}`} role="status">
          <strong>{state.selected === question.answerIndex ? 'Correct' : 'Not quite'}</strong>
          {state.selected !== question.answerIndex && (
            <p>
              The answer is <em>{question.options[question.answerIndex]}</em>.
            </p>
          )}
          {question.explanation && <p className="feedback__explanation">{question.explanation}</p>}
        </div>
      )}

      <div className="quiz__actions">
        <button type="button" className="btn btn--primary" onClick={() => dispatch({ type: 'next' })} disabled={!answered}>
          {state.index >= state.queue.length - 1 ? 'See results' : 'Next question'}
        </button>
        {!answered && <span className="quiz__hint">Pick an answer — or press 1–{question.options.length}.</span>}
      </div>
    </div>
  );
}

function QuizResults({ results, round, correctCount, wrongCount, onRetestWrong, onRestart }) {
  const total = results.length;
  const percent = total ? Math.round((correctCount / total) * 100) : 0;

  return (
    <div className="results">
      <div className="results__score">
        <div className="results__ring" style={{ '--pct': percent }} role="img" aria-label={`${percent} percent correct`}>
          <span>{percent}%</span>
        </div>
        <div>
          <h3 className="results__title">
            {correctCount} of {total} correct
          </h3>
          <p className="results__note">
            {wrongCount === 0
              ? round > 1
                ? 'Cleared the re-test. Nicely done.'
                : 'Perfect score — nothing to re-test.'
              : `Re-test the ${wrongCount} you missed to lock ${wrongCount === 1 ? 'it' : 'them'} in.`}
          </p>
        </div>
      </div>

      <div className="results__actions">
        {wrongCount > 0 && (
          <button type="button" className="btn btn--primary" onClick={onRetestWrong}>
            Re-test {wrongCount} wrong answer{wrongCount === 1 ? '' : 's'}
          </button>
        )}
        <button type="button" className="btn btn--ghost" onClick={onRestart}>
          Restart whole quiz
        </button>
      </div>

      <ol className="review-list">
        {results.map(({ question, result }) => (
          <li key={question.id} className={`review-item ${result?.correct ? 'is-correct' : 'is-wrong'}`}>
            <p className="review-item__question">{question.question}</p>
            {result && !result.correct && (
              <p className="review-item__line">
                You chose <span className="is-wrong-text">{question.options[result.chosen]}</span>
              </p>
            )}
            <p className="review-item__line">
              Answer: <span className="is-correct-text">{question.options[question.answerIndex]}</span>
            </p>
            {question.explanation && <p className="review-item__explanation">{question.explanation}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}
