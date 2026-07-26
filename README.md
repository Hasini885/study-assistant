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
| `shared/extractJson.js` | Tolerant JSON extraction (shared by server and client) |
| `shared/normalize.js` | Shape repair, validation, `isValidStudySet` guard |
| `src/hooks/useStudySet.js` | Request lifecycle, race protection, retry/cancel |
| `src/hooks/useStudyProgress.js` | Per-card known/review state, shared by three views |
| `src/components/` | Prompt form, flashcards, browse grid, quiz, states, refinement |

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

### 7. Where this is proven

`npm test` runs 36 tests over exactly these paths — every recovery strategy and every repair
rule, each one written against output a model actually produced:

| Covered | Examples |
|---|---|
| Extraction | fenced JSON, prose wrappers, braces inside strings, escaped quotes, trailing commas, smart quotes, `NaN`, truncated mid-object |
| Shape repair | key aliases, envelopes, bare arrays, tuple and `"term - definition"` cards, missing sides, duplicates |
| Answer keys | letters, `(b)`, option text, labelled option text, 1-based indices, `{text, correct}` objects |
| Rejection | unanswerable questions, fewer than two distinct options, off-schema objects, deliberately empty sets |
| End to end | a truncated response becoming a shorter but valid study set |

During development these paths were also exercised through a failure-injection mode on the
server that returned deliberately broken responses on demand. That has been removed now the
behaviour is locked down by tests — it was a scaffold, not a feature, and shipping a switch that
makes the app fail on purpose is not something a user should find.

---

## Layout

### Landing

The app opens on a full-screen landing page: **STUDY ASSISTANT** set as full-bleed display type,
with the letters rising in on a stagger and index cards drifting behind them.

- The wordmark is sized in `vw` so it always fills the screen, clamped at both ends — the upper
  bound is what stops "ASSISTANT" (nine characters) running off the side of a wide monitor.
- Letters are individual spans so each can carry its own `animation-delay`, which breaks the text
  up for assistive tech — so the `<h1>` carries an `aria-label` and the letter spans are hidden
  from the accessibility tree.
- **Pointer parallax** — two planes moving opposite ways off one pointer position: the card layer
  leads, the wordmark counter-moves by less. `usePointerParallax` coalesces updates into one rAF
  per frame however fast the mouse moves, and opts out entirely on coarse pointers, where there
  is no hover to track.
- **A rotating topic** in the lede cycles through example subjects, each one blurring and rising
  into place.
- **A ticker** along the bottom scrolls the feature list. The list is rendered twice so
  `translateX(-50%)` lands exactly on the seam, and both ends are masked so items fade in and out
  rather than popping at the edge.
- **A scatter exit** — starting the app throws the cards off-screen and lifts the wordmark away
  before handing over. Skipped entirely under reduced motion, which takes the direct path.
- **Enter** or **Space** starts, so you never have to reach for the mouse.
- If you have saved sessions, a secondary action offers to resume the most recent one directly,
  skipping the prompt entirely.

All parallax and float motion uses `translate` as an individual property rather than the
`transform` shorthand, so the pointer parallax composes with each card's own float animation
instead of overwriting it.

The landing owns the whole viewport, so it replaces the shell rather than rendering inside it —
but it returns *after* every hook, so app state and any in-flight request survive.

### App shell

A full-viewport shell rather than a centred column:

```
┌────────────────────────────────────────────────┐
│ topbar — brand, new set, theme                 │
├──────────────┬─────────────────────────────────┤
│ sidebar      │  workspace                      │
│  new set     │   Flashcards │ Browse │ Quiz    │
│  progress    │   …                             │
│  sessions    │   refine bar                    │
└──────────────┴─────────────────────────────────┘
```

On desktop the page itself never scrolls — the sidebar and workspace scroll independently, so
your progress panel and session list stay put while you work through a long set. Below 900px the
shell unwinds into normal document flow and the sidebar becomes an overlay drawer behind the ☰
button (closes on Escape, on the scrim, or when you load a session).

The workspace is **full-bleed** — no fixed content cap. Side padding scales with the viewport
(`clamp(20px, 3.5vw, 56px)`) so a wider monitor buys more study surface rather than more empty
margin, and the extra width is spent on layout that earns it:

- **≥1100px** — the deck splits into the card plus a **card rail**: a scrollable list of every
  card in the current view, current one highlighted, status dot each, click to jump. The rail
  supersedes the compact jump bar rather than duplicating it.
- **≥1000px** — quiz answers lay out in two columns, so four options and the feedback panel fit
  without scrolling.
- The card itself grows with the window (`clamp(300px, 44vh, 480px)`), so a tall screen gets a
  bigger card, not a bigger gap.

The **⤢ button** in the topbar goes native fullscreen for distraction-free study. It's hidden
where the API isn't usable (iOS Safari exposes it on video elements only), and its state is read
back from the document so pressing Esc — which the app never sees as a click — keeps the label
honest.

The hero is the one thing still centred and measured at 860px: a textarea the width of a 4K
monitor would be worse, not better. Before anything is generated the workspace shows that hero
and the sidebar is just your saved sessions — no point showing a progress ring for a set that
doesn't exist.

## Features

- Free-form textarea (⌘/Ctrl+Enter to submit). Set size is fixed at 8 cards and 5 questions —
  more knobs did not make the tool better, and a predictable size keeps the wait short.
