import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { checkBlankAnswer, correctAnswerText, quizType } from '@contract/quiz.js';
import { Confetti } from './Confetti.jsx';
import { SourceBadge } from './SourceBadge.jsx';
import { useAnimatedNumber } from '../hooks/useAnimatedNumber.js';

/**
 * The quiz: multiple choice, true/false and fill-in-the-blank, with immediate
 * feedback and a re-test loop.
 *
 * A reducer rather than a pile of useState calls: "answer a question" has to
 * update the current selection, the answer log and the score together, and
 * those must never get out of sync — especially across rounds, where a wrong
 * answer from round 1 must not linger once it is answered correctly in round 2.
 */

const TYPE_LABEL = { mcq: 'Multiple choice', truefalse: 'True or false', blank: 'Fill in the blank' };

/**
 * Models have a strong positional bias for the correct option (often A), so
 * multiple-choice options are shuffled every round — the user learns the
 * material, not the layout. True/False keeps its fixed order; a blank has no
 * options to shuffle.
 */
export function prepareQuestions(questions, random = Math.random) {
  return questions.map((question) => {
    if (quizType(question) !== 'mcq') return question;
    const indices = question.options.map((_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    return {
      ...question,
      options: indices.map((i) => question.options[i]),
      answerIndex: indices.indexOf(question.answerIndex),
    };
  });
}

export function initQuiz(questions) {
  return {
    round: 1,
    queue: prepareQuestions(questions),
    index: 0,
    answered: false,
    answers: {}, // questionId -> { chosen: optionIndex | typed text, correct }
    finished: false,
    streak: 0,
    bestStreak: 0,
  };
}

function record(state, question, chosen, correct) {
  const streak = correct ? state.streak + 1 : 0;
  return {
    ...state,
    answered: true,
    streak,
    bestStreak: Math.max(state.bestStreak, streak),
    answers: { ...state.answers, [question.id]: { chosen, correct } },
  };
}

export function quizReducer(state, action) {
  const question = state.queue[state.index];

  switch (action.type) {
    case 'select': {
      if (state.answered || !question || quizType(question) === 'blank') return state; // answers are final
      if (
        !Number.isInteger(action.optionIndex) ||
        action.optionIndex < 0 ||
        action.optionIndex >= question.options.length
      ) {
        return state;
      }
      return record(state, question, action.optionIndex, action.optionIndex === question.answerIndex);
    }

    case 'answerText': {
      if (state.answered || !question || quizType(question) !== 'blank') return state;
      const text = String(action.text ?? '').trim();
      if (!text) return state;
      return record(state, question, text, checkBlankAnswer(text, question));
    }

    case 'next': {
      if (!state.answered) return state; // must answer before advancing
      if (state.index >= state.queue.length - 1) return { ...state, finished: true, answered: false };
      return { ...state, index: state.index + 1, answered: false };
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
        answered: false,
        answers,
        finished: false,
        streak: 0,
        bestStreak: state.bestStreak, // a run survives across rounds
      };
    }

    case 'restart':
      return initQuiz(action.questions);

    default:
      return state;
  }
}

export function Quiz({ questions, onRoundComplete, onExplain }) {
  const [state, dispatch] = useReducer(quizReducer, questions, initQuiz);

  const question = state.queue[state.index];
  const kind = quizType(question);
  const result = question ? state.answers[question.id] : undefined;
  const answered = state.answered;

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

  // Number keys pick an option; Enter moves on. Typing in the blank's input is
  // left alone — the input handles its own Enter.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const tag = event.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable) return;
      if (state.finished || !question) return;

      if (/^[1-9]$/.test(event.key) && kind !== 'blank') {
        event.preventDefault();
        dispatch({ type: 'select', optionIndex: Number(event.key) - 1 });
      } else if ((event.key === 'Enter' || event.key === 'ArrowRight') && answered) {
        event.preventDefault();
        dispatch({ type: 'next' });
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [answered, question, kind, state.finished]);

  if (state.finished) {
    return (
      <QuizResults
        results={roundResults}
        round={state.round}
        correctCount={correctCount}
        wrongCount={wrongCount}
        bestStreak={state.bestStreak}
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
          <span className="quiz__type"> · {TYPE_LABEL[kind]}</span>
        </span>
        <span className="quiz__badges">
          {state.streak >= 2 && (
            <span className="pill pill--streak" key={state.streak}>
              <span aria-hidden="true">🔥</span> {state.streak} in a row
            </span>
          )}
          {state.round > 1 && <span className="pill pill--round">Re-test · round {state.round}</span>}
        </span>
      </div>

      <div className="progress">
        <div
          className="progress__bar"
          style={{ width: `${((state.index + (answered ? 1 : 0)) / state.queue.length) * 100}%` }}
        />
      </div>

      <h3 className="quiz__question">{question.question}</h3>

      {kind === 'blank' ? (
        <BlankAnswer
          key={question.id}
          answered={answered}
          result={result}
          onSubmit={(text) => dispatch({ type: 'answerText', text })}
          onNext={() => dispatch({ type: 'next' })}
        />
      ) : (
        // Keyed per question so the staggered entrance replays each time.
        <ul
          className={`options ${kind === 'truefalse' ? 'options--tf' : ''}`}
          role="radiogroup"
          aria-label="Answer options"
          key={question.id}
        >
          {question.options.map((option, i) => {
            const isCorrect = i === question.answerIndex;
            const isChosen = result?.chosen === i;
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
                  style={{ '--i': i }}
                >
                  <kbd className="option__key">{i + 1}</kbd>
                  <span className="option__text">{option}</span>
                  {revealed && <span className="option__mark">{isCorrect ? '✓' : '✕'}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {answered && result && (
        <div className={`feedback ${result.correct ? 'is-correct' : 'is-wrong'}`} role="status">
          <strong>{result.correct ? 'Correct' : 'Not quite'}</strong>
          {(!result.correct || kind === 'blank') && (
            <p>
              The answer is <em>{correctAnswerText(question)}</em>.
            </p>
          )}
          {question.explanation && <p className="feedback__explanation">{question.explanation}</p>}
          <SourceBadge item={question} />
          {!result.correct && onExplain && (
            <Explanation
              key={question.id}
              onExplain={(signal) =>
                onExplain(question.id, kind === 'blank' ? result.chosen : question.options[result.chosen], signal)
              }
            />
          )}
        </div>
      )}

      <div className="quiz__actions">
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => dispatch({ type: 'next' })}
          disabled={!answered}
        >
          {state.index >= state.queue.length - 1 ? 'See results' : 'Next question'}
        </button>
        {!answered && (
          <span className="quiz__hint">
            {kind === 'blank'
              ? 'Type your answer and press Enter.'
              : `Pick an answer — or press 1–${question.options.length}.`}
          </span>
        )}
      </div>
    </div>
  );
}

/** The typed answer for a fill-in-the-blank question. */
function BlankAnswer({ answered, result, onSubmit, onNext }) {
  const [text, setText] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (!answered) inputRef.current?.focus();
  }, [answered]);

  const submit = (event) => {
    event.preventDefault();
    if (answered) return;
    onSubmit(text);
  };

  return (
    <form className="blank" onSubmit={submit}>
      <input
        ref={inputRef}
        className={`blank__input ${answered ? (result?.correct ? 'is-correct' : 'is-wrong') : ''}`}
        value={answered ? (result?.chosen ?? text) : text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          // Once answered, Enter moves on like everywhere else in the quiz.
          if (answered && event.key === 'Enter') {
            event.preventDefault();
            onNext();
          }
        }}
        readOnly={answered}
        placeholder="Your answer"
        aria-label="Your answer"
        autoComplete="off"
        spellCheck={false}
      />
      {!answered && (
        <button type="submit" className="btn" disabled={!text.trim()}>
          Check
        </button>
      )}
    </form>
  );
}

/**
 * "Explain this" after a wrong answer: asks the server for a short
 * explanation grounded in the set. Kept per question (keyed by the parent),
 * so moving on discards it.
 */
function Explanation({ onExplain }) {
  const [state, setState] = useState({ status: 'idle' });
  const controllerRef = useRef(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const ask = async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ status: 'loading' });
    try {
      const explanation = await onExplain(controller.signal);
      setState({ status: 'done', explanation });
    } catch (error) {
      if (error.name === 'AbortError') return;
      setState({ status: 'error', message: error.message || 'Could not get an explanation.' });
    }
  };

  if (state.status === 'done') {
    return (
      <div className="explain" aria-live="polite">
        <span className="explain__label">Why</span>
        <p className="explain__text">{state.explanation}</p>
      </div>
    );
  }

  return (
    <div className="explain explain--action" aria-live="polite">
      <button type="button" className="btn btn--small" onClick={ask} disabled={state.status === 'loading'}>
        {state.status === 'loading' ? 'Thinking…' : state.status === 'error' ? 'Try explaining again' : 'Explain this'}
      </button>
      {state.status === 'error' && <span className="explain__error">{state.message}</span>}
    </div>
  );
}

function QuizResults({ results, round, correctCount, wrongCount, bestStreak, onRetestWrong, onRestart }) {
  const total = results.length;
  const percent = total ? Math.round((correctCount / total) * 100) : 0;
  const perfect = total > 0 && wrongCount === 0;

  // The ring sweeps up to the score instead of snapping to it.
  const shownPercent = useAnimatedNumber(percent);

  return (
    <div className="results">
      <Confetti trigger={perfect} />

      <div className="results__score">
        <div
          className="results__ring"
          style={{ '--pct': shownPercent }}
          role="img"
          aria-label={`${percent} percent correct`}
        >
          <span>{Math.round(shownPercent)}%</span>
        </div>
        <div>
          <h3 className="results__title">
            {correctCount} of {total} correct
          </h3>
          <p className="results__note">
            {perfect
              ? round > 1
                ? 'Cleared the re-test. Nicely done.'
                : 'Perfect score — nothing to re-test.'
              : `Re-test the ${wrongCount} you missed to lock ${wrongCount === 1 ? 'it' : 'them'} in.`}
          </p>
          {bestStreak >= 3 && (
            <p className="results__streak">
              <span aria-hidden="true">🔥</span> Best run: {bestStreak} in a row
            </p>
          )}
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
        {results.map(({ question, result }, n) => {
          const blank = quizType(question) === 'blank';
          return (
            <li
              key={question.id}
              className={`review-item ${result?.correct ? 'is-correct' : 'is-wrong'}`}
              style={{ '--i': n }}
            >
              <p className="review-item__question">{question.question}</p>
              {result && !result.correct && (
                <p className="review-item__line">
                  {blank ? 'You wrote' : 'You chose'}{' '}
                  <span className="is-wrong-text">{blank ? result.chosen : question.options[result.chosen]}</span>
                </p>
              )}
              <p className="review-item__line">
                Answer: <span className="is-correct-text">{correctAnswerText(question)}</span>
              </p>
              {question.explanation && <p className="review-item__explanation">{question.explanation}</p>}
              <SourceBadge item={question} showQuote={false} />
            </li>
          );
        })}
      </ol>
    </div>
  );
}
