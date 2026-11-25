# Layout and keyboard

## Landing

The app opens on a full-screen landing page: **STUDY ASSISTANT** set as full-bleed display type, with
the letters rising in on a stagger and index cards drifting behind them. It's a first impression, not
a gate: once you've entered, later visits go straight to the app, and **Replay intro** in the sidebar
footer brings it back. A share link skips it as well.

- The wordmark is sized in `vw` so it always fills the screen, clamped at both ends. The upper bound
  is what stops "ASSISTANT" (nine characters) running off the side of a wide monitor.
- Letters are individual spans so each can carry its own `animation-delay`, which breaks the text up
  for assistive tech. So the `<h1>` carries an `aria-label` and the letter spans are hidden from the
  accessibility tree.
- **Pointer parallax.** Two planes move opposite ways off one pointer position: the card layer leads,
  and the wordmark counter-moves by less. `usePointerParallax` coalesces updates into one rAF per
  frame however fast the mouse moves, and opts out entirely on coarse pointers, where there is no
  hover to track.
- **A rotating topic** in the lede cycles through example subjects.
- **A ticker** along the bottom scrolls the feature list. The list is rendered twice so
  `translateX(-50%)` lands exactly on the seam, and both ends are masked so items fade rather than pop.
- **A scatter exit.** Starting the app throws the cards off-screen and lifts the wordmark away before
  handing over. It's skipped entirely under reduced motion, which takes the direct path.
- **Enter** or **Space** starts. If cards are due, a secondary action opens *Due today* directly; if
  you have saved sessions, another resumes the most recent one.

All parallax and float motion uses `translate` as an individual property rather than the `transform`
shorthand, so the pointer parallax composes with each card's own float animation instead of
overwriting it. The landing replaces the shell rather than rendering inside it, but it returns *after*
every hook, so app state and any in-flight request survive.

## App shell

```
┌────────────────────────────────────────────────┐
│ topbar — brand, new set, fullscreen, theme     │
├──────────────┬─────────────────────────────────┤
│ sidebar      │  workspace                      │
│  new set     │   title · share & export · save │
│  progress    │   Flashcards │ Browse │ Quiz    │
│  due today   │   …                             │
│  sessions    │   refine bar                    │
└──────────────┴─────────────────────────────────┘
```

On desktop the page itself never scrolls; the sidebar and workspace scroll independently. Below 900px
the shell unwinds into normal document flow, and the sidebar becomes an overlay drawer behind the ☰
button (it closes on Escape, on the scrim, or when you load a session).

The workspace is **full-bleed**. Side padding scales with the viewport (`clamp(20px, 3.5vw, 56px)`),
and the extra width goes to layout that earns it:

- **≥1100px**: the deck splits into the card plus a **card rail** listing every card in view.
- **≥1000px**: quiz answers lay out in two columns. True/false is always two side by side.
- The card grows with the window (`clamp(300px, 44vh, 480px)`).

**Due today** replaces the workspace with a single-card review queue drawn from every saved set. It's
opened from the sidebar or the landing page, and closed with *Done* or Esc.

The **⤢ button** goes native fullscreen. It's hidden where the API isn't usable (iOS Safari exposes it
on video elements only), and its state is read back from the document, so pressing Esc keeps the label
honest.

The hero is the one thing still centred and measured at 860px: a textarea the width of a 4K monitor
would be worse, not better. Files can be dropped on it.

## Keyboard

| Key | Action |
|---|---|
| ← / → | Previous / next card |
| Space / Enter | Flip card (when focused); Space also flips in *Due today* |
| 1 / 2 | Mark card *Got it* / *Review later* |
| A / H / G / E | After revealing a card: grade it *Again / Hard / Good / Easy* |
| 1–9 | Answer a multiple-choice or true/false question |
| Enter | Check a typed answer; then go to the next question |
| Esc | Close the mobile sidebar, the share menu, or *Due today* |
| ⌘/Ctrl + Enter | Generate |

Shortcuts are suppressed while typing in a text field.
