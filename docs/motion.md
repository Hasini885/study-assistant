# Motion

No animation library. Everything is CSS keyframes plus one small rAF hook, which keeps the bundle small
and every effect explainable.

- **Ambient backdrop.** Two slow-drifting colour washes behind the app, and a frosted
  `backdrop-filter` topbar, low enough in opacity that text contrast is untouched.
- **Directional card travel.** Moving through the deck flies the incoming card in from the side you
  moved toward. The wrapper is keyed on the card index, so React remounts it and the entrance
  animation restarts; `data-dir` picks the keyframe.
- **Staggered entrances.** Quiz options, grade buttons, grid tiles, rail rows, result rows and
  streamed cards cascade in via a `--i` custom property driving `animation-delay`.
- **Answer feedback.** A wrong pick (or a wrong typed answer) shakes; a right one pops.
- **Streak counter.** Consecutive correct answers surface a 🔥 chip that pops in on each increment
  (keyed on the streak value, so the animation replays).
- **Confetti.** A 26-piece DOM burst on a perfect round or a cleared re-test. Each piece gets a
  randomised offset, spin, delay and scale via custom properties, driven by one keyframe rule. It
  unmounts itself when the burst finishes.
- **Animated counters.** `useAnimatedNumber` tweens with `requestAnimationFrame`, because a
  `conic-gradient` can't be transitioned in CSS. Animating the *value* is what makes the progress ring
  and score ring sweep instead of jump.

Two details worth knowing:

- Entrance animations use `animation-fill-mode: backwards`, not `both`. `both` holds the final
  transform after the animation ends, which then beats `:hover` transforms further down the cascade,
  so tiles would stop lifting on hover. `backwards` only applies the `from` state during the stagger
  delay, which is all the stagger needs.
- Under `prefers-reduced-motion` a global rule collapses every duration, and the ambient drift, the
  progress shimmer and the ticker are additionally set to `animation: none`, since an infinite loop
  shortened to 0.01ms still repaints every frame. `Confetti` checks the media query in JS and renders
  nothing at all, and the landing skips its exit animation.

## Where state lives

Card progress (the known/review mark and the review schedule) is owned by the app, not the deck. It
belongs to the saved session when there is one, so each mark is persisted as it's made, and to an
in-memory draft otherwise. `useStudyProgress` is the shared view of it for the deck, the browse grid
and the sidebar panel. Card ids are stable across refinement (see
[architecture.md](architecture.md#stable-ids)), so the deck and quiz remount only when their own
content changes, and progress carries over.

## Styles

The stylesheet is split into one file per part of the UI under `frontend/src/styles/`, imported in a
fixed order from `styles/index.css`. Later files deliberately override earlier ones: `responsive.css`
and `motion.css` adjust rules from the component files above them. Don't reorder the imports.