- **Flashcards** — 3D flip, **drag or swipe sideways** to move between cards (the card follows
  your pointer and snaps back if you don't cross the threshold), shuffle, mark *Got it* /
  *Review later*, filter to drill only the flagged ones, and a **jump bar** of ticks coloured by
  status so you can leap to any card — swapped for a full card rail on wide screens.
- **Browse** — the whole set as a grid. Tiles flip in place independently, filter by
  All / Unseen / Known / To review, reveal every answer at once, or hit *Study* on a tile to drop
  into the deck at exactly that card.
- **Quiz** — one question at a time, immediate feedback with explanation, score ring, and
  **re-test wrong answers** as its own round. Options are shuffled per round, because models have
  a strong positional bias toward putting the correct answer first.
- **Live progress panel** — a ring plus known / to-review / untouched counts that update as you
  study, and your latest quiz score (labelled with the re-test round when relevant).
- **Refinement loop** — follow-up prompts (*"make the questions harder"*) that edit the existing
  set instead of regenerating from scratch.
- **Save & reload sessions** — localStorage, validated on read (storage is treated as untrusted).
- Loading skeletons, typed error states, empty states.
- Dark / light / system theme, native fullscreen toggle, keyboard navigation (←/→, 1–9, Space,
  Enter), mobile layout, `prefers-reduced-motion` support.

## Visual identity

The art direction is **index cards on a desk**, chosen because it matches what the app actually
is rather than defaulting to generic dashboard chrome.

- **Warm paper, not flat white** — cards and tiles sit on a `--paper` token mixed from the
  surface colour, with fine grain over the top. The grain is desaturated *inside* the SVG with
  `feColorMatrix` rather than with `mix-blend-mode`, because a blend mode creates a stacking
  context and that can defeat `backface-visibility` on the flip, showing both faces at once.
- **A physical stack** — up to two ghost cards sit behind the live one, rotated and offset. They
  thin out as you advance, so "how much is left" is legible without reading the counter.
- **Ruled answer side** — the back face is lined like something handwritten on an index card.
- **Rubber stamps** — marking a card *Got it* or *Review later* slams a rotated, outlined
  MASTERED / REVIEW stamp onto the corner. Purely decorative, so it's `aria-hidden`: the status is
  already conveyed by the buttons underneath.
- **Editorial serif for content** — card fronts, quiz questions and titles use a system serif
  stack (`Iowan Old Style` → `Palatino` → `Georgia`). Chrome stays sans-serif, so study material
  is typographically distinct from UI. No web font, so no extra request.
- **Highlighter swash** under the set title, drawn as a background gradient with
  `box-decoration-break: clone` so it wraps correctly across lines.
- **Inline SVG hero illustration** that inherits the current accent and theme.

### Per-set colour identity

Every study set derives its own accent hue from its title (`src/lib/hue.js`), applied as `--hue`
on the app root so rings, tabs, highlights, ruled lines and the ambient backdrop all shift
together. It's a stable hash, so reopening a saved session brings back the same colour and "the
blue set" stays a usable way to think about it.

Two details:

- The green–yellow band (70–150°) is deliberately skipped. Those hues read as *correct* in this
  UI, and an accent that looks like the right-answer colour would be actively confusing in a quiz.
- `--hue` is registered with `@property` as a `<number>`, which makes it animatable — so moving
  between sets sweeps the whole palette around the colour wheel instead of cutting. Browsers
  without `@property` just get an instant change.

## Motion and visuals

No animation library — everything is CSS keyframes plus one small rAF hook, which keeps the
bundle small and every effect explainable.

- **Ambient backdrop** — two slow-drifting colour washes behind the app, and a frosted
  `backdrop-filter` topbar. Low enough in opacity that text contrast is untouched.
- **Directional card travel** — moving through the deck flies the incoming card in from the side
  you moved toward. The wrapper is keyed on the card index, so React remounts it and the entrance
  animation restarts; `data-dir` picks the keyframe.
- **Staggered entrances** — quiz options, grid tiles, rail rows and result rows cascade in via a
  `--i` custom property driving `animation-delay`.
- **Answer feedback** — a wrong pick shakes, a right one pops.
- **Streak counter** — consecutive correct answers surface a 🔥 chip that pops in on each
  increment (keyed on the streak value so the animation replays), and your best run is reported
  on the results screen.
- **Confetti** — a 26-piece DOM burst on a perfect round or a cleared re-test. Each piece gets
  randomised offset, spin, delay and scale via custom properties, driven by one keyframe rule.
  It unmounts itself when the burst finishes.
- **Animated counters** — `useAnimatedNumber` tweens with `requestAnimationFrame`, because a
  `conic-gradient` can't be transitioned in CSS. Animating the *value* is what makes the progress
  ring and score ring sweep instead of jump.

Two details worth knowing:

- Entrance animations use `animation-fill-mode: backwards`, not `both`. `both` holds the final
  transform after the animation ends, which then beats `:hover` transforms further down the
  cascade — tiles would stop lifting on hover. `backwards` only applies the `from` state during
  the stagger delay, which is all the stagger needs.
- Under `prefers-reduced-motion` the global rule collapses every duration, and the ambient drift
  and progress shimmer are additionally set to `animation: none` — an infinite loop shortened to
  0.01ms still repaints every frame. `Confetti` checks the media query in JS and renders nothing
  at all.

Card progress lives in `useStudyProgress` at the app level rather than inside the deck, because
the deck, the browse grid and the sidebar panel all read and write it. Card ids are regenerated
every time a set is normalized, so the hook watches the first card's id to detect "different set
now" and starts clean.

### Keyboard

| Key | Action |
|---|---|
| ← / → | Previous / next card |
| Space / Enter | Flip card (when focused) |
| Esc | Close the mobile sidebar |
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
- **Groq's free tier rate-limits quickly.** Generating and then immediately refining a set can
  trip a 429 — refinement sends the whole set back, so it's a token-heavy request. The app
  surfaces this as a clear "Rate limit reached, wait a few seconds" error with a Retry button
  rather than a generic failure, but the limit itself is real. Waiting a few seconds fixes it.
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
