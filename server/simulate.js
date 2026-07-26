/**
 * Failure injection for development.
 *
 * The hard part of this assignment is what happens when the model misbehaves,
 * and you cannot demo that reliably by waiting for a real model to break. These
 * modes let the UI's failure paths be exercised on demand (there is a "Test
 * failure handling" menu in the app footer).
 *
 * Disabled entirely when NODE_ENV=production.
 */

export const SIMULATION_MODES = {
  malformed: 'Truncated / unparseable JSON',
  fenced: 'JSON wrapped in prose and markdown fences',
  wrong_shape: 'Valid JSON, wrong schema',
  partial: 'Half the items are malformed',
  bad_answer_index: 'Answers given as letters, 1-based, and text',
  empty: 'Valid but empty study set',
  slow: 'Very slow response (12s)',
  upstream_error: 'Provider returns 500',
  rate_limited: 'Provider returns 429',
};

export function isSimulationEnabled() {
  return process.env.NODE_ENV !== 'production';
}

/**
 * Returns the fake raw model output for a mode, or throws to simulate a
 * transport failure. Returns null for unknown modes so the caller falls
 * through to a real request.
 */
export async function simulateRawCompletion(mode, { signal } = {}) {
  switch (mode) {
    case 'malformed':
      return '{"title": "Photosynthesis", "flashcards": [{"front": "What is chlorophyll?", "back": "The green pig';

    case 'fenced':
      return [
        'Sure! Here are your flashcards and quiz:',
        '',
        '```json',
        JSON.stringify(
          {
            title: 'Photosynthesis',
            summary: 'How plants convert light into chemical energy.',
            flashcards: [
              { front: 'What is chlorophyll?', back: 'The green pigment that absorbs light energy.' },
              { front: 'Where does photosynthesis occur?', back: 'In the chloroplasts of plant cells.' },
            ],
            quiz: [
              {
                question: 'Which gas do plants absorb during photosynthesis?',
                options: ['Oxygen', 'Carbon dioxide', 'Nitrogen', 'Hydrogen'],
                answerIndex: 1,
                explanation: 'CO2 is fixed into glucose during the Calvin cycle.',
              },
            ],
          },
          null,
          2
        ),
        '```',
        '',
        'Let me know if you want more cards!',
      ].join('\n');

    case 'wrong_shape':
      return JSON.stringify({
        topic: 'Photosynthesis',
        content: 'Plants make food from sunlight.',
        items: ['chlorophyll', 'chloroplast', 'Calvin cycle'],
      });

    case 'partial':
      return JSON.stringify({
        title: 'Photosynthesis',
        summary: 'How plants convert light into chemical energy.',
        flashcards: [
          { front: 'What is chlorophyll?', back: 'The green pigment that absorbs light.' },
          { front: 'Missing its back' },
          { back: 'Missing its front' },
          { front: 'What is chlorophyll?', back: 'A duplicate card.' },
          { front: 'Where does the Calvin cycle happen?', back: 'In the stroma of the chloroplast.' },
        ],
        quiz: [
          {
            question: 'Which gas do plants absorb?',
            options: ['Oxygen', 'Carbon dioxide', 'Nitrogen', 'Hydrogen'],
            answerIndex: 1,
          },
          { question: 'A question with only one option', options: ['Yes'], answerIndex: 0 },
          { question: 'A question with no answer at all', options: ['A', 'B', 'C', 'D'] },
          {
            question: 'Which organelle performs photosynthesis?',
            options: ['Mitochondrion', 'Chloroplast', 'Ribosome', 'Nucleus'],
            answerIndex: 1,
          },
        ],
      });

    case 'bad_answer_index':
      return JSON.stringify({
        title: 'Photosynthesis',
        summary: 'Answer keys expressed three different wrong-but-recoverable ways.',
        flashcards: [{ front: 'What is chlorophyll?', back: 'The green pigment that absorbs light.' }],
        quiz: [
          {
            question: 'Answer given as a letter',
            options: ['Oxygen', 'Carbon dioxide', 'Nitrogen', 'Hydrogen'],
            answer: 'B',
          },
          {
            question: 'Answer given as a 1-based index',
            options: ['Stroma', 'Thylakoid', 'Cytosol', 'Nucleus'],
            answerIndex: 2,
          },
          {
            question: 'Answer given as the option text, with a label',
            options: ['Mitochondrion', 'Chloroplast', 'Ribosome', 'Nucleus'],
            correctAnswer: 'B) Chloroplast',
          },
          {
            question: 'Options given as objects with a correct flag',
            options: [
              { text: 'Glucose', correct: true },
              { text: 'Starch', correct: false },
              { text: 'Cellulose', correct: false },
              { text: 'Sucrose', correct: false },
            ],
          },
        ],
      });

    case 'empty':
      return JSON.stringify({ title: '', summary: '', flashcards: [], quiz: [] });

    case 'slow':
      await delay(12_000, signal);
      return JSON.stringify({
        title: 'Slow response',
        summary: 'This took 12 seconds to arrive.',
        flashcards: [{ front: 'Did the UI stay responsive?', back: 'It should have, and it should be cancellable.' }],
        quiz: [],
      });

    case 'upstream_error': {
      const error = new Error('Simulated provider outage.');
      error.simulatedStatus = 500;
      throw error;
    }

    case 'rate_limited': {
      const error = new Error('Simulated rate limit.');
      error.simulatedStatus = 429;
      throw error;
    }

    default:
      return null;
  }
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
      },
      { once: true }
    );
  });
}
