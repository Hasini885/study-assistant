# Architecture

## Repo layout

```
frontend/     the React app (Vite): src/, tests/ (Vitest), public/
backend/      the API, the model client, and the study-set contract (backend/shared)
api/          Vercel's serverless entry points (see below)
e2e/          Playwright end-to-end tests
docs/         these documents
scripts/      one-off tooling (rendering the social preview image)
```

All the code lives in **`frontend/`** and **`backend/`**. `api/` is not a third component: Vercel only
creates serverless functions from an `api/` directory at the **repo root**, and putting them in
`backend/api/` fails the build outright:

```
The pattern "backend/api/*.js" defined in `functions` doesn't match any
Serverless Functions inside the `api` directory.
```

So each file in `api/` is an entry point and nothing else, a few lines that hand a request to `backend/`.

The study-set contract sits in `backend/shared/` because the backend owns it. The frontend imports it
through a `@contract` alias (see `frontend/vite.config.js`), so both halves validate against the same
definition rather than two copies that can drift. `npm run typecheck` checks it against the types in
`backend/shared/types.js`.

## One pipeline, two transports

Locally, Express (`backend/server.js`) serves the API. On Vercel, the functions in `api/` do. **Both
call straight into `backend/pipeline.js`**, so there is exactly one implementation of "turn text into a
validated study set", plus one shared module for streaming (`backend/sse.js`).

```
free-form text (typed, pasted, or extracted from a PDF/Word file in the browser)
  → POST /api/study-set            Accept: text/event-stream
      → rate limit (per IP)        backend/rateLimit.js
      → validate input             pipeline.buildGenerateRequest
      → Groq, streamed, JSON mode  backend/groq.js (fallback model on 429/5xx)
          ↳ event: partial         items that have fully arrived (partialStudySet)
      → extractJson()              tolerant parse
      → normalizeStudySet()        shape repair + validation, stable ids
      → verifyGrounding()          check each source quote against the notes
      → retry once on failure, showing the model its own bad output
  → event: done { studySet, meta: { repairs[], attempts, model, grounding, fallback? } }
      → isValidStudySet()          the client re-checks before rendering
```

| Path | Role |
|---|---|
| `backend/pipeline.js` | Rate limit → validate → generate. Refine and explain requests too. Transport-independent |
| `backend/sse.js` | Server-sent events for both transports |
| `backend/server.js`, `api/*.js` | Transport only |
| `backend/groq.js` | Provider calls (plain and streamed), typed errors, model fallback |
| `backend/prompt.js` | System prompt, schema contract, refine / repair / explain prompts |
| `backend/rateLimit.js` | Optional Upstash sliding-window limiter |
| `backend/shared/extractJson.js` | Tolerant JSON extraction |
| `backend/shared/normalize.js` | Shape repair, `isValidStudySet`, `studySetLimitViolation` |
| `backend/shared/ids.js` | Stable ids and reconciling them across a refine |
| `backend/shared/grounding.js` | Source-quote verification |
| `backend/shared/quiz.js` | Quiz types, typed-answer checking |
| `backend/shared/srs.js` | The spaced-repetition scheduler |
| `frontend/src/hooks/useStudySet.js` | Request lifecycle, streaming, race protection, retry/cancel |
| `frontend/src/hooks/useSessions.js`, `lib/sessionStore.js` | Saved sessions and progress in localStorage |
| `frontend/src/lib/extractText.js` | PDF / Word / text extraction in the browser |
| `frontend/src/lib/share.js`, `lib/exportSet.js` | Share links; Anki and CSV export |

## Streaming

The client asks for `text/event-stream`. The server streams the model's first attempt and, whenever
another `}` arrives, re-parses the text so far with `extractJson`'s truncation recovery. The item being
written at that moment may be half-finished, so the list whose key appears last in the text has its
last raw element dropped *before* normalising. Partial ids are content hashes, so each item keeps the
same id when the final set lands.

Anything that can fail before the model is called (the rate limit, bad input) is answered as ordinary
JSON with a real status code, because a stream's `200` can't be taken back. If streaming itself fails,
both sides fall back to a plain request: the server when the provider rejects the stream or it breaks
off, and the client when the stream ends without a result. An error the server *reports* is shown, not
retried. Streamed partials go through the same sequence guard as results, so cancelling or starting a
newer request always wins.

## Grounding

Input of 40 or more words counts as notes, not a topic. In notes mode the model must attach a short
word-for-word `source` quote to every item. The server looks for each quote in the notes, ignoring
case, whitespace, quote and dash styles and markdown emphasis, and allowing an ellipsis between parts
that appear in order. It then sets `grounded: true/false`. Quotes under 12 characters don't count as
evidence. The model's own `grounded` flag is never trusted; only the server sets it. A refine has no
notes to check against, so an item keeps its verdict only if its id and quote are unchanged.

## Stable ids

Progress (marks and review schedules) is keyed by item id, so ids have to survive refinement:

1. Ids the normaliser generates are a hash of the item's text: the same card always gets the same id.
2. The refine prompt sends every id and asks the model to keep it.
3. `reconcileIds` checks the result against the previous set: ids the model kept come first, then
   items with the same front or question text, then the same answer text. Duplicate or invented ids get
   fresh ones.

## Spaced repetition

`backend/shared/srs.js` is a pure SM-2 variant with Anki's four grades. A first *Good* schedules
1 day, then 3, then the interval times the card's ease (1.3–3.5, adjusted by Hard/Easy, lowered by
Again). *Again* resets the streak, counts a lapse and brings the card back in 10 minutes. Intervals cap
at a year. The clock is always passed in, so the scheduler is fully deterministic in tests. Grading
also sets the simpler known/review mark, so the progress ring and filters agree with the schedule.

## Storage

Sessions live in `localStorage` under `study-assistant:sessions:v2`, which adds a per-card progress map
to v1. v1 data is migrated on first read and removed only after the v2 copy is written. Storage is
untrusted. Every session, progress record and schedule is validated on read, records for cards that
no longer exist are dropped, and a failed write never breaks the app.

## Share links

A set is serialised (content only: no progress and no `grounded` verdicts), deflated with
`CompressionStream`, and base64url-encoded into the URL fragment. The fragment is never sent to a
server. On import, the link is size-capped before and after decompression, validated with
`isValidStudySet` and the same `LIMITS` check the API uses, and any missing or duplicate ids are
repaired.
