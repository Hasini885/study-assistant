# AI usage

I used **Claude (Claude Code)** heavily while building this: scaffolding the project, drafting
components, writing tests, and later taking it from a portfolio project to a product (spaced
repetition, uploads, grounding, streaming, new quiz types, sharing, CI). I directed the architecture,
set the constraints (one pipeline, one shared contract, salvage-don't-reject, honest reporting, no
animation library), reviewed what went in, and iterated on the parts that mattered.

Things worth calling out:

- The **answer-key resolution logic** went through several rounds. The first version only handled
  `answerIndex`; the list of six formats came from watching real Groq output get things wrong and
  deliberately writing test cases for each.
- **Real bugs found by testing rather than by reading the code:**
  - `req.on('close')` was aborting *every* request. Since Node 16 the request stream emits `close` as
    soon as its body has been read, not only on client disconnect, so every call cancelled itself the
    moment `express.json()` finished parsing. Fixed by listening on `res` and checking
    `res.writableFinished`.
  - The single-key-object fallback in the card parser was too greedy: `{front: "no back"}` became a
    card reading *"front / no back"* instead of being dropped.
  - The JSON repair step replaced curly quotes *inside* string values, which broke truncated responses
    containing “quoted” text.
  - A loaded session never showed as saved: an effect that marks a changed set as unsaved ran straight
    after loading and undid it.
  - The streaming "drop the half-written item" logic first ran after normalising, by which point the
    normaliser had sometimes already dropped it, so a complete card was lost instead. A test that cut
    the stream mid-card caught it.
  - The default model, `llama-3.3-70b-versatile`, had been retired by Groq; a live test of streaming
    surfaced it.
- The prompts in `backend/prompt.js` were rewritten by hand after the model kept returning 1-based
  `answerIndex` values.

The original build took roughly 8 hours: setup and prompt design ~1.5h, JSON extraction, shape repair
and tests ~2.5h, React state and race handling ~1.5h, flashcards and the quiz ~1.5h, styling and
accessibility ~1h.
