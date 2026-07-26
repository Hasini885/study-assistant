# Study Assistant

Paste your notes (or just name a topic), and get a set of flashcards to flip through plus a
multiple-choice quiz that re-tests whatever you got wrong.

The model returns structured JSON. The app parses it, repairs what it can, throws away what it
can't, and renders interactive components. There is no chat window anywhere.

---

## Setup

Requires Node 18+ (developed on Node 22).

```bash
npm install
cp .env.example .env      # Windows: copy .env.example .env
```

Put a Groq API key in `.env`. A free one takes about a minute to get from
[console.groq.com/keys](https://console.groq.com/keys):

```
GROQ_API_KEY=gsk_...
```

Then:

```bash
npm start
```

This runs both processes: the Express API on `http://localhost:8787` and the Vite dev server on
**`http://localhost:5173`** — open that one.

```bash
npm test      # 36 tests covering JSON extraction and shape repair
npm run build # production build
```

The app runs without a key — the failure-handling demo below works offline — but real generation
needs one.

### Why there's a backend

The API key must never reach the browser. The React app only ever calls `/api/*` on its own
origin; Vite proxies that to the Express process, which is the only thing that holds the key and
talks to Groq. `.env` is gitignored.

---

## How it works

```
free-form text
  → POST /api/study-set
      → Groq (llama-3.3-70b-versatile, JSON mode)
      → extractJson()        tolerant parse
      → normalizeStudySet()  shape repair + validation
      → retry once on failure, showing the model its own bad output
  → { studySet, meta: { repairs[], attempts, recovery } }
      → isValidStudySet()    client re-checks before rendering
      → flashcards / quiz UI
```

| Path | Role |
|---|---|
| `server/index.js` | API routes, the two-attempt generate pipeline, cancellation |
| `server/groq.js` | Provider call; maps every HTTP/network failure to a typed error |
| `server/prompt.js` | System prompt, schema contract, refinement + repair prompts |
| `server/simulate.js` | Failure injection for development |
| `shared/extractJson.js` | Tolerant JSON extraction (shared by server and client) |
| `shared/normalize.js` | Shape repair, validation, `isValidStudySet` guard |
| `src/hooks/useStudySet.js` | Request lifecycle, race protection, retry/cancel |
| `src/components/` | Prompt form, flashcards, quiz, states, refinement |

`shared/` is imported by both sides, so "what a valid study set is" is defined exactly once.

---

## Handling bad model output

This is the part the assignment cares about most, so here is what actually happens.

**JSON mode is a hint, not a contract.** Groq's `response_format: {type: "json_object"}` constrains
syntax. It says nothing about whether the object has the fields we need. Everything below assumes
the model will get it wrong.

### 1. Tolerant parsing — `shared/extractJson.js`

Four strategies, cheapest first, stopping at the first one that parses:

1. `JSON.parse` as-is.
2. Strip ` ```json ` fences (including an unterminated one, which is what a truncated response
   looks like).
3. Slice to the outermost balanced `{…}`, discarding prose like *"Sure! Here are your
   flashcards:"*. The brace scan is string- and escape-aware, so a `}` inside a value doesn't end
   it early.
4. Repair: smart quotes → straight, `NaN`/`undefined` → `null`, drop trailing commas, and close
   anything left open by a truncated response.

Step 4 means a response cut off mid-object still yields the cards that did arrive.

### 2. Shape repair — `shared/normalize.js`

The rule is **salvage, don't reject**. Eight good flashcards and two broken ones should give the
user eight flashcards, not an error screen.

- Accepts key aliases: `cards`/`flashcards`, `questions`/`quiz`, `term`/`definition`,
  `choices`/`options`.
- Unwraps envelopes (`{data: {...}}`) and bare arrays.
- Reads pair-shaped cards from tuples and `"Term - definition"` strings.
- Drops cards missing a side, duplicates, and questions with fewer than two distinct options.
- Strips `"A) "` prefixes off options.
- Truncates runaway strings so one 5,000-character "flashcard" can't wreck the layout.

The fiddliest part is **working out which option is correct**, because models express it at least
six ways: `answerIndex: 1`, `answer: "B"`, `answer: "(b)"`, `correctAnswer: "B) Thylakoid"`,
1-based indices, and `options: [{text, correct: true}]`. All six are handled. When the answer
*can't* be determined confidently, the question is dropped rather than guessed — silently marking
a right answer wrong is the worst possible failure for a study tool.

### 3. One repair attempt

If parsing or validation fails, the model is sent its own bad output plus what was wrong with it,
and asked again. That fixes far more cases than re-rolling the same prompt. Two attempts total —
a third rarely converges and the user is already waiting.

Empty results are treated differently: if the model used our schema and returned nothing, that's a
real answer ("your input was too vague"), so it isn't retried. If it ignored the schema entirely,
that *is* retried.

### 4. Honest reporting

Every repair is recorded and surfaced in a dismissible banner — *"Skipped 3 malformed flashcards"*
— with a Regenerate button. Showing 5 cards when 8 were requested, silently, is worse than saying
what happened.

### 5. Stale responses can't overwrite newer ones

Two independent guards in `useStudySet.js`:

1. Every new request aborts the previous one's `fetch`.
2. Every request carries a sequence number; the reducer drops any result whose number isn't the
   latest.

(1) alone isn't sufficient — a response can already be in flight, or resolve in the same tick the
abort fires, so the slower of two overlapping requests could still land last. (2) is the actual
correctness guarantee; (1) just stops us paying for work nobody wants. Cancelling also bumps the
sequence, so a cancelled request can never reappear.

### 6. Failures never destroy working state

A failed *refinement* keeps the existing set on screen and shows a dismissible banner with Retry.
Only a failure with nothing to fall back on takes over the page. An `ErrorBoundary` catches any
render-time crash so the worst case is still not a blank page.

### 7. Try it yourself

With `npm start` running, use the **"Test failure handling"** dropdown in the footer (development
only — the server refuses simulations when `NODE_ENV=production`). It makes the next request
return a specific kind of broken response:

| Mode | What you should see |
|---|---|
| Truncated / unparseable JSON | Partial set recovered, banner explains |
| JSON wrapped in prose and fences | Clean set, banner notes the recovery |
| Valid JSON, wrong schema | Retry, then a clear error with Try again |
| Half the items are malformed | Good items render, bad ones reported as skipped |
| Answers as letters / 1-based / text | All resolved to the right option |
| Valid but empty set | "Not enough to work with" |
| Very slow response (12s) | Skeletons, live timer, working Cancel button |
| Provider 500 / 429 | Typed error with the right message and Retry |

---

## Features

- Free-form textarea (⌘/Ctrl+Enter to submit), with adjustable card and question counts.
- **Flashcards** — flip animation, prev/next, shuffle, mark *Got it* / *Review later*, and a
  filter to drill only the flagged ones.
- **Quiz** — one question at a time, immediate feedback with explanation, score ring, and
  **re-test wrong answers** as its own round. Options are shuffled per round, because models have
  a strong positional bias toward putting the correct answer first.
- **Refinement loop** — follow-up prompts (*"make the questions harder"*) that edit the existing
  set instead of regenerating from scratch.
- **Save & reload sessions** — localStorage, validated on read (storage is treated as untrusted).
- Loading skeletons, typed error states, empty states.
- Dark / light / system theme, keyboard navigation (←/→, 1–9, Space, Enter), mobile layout,
  `prefers-reduced-motion` support.

### Keyboard

| Key | Action |
|---|---|
| ← / → | Previous / next card |
| Space / Enter | Flip card (when focused) |
| 1 / 2 | Mark card *Got it* / *Review later* |
| 1–9 | Answer a quiz question |
| Enter | Next question |
| ⌘/Ctrl + Enter | Generate |

Shortcuts are suppressed while typing in a text field.

---

## AI usage

I used **Claude (Claude Code)** heavily while building this — scaffolding the project, drafting
components, and writing the test suite. I directed the architecture, reviewed everything that went
in, and iterated on the parts that mattered. Specific things worth calling out:

- The **answer-key resolution logic** went through several rounds. The first version only handled
  `answerIndex`; the list of six formats came from watching real Groq output get things wrong and
  from deliberately writing test cases for each.
- Two **real bugs** were found by testing rather than by reading the code:
  - `req.on('close')` was aborting *every* request. Since Node 16 the request stream emits `close`
    as soon as its body has been read, not only on client disconnect, so every call cancelled
    itself the moment `express.json()` finished parsing. Fixed by listening on `res` and checking
    `res.writableFinished`.
  - The single-key-object fallback in the card parser was too greedy: `{front: "no back"}` became a
    card reading *"front / no back"* instead of being dropped. Now guarded against known field
    names.
- The prompts in `server/prompt.js` were rewritten by hand after the model kept returning 1-based
  `answerIndex` values.

I also used AI for CSS scaffolding. Every file here is one I can walk through and extend.

---

## Known limitations

- **Not streamed.** Generation is a single request, so an 8-card set takes a few seconds with
  skeletons showing. Streaming partial JSON was the next thing on the list.
- **No verification of correctness.** The app guarantees the *shape* of the output, not its
  truth — the model can produce a confidently wrong flashcard and nothing here will catch it.
  Cards drawn from pasted notes are much more reliable than ones from a bare topic.
- **Refinement resets quiz progress.** The set is remounted when it changes, so a half-finished
  quiz is cleared. Preserving progress across an edit needs stable IDs round-tripped through the
  model.
- **Study progress isn't persisted.** Saved sessions restore the cards and questions, not which
  ones you'd marked known.
- **Single-provider.** Only Groq. The provider call is isolated in `server/groq.js`, so swapping it
  is a contained change, but there's no abstraction layer.
- **No rate limiting or auth on the API.** Fine for local use, not for deployment.
- **20,000 character input cap**, and long notes can still hit the model's context limit — that
  returns a clear "input too long" error rather than failing mysteriously.
- **Tests cover the parsing and repair layer only.** No component tests; the UI was verified by
  hand and through the failure-injection modes.

## What I'd do next

1. Stream the response so cards appear as they generate.
2. Spaced repetition — persist per-card known/review state and schedule reviews.
3. Component tests for the quiz reducer, especially the re-test rounds.
4. Let the model return mixed block types (a diagram, a checklist, a table) and render each
   appropriately.

## Time spent

Roughly 8 hours.

| | |
|---|---|
| Setup, backend, prompt design | ~1.5h |
| JSON extraction + shape repair + tests | ~2.5h |
| React state, hooks, race handling | ~1.5h |
| Flashcards, quiz, re-test loop | ~1.5h |
| Styling, dark mode, mobile, a11y | ~1h |
