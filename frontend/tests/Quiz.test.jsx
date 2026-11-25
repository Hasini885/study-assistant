import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Quiz, initQuiz, prepareQuestions, quizReducer } from '../src/components/Quiz.jsx';

const mcq = {
  id: 'q-mcq',
  type: 'mcq',
  question: 'Where is the Calvin cycle?',
  options: ['Stroma', 'Thylakoid', 'Cytosol', 'Nucleus'],
  answerIndex: 0,
  explanation: '',
};
const tf = {
  id: 'q-tf',
  type: 'truefalse',
  question: 'Leaves reflect green light.',
  options: ['True', 'False'],
  answerIndex: 0,
  explanation: '',
};
const blank = {
  id: 'q-blank',
  type: 'blank',
  question: 'ATP stands for adenosine _____.',
  answer: 'triphosphate',
  accepted: [],
  explanation: 'Three phosphates.',
};
const legacy = { id: 'q-old', question: 'Saved before types existed?', options: ['Yes', 'No'], answerIndex: 0 };

/** Answers each question in turn: 'right', 'wrong', or typed text for a blank. */
function answerAll(state, answers) {
  return answers.reduce((s, answer) => {
    const q = s.queue[s.index];
    const answered =
      q.type === 'blank'
        ? quizReducer(s, { type: 'answerText', text: answer })
        : quizReducer(s, {
            type: 'select',
            optionIndex: answer === 'right' ? q.answerIndex : (q.answerIndex + 1) % q.options.length,
          });
    return quizReducer(answered, { type: 'next' });
  }, state);
}

describe('prepareQuestions', () => {
  test('shuffles multiple choice but keeps the answer pointing at the same text', () => {
    const [shuffled] = prepareQuestions([mcq], () => 0);
    expect(shuffled.options).not.toEqual(mcq.options);
    expect(shuffled.options[shuffled.answerIndex]).toBe('Stroma');
  });

  test('never shuffles true/false or blanks', () => {
    const [a, b] = prepareQuestions([tf, blank], () => 0);
    expect(a).toBe(tf);
    expect(b).toBe(blank);
  });
});

describe('quizReducer', () => {
  test('scores each type and finishes the round', () => {
    const state = answerAll(initQuiz([tf, blank, legacy]), ['right', 'Triphosphate', 'wrong']);
    expect(state.finished).toBe(true);
    expect(state.answers['q-tf']).toEqual({ chosen: 0, correct: true });
    expect(state.answers['q-blank']).toEqual({ chosen: 'Triphosphate', correct: true });
    expect(state.answers['q-old'].correct).toBe(false);
  });

  test('answers are final, and you must answer before moving on', () => {
    let state = initQuiz([tf]);
    expect(quizReducer(state, { type: 'next' })).toBe(state);
    state = quizReducer(state, { type: 'select', optionIndex: 1 });
    expect(quizReducer(state, { type: 'select', optionIndex: 0 })).toBe(state);
  });

  test('ignores answers of the wrong kind and out-of-range options', () => {
    const state = initQuiz([blank]);
    expect(quizReducer(state, { type: 'select', optionIndex: 0 })).toBe(state);
    expect(quizReducer(state, { type: 'answerText', text: '   ' })).toBe(state);
    const tfState = initQuiz([tf]);
    expect(quizReducer(tfState, { type: 'select', optionIndex: 5 })).toBe(tfState);
    expect(quizReducer(tfState, { type: 'answerText', text: 'True' })).toBe(tfState);
  });

  test('re-testing replays only the wrong answers and keeps the right ones', () => {
    let state = answerAll(initQuiz([tf, blank, legacy]), ['wrong', 'Triphosphate', 'wrong']);
    state = quizReducer(state, { type: 'retestWrong' });

    expect(state.round).toBe(2);
    expect(state.queue.map((q) => q.id)).toEqual(['q-tf', 'q-old']);
    expect(state.answers).toEqual({ 'q-blank': { chosen: 'Triphosphate', correct: true } });

    state = answerAll(state, ['right', 'right']);
    expect(state.finished).toBe(true);
    expect(Object.values(state.answers).every((a) => a.correct)).toBe(true);
    expect(quizReducer(state, { type: 'retestWrong' })).toBe(state); // nothing left to retest
  });

  test('a question missed twice comes back for a third round', () => {
    let state = answerAll(initQuiz([tf, legacy]), ['wrong', 'right']);
    state = answerAll(quizReducer(state, { type: 'retestWrong' }), ['wrong']);
    state = quizReducer(state, { type: 'retestWrong' });
    expect(state.round).toBe(3);
    expect(state.queue.map((q) => q.id)).toEqual(['q-tf']);
  });

  test('streaks reset on a miss and the best run survives rounds', () => {
    let state = answerAll(initQuiz([tf, legacy, blank]), ['right', 'right', 'nope']);
    expect(state.bestStreak).toBe(2);
    expect(state.streak).toBe(0);
    state = quizReducer(state, { type: 'retestWrong' });
    expect(state.bestStreak).toBe(2);
  });

  test('restart starts round one again from scratch', () => {
    let state = answerAll(initQuiz([tf]), ['wrong']);
    state = quizReducer(quizReducer(state, { type: 'retestWrong' }), { type: 'restart', questions: [tf, blank] });
    expect(state).toMatchObject({ round: 1, index: 0, answers: {}, finished: false });
    expect(state.queue).toHaveLength(2);
  });
});

describe('Quiz', () => {
  test('a blank is answered by typing, with Enter to check and Enter to move on', async () => {
    const user = userEvent.setup();
    render(<Quiz questions={[blank, tf]} />);

    expect(screen.getByText(/Fill in the blank/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Your answer'), 'monophosphate{Enter}');
    expect(screen.getByText('Not quite')).toBeInTheDocument();
    expect(screen.getByText('triphosphate', { selector: 'em' })).toBeInTheDocument();

    await user.keyboard('{Enter}');
    expect(screen.getByText(/True or false/)).toBeInTheDocument();
  });

  test('true/false shows two options and keeps the number shortcuts', async () => {
    const user = userEvent.setup();
    render(<Quiz questions={[tf]} />);
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual(['1True', '2False']);
    await user.keyboard('1');
    expect(screen.getByText('Correct')).toBeInTheDocument();
  });

  test('"Explain this" appears only after a wrong answer, and shows the explanation', async () => {
    const user = userEvent.setup();
    const onExplain = vi.fn(async () => 'The Calvin cycle runs in the stroma, not the thylakoid.');
    render(<Quiz questions={[tf, legacy]} onExplain={onExplain} />);

    await user.keyboard('1'); // correct
    expect(screen.queryByRole('button', { name: 'Explain this' })).not.toBeInTheDocument();
    await user.keyboard('{Enter}');

    await user.keyboard('2'); // "No" — wrong
    await user.click(screen.getByRole('button', { name: 'Explain this' }));

    expect(await screen.findByText(/runs in the stroma, not the thylakoid/)).toBeInTheDocument();
    expect(onExplain).toHaveBeenCalledWith('q-old', 'No', expect.any(AbortSignal));
  });

  test('a failed explanation can be retried', async () => {
    const user = userEvent.setup();
    const onExplain = vi.fn().mockRejectedValueOnce(new Error('Rate limit reached.')).mockResolvedValueOnce('Because.');
    render(<Quiz questions={[tf]} onExplain={onExplain} />);
    await user.keyboard('2');
    await user.click(screen.getByRole('button', { name: 'Explain this' }));
    expect(await screen.findByText('Rate limit reached.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try explaining again' }));
    expect(await screen.findByText('Because.')).toBeInTheDocument();
  });
});
