# Visual identity

The art direction is **index cards on a desk**, chosen because it matches what the app actually is,
rather than defaulting to generic dashboard chrome.

- **Warm paper, not flat white.** Cards and tiles sit on a `--paper` token mixed from the surface
  colour, with fine grain over the top. The grain is desaturated *inside* the SVG with `feColorMatrix`
  rather than with `mix-blend-mode`, because a blend mode creates a stacking context, which can defeat
  `backface-visibility` on the flip and show both faces at once.
- **A physical stack.** Up to two ghost cards sit behind the live one, rotated and offset. They thin
  out as you advance, so "how much is left" is legible without reading the counter.
- **Ruled answer side.** The back face is lined like something handwritten on an index card.
- **Rubber stamps.** Marking a card *Got it* or *Review later* slams a rotated, outlined MASTERED /
  REVIEW stamp onto the corner. It's purely decorative, so it's `aria-hidden`: the status is already
  conveyed by the buttons underneath.
- **Editorial serif for content.** Card fronts, quiz questions and titles use a system serif stack
  (`Iowan Old Style` → `Palatino` → `Georgia`). Chrome stays sans-serif, so study material is
  typographically distinct from UI. There's no web font, so no extra request.
- **Source badges.** *From your notes* is a small green pill with the quote in italics beneath it.
  *Not found in your notes* is deliberately quieter, a dashed outline in muted text, because it means
  "check me", not "I'm wrong".
- **Grade buttons say when, not how good.** Each spaced-repetition button shows the interval it would
  schedule ("10m", "3d"), so the choice is about time rather than self-judgement.
- **Highlighter swash** under the set title, drawn as a background gradient with
  `box-decoration-break: clone` so it wraps correctly across lines.
- **Inline SVG hero illustration** that inherits the current accent and theme. The favicon and social
  preview image (`frontend/public/`, rendered by `scripts/render-images.mjs`) reuse the same motif.

## Per-set colour identity

Every study set derives its own accent hue from its title (`frontend/src/lib/hue.js`), applied as
`--hue` on the app root so rings, tabs, highlights, ruled lines and the ambient backdrop all shift
together. It's a stable hash, so reopening a saved session brings back the same colour.

- The green–yellow band (70–150°) is deliberately skipped. Those hues read as *correct* in this UI,
  and an accent that looks like the right-answer colour would be actively confusing in a quiz.
- `--hue` is registered with `@property` as a `<number>`, which makes it animatable, so moving between
  sets sweeps the whole palette around the colour wheel instead of cutting.
