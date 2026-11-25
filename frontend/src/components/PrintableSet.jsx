import { correctAnswerText, quizType } from '@contract/quiz.js';

/**
 * The whole set as a document, for printing. Hidden on screen; the print
 * stylesheet hides the app around it and shows this instead, because the
 * interactive views show one card at a time and would print as one card.
 */
export function PrintableSet({ studySet }) {
  return (
    <article className="printable" aria-hidden="true">
      <h1 className="printable__title">{studySet.title}</h1>
      {studySet.summary && <p className="printable__summary">{studySet.summary}</p>}

      {studySet.flashcards.length > 0 && (
        <section>
          <h2>Flashcards</h2>
          <ol className="printable__cards">
            {studySet.flashcards.map((card) => (
              <li key={card.id} className="printable__card">
                <p className="printable__front">{card.front}</p>
                <p className="printable__back">{card.back}</p>
                {card.source && <p className="printable__source">“{card.source}”</p>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {studySet.quiz.length > 0 && (
        <section>
          <h2>Quiz</h2>
          <ol className="printable__quiz">
            {studySet.quiz.map((q) => (
              <li key={q.id} className="printable__question">
                <p>{q.question}</p>
                {quizType(q) !== 'blank' && (
                  <ol type="A">
                    {q.options.map((option, i) => (
                      <li key={i}>{option}</li>
                    ))}
                  </ol>
                )}
              </li>
            ))}
          </ol>

          {/* Answers on their own page, so the quiz can be done on paper. */}
          <h2 className="printable__answers-title">Answers</h2>
          <ol className="printable__answers">
            {studySet.quiz.map((q) => (
              <li key={q.id}>
                <strong>{correctAnswerText(q)}</strong>
                {q.explanation && ` — ${q.explanation}`}
              </li>
            ))}
          </ol>
        </section>
      )}
    </article>
  );
}
