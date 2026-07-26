/**
 * Prompt construction.
 *
 * Kept in one file so the contract with the model lives next to the schema the
 * normalizer enforces. If you change the shape here, change shared/normalize.js
 * too — the normalizer is the safety net, not the spec.
 */

const SCHEMA_CONTRACT = `Return ONLY a JSON object with exactly this shape:

{
  "title": "short title for the study set",
  "summary": "2-3 sentence overview of the material",
  "flashcards": [
    { "front": "question or term", "back": "answer or definition", "hint": "optional short nudge" }
  ],
  "quiz": [
    {
      "question": "multiple choice question",
      "options": ["option A", "option B", "option C", "option D"],
      "answerIndex": 0,
      "explanation": "one sentence on why that answer is right"
    }
  ]
}

Hard rules:
- "answerIndex" is a ZERO-BASED integer index into that question's "options" array. Not a letter, not the answer text, not 1-based.
- Every question needs exactly 4 distinct options. Exactly one is correct.
- Do not prefix options with "A)", "1." or bullets. Just the option text.
- No markdown, no code fences, no commentary before or after the JSON.`;

const SYSTEM_PROMPT = `You are a study-material generator for a flashcard and quiz app.

You turn a student's notes or topic into study material. You never chat, never ask follow-up questions, and never explain what you are about to do. You output a single JSON object and nothing else.

${SCHEMA_CONTRACT}

Content rules:
- If the user pasted notes, draw ONLY on those notes. Do not add outside facts.
- If the user named a topic without notes, use your own knowledge of it.
- Flashcard fronts should be answerable in a sentence. Avoid yes/no questions.
- Wrong quiz options must be plausible, not obviously silly.
- Match the user's language.
- If the input is too vague or short to make study material from, return {"title":"","summary":"","flashcards":[],"quiz":[]} rather than inventing a topic.`;

/** How much material a set contains. Fixed rather than user-facing: more knobs
 *  did not make the tool better, and a predictable size keeps the wait short. */
const CARD_COUNT = 8;
const QUESTION_COUNT = 5;

export function buildGenerateMessages({ input }) {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Create ${CARD_COUNT} flashcards and ${QUESTION_COUNT} multiple-choice questions from the following.\n\n---\n${input}\n---`,
    },
  ];
}

/**
 * Refinement: the model edits an existing set rather than regenerating it.
 * We send the current set back so unchanged items survive verbatim, which keeps
 * the user's quiz progress meaningful across a refinement.
 */
export function buildRefineMessages({ studySet, instruction }) {
  const current = JSON.stringify(
    {
      title: studySet.title,
      summary: studySet.summary,
      flashcards: studySet.flashcards.map(({ front, back, hint }) => ({ front, back, hint })),
      quiz: studySet.quiz.map(({ question, options, answerIndex, explanation }) => ({
        question,
        options,
        answerIndex,
        explanation,
      })),
    },
    null,
    2
  );

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Here is an existing study set:\n\n${current}\n\nApply this change: "${instruction}"\n\nReturn the COMPLETE updated study set in the same JSON shape. Keep every item the instruction does not touch exactly as it is. Do not drop items unless asked to.`,
    },
  ];
}

/**
 * Second attempt after a parse/shape failure. Showing the model its own broken
 * output fixes far more cases than simply re-rolling the same prompt.
 */
export function buildRepairMessages({ previousMessages, badOutput, problem }) {
  return [
    ...previousMessages,
    { role: 'assistant', content: String(badOutput ?? '').slice(0, 4000) },
    {
      role: 'user',
      content: `That response was rejected: ${problem}\n\nReturn the same content as a single valid JSON object matching the required shape. Remember: "answerIndex" is a zero-based integer, every question needs 4 distinct options, and the response must contain nothing but the JSON object.`,
    },
  ];
}
