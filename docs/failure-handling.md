# Handling bad model output

**JSON mode is a hint, not a contract.** Groq's `response_format: {type: "json_object"}` constrains
syntax. It says nothing about whether the object has the fields we need. Everything below assumes the
model will get it wrong.

## 1. Tolerant parsing — `backend/shared/extractJson.js`

Four strategies, cheapest first, stopping at the first one that parses:

1. `JSON.parse` as-is.
2. Strip ` ```json ` fences (including an unterminated one, which is what a truncated response looks
   like).
3. Slice to the outermost balanced `{…}`, discarding prose like *"Sure! Here are your flashcards:"*.
   The brace scan is string- and escape-aware, so a `}` inside a value doesn't end it early.
4. Repair: smart-quote delimiters → straight, `NaN`/`undefined` → `null`, drop trailing commas, and
   close anything left open by a truncated response. These rewrites only touch the structure
   *between* string values. A “curly quote” or a `, ]` inside a card's text is content and is left
   alone.

Step 4 means a response cut off mid-object still yields the cards that did arrive. It is also what
makes streaming work: every partial response is just a truncated one.

## 2. Shape repair — `backend/shared/normalize.js`

The rule is **salvage, don't reject**. Eight good flashcards and two broken ones should give the user
eight flashcards, not an error screen.

- Accepts key aliases: `cards`/`flashcards`, `questions`/`quiz`, `term`/`definition`,
  `choices`/`options`, `quote`/`evidence` for sources, and several names for a question's type.
- Unwraps envelopes (`{data: {...}}`) and bare arrays.
- Reads pair-shaped cards from tuples and `"Term - definition"` strings.
- Drops cards missing a side, duplicates, and questions with fewer than two distinct options.
- Strips `"A) "` prefixes off options.
- Truncates runaway strings so one 5,000-character "flashcard" can't wreck the layout.

The fiddliest part is **working out which option is correct**, because models express it at least six
ways: `answerIndex: 1`, `answer: "B"`, `answer: "(b)"`, `correctAnswer: "B) Thylakoid"`, 1-based
indices, and `options: [{text, correct: true}]`. All six are handled. True/false answers can also
arrive as booleans, `"yes"`, or reordered options, and are normalised to `['True', 'False']`. When the
answer *can't* be determined confidently, the question is dropped rather than guessed. Silently
marking a right answer wrong is the worst possible failure for a study tool.

## 3. One repair attempt

If parsing or validation fails, the model is sent its own bad output plus what was wrong with it, and
asked again. That fixes far more cases than re-rolling the same prompt. Two attempts in total: a
third rarely converges, and the user is already waiting.

Empty results are treated differently. If the model used our schema and returned nothing, that's a
real answer ("your input was too vague"), so it isn't retried. If it ignored the schema entirely, that
*is* retried.

## 4. When the provider is the problem

- **Model fallback.** On a `429` or a `5xx`, the call is retried once with `GROQ_FALLBACK_MODEL`.
  Groq's rate limits are per model, so a second model usually has headroom. The workspace says when
  the backup model made the set. Bad input, bad keys, timeouts and cancellation are not retried,
  because another model wouldn't change them.
- **Streaming fallback.** If the stream is rejected or breaks off, the same request is made without
  streaming (see [architecture.md](architecture.md#streaming)).
- **Typed errors.** `backend/groq.js` maps every HTTP and network failure to a code the UI has words
  for: rate limited, timed out, bad key, input too long, provider down.

## 5. Abuse protection

- **Rate limiting.** A per-IP sliding window in Upstash Redis, shared by generate and refine, with a
  separate bucket for explanations. It returns a `429` with `Retry-After`. It's a no-op without Upstash
  configured, and fails open if Upstash is down (see [deploying.md](deploying.md)).
- **Input limits.** `/api/refine` and `/api/explain` receive a whole study set from the browser. It is
  checked against the same `LIMITS` the normaliser enforces (counts, option counts, every string
  length, non-text values) and refused with a `400` before anything reaches the model.

## 6. Honest reporting

Every repair is recorded and surfaced in a dismissible banner, such as *"Skipped 3 malformed
flashcards"*, with a Regenerate button. The same principle covers grounding: an item whose source
can't be found isn't hidden, it's labelled.

## 7. Stale responses can't overwrite newer ones

Two independent guards in `useStudySet.js`:

1. Every new request aborts the previous one's `fetch`.
2. Every request carries a sequence number, and the reducer drops any result (or streamed partial)
   whose number isn't the latest.

(1) alone isn't enough. A response can already be in flight, or resolve in the same tick the abort
fires, so the slower of two overlapping requests could still land last. (2) is the actual correctness
guarantee; (1) just stops us paying for work nobody wants. Cancelling also bumps the sequence, so a
cancelled request can never reappear.

## 8. Failures never destroy working state

A failed *refinement* keeps the existing set on screen and shows a dismissible banner with Retry. Only
a failure with nothing to fall back on takes over the page. An `ErrorBoundary` catches any render-time
crash, so the worst case is still not a blank page.

## 9. Where this is proven

| Covered | Examples |
|---|---|
| Extraction | fenced JSON, prose wrappers, braces inside strings, escaped quotes, trailing commas, smart quotes (as delimiters and as content), `NaN`, truncated mid-object |
| Shape repair | key aliases, envelopes, bare arrays, tuple and `"term - definition"` cards, missing sides, duplicates |
| Answer keys | letters, `(b)`, option text, labelled option text, 1-based indices, `{text, correct}` objects, true/false in every format, typed blanks with typo tolerance |
| Rejection | unanswerable questions, fewer than two distinct options, off-schema objects, deliberately empty sets, oversized refine payloads |
| Streaming | partial sets, events split across reads, broken streams falling back, rate limits not retried |
| Races | out-of-order responses, cancel, stale partials, failed refines keeping the set (`frontend/tests/useStudySet.test.jsx`) |
| End to end | Playwright: generate → flip → grade → quiz → save → reload, uploads and share links under the production CSP |
