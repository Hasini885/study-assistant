# Study Assistant

**Live: https://study-assistant-indol-pi.vercel.app**

Paste your notes, upload a PDF, or just name a topic, and get flashcards, a quiz, and spaced-repetition
reviews. When the cards come from your notes, every one is checked against them.

The model returns structured JSON. The app parses it, repairs what it can, drops what it can't, says
what it did, and renders interactive study tools. There is no chat window anywhere.

<!-- TODO: record a short GIF (paste notes → cards stream in → flip → grade → quiz) and save it as docs/demo.gif -->

![Study Assistant demo](docs/demo.gif)

**Full demo video:** [watch on …](https://example.com/replace-with-your-video-link) <!-- TODO: replace with the hosted video URL -->

---

## Quick start

Requires Node 20+ and a free Groq API key from [console.groq.com/keys](https://console.groq.com/keys).

```bash
npm install
cp .env.example .env      # Windows: copy .env.example .env — then set GROQ_API_KEY
npm start                 # API on :8787, app on http://localhost:5173 (open this one)
```

The API key never reaches the browser: the app only calls `/api/*` on its own origin, and the server
is the only thing that talks to Groq. Deploying to Vercel takes one environment variable, see
[docs/deploying.md](docs/deploying.md).

## Features

**Making a set**

- Paste notes or a topic, or **upload a PDF, Word (.docx), .txt or .md file**. The text is extracted
  in your browser and shown before anything is sent.
- Cards **stream in** as the model writes them.
- **Checked against your notes.** For notes, every card and question carries a quote, and the server
  confirms the quote really appears in what you pasted. Verified items say *From your notes*;
  the rest are flagged *Not found in your notes* so you know which ones to double-check.
- **Refine** with follow-ups (*"make the questions harder"*). Cards keep their identity, so your progress
  survives the edit.

**Studying**

- **Flashcards:** flip, swipe, shuffle, mark *Got it* / *Review later*, drill only the flagged ones.
- **Spaced repetition:** after revealing a card, grade it *Again / Hard / Good / Easy*. Each button
  shows when you'll see the card next.
- **Due today:** one review queue across every saved set, from the landing page or the sidebar.
- **Quiz:** multiple choice, **true/false** and **fill-in-the-blank**, with forgiving answer matching.
  Wrong answers come back as a re-test round, and **Explain this** gives a short explanation drawn
  only from your set.
- **Browse** the whole set as a grid.

**Keeping and sharing**

- Sessions and progress are **saved in your browser**, and every grade is persisted as you make it.
- **Share by link.** The whole set is compressed into the URL, so nothing is uploaded anywhere.
- **Export** to Anki or CSV, or **print** the set with an answer page.

Also: dark/light theme, full keyboard control, mobile layout, `prefers-reduced-motion` support, and
no animation library.

## Scripts

| Command | What it does |
|---|---|
| `npm start` | API + app in development |
| `npm test` | 176 backend tests (`node --test`) + 103 frontend tests (Vitest + Testing Library) |
| `npm run test:e2e` | 3 Playwright tests against the production build, with the production CSP and a mocked API |
| `npm run lint` / `npm run format:check` | ESLint and Prettier |
| `npm run typecheck` | Type-checks the shared contract (`backend/shared`, JSDoc + `// @ts-check`) |
| `npm run build` | Production build into `dist/` |

CI runs all of these on every push and pull request (`.github/workflows/ci.yml`).

## Documentation

| | |
|---|---|
| [Architecture](docs/architecture.md) | Repo layout, the single pipeline, streaming, grounding, stable ids, spaced repetition, storage, share links |
| [Handling bad model output](docs/failure-handling.md) | Tolerant parsing, shape repair, retries, model fallback, rate limits, race guards |
| [Deploying](docs/deploying.md) | Vercel setup, environment variables, security headers, production gotchas |
| [Layout and keyboard](docs/layout.md) | Landing page, app shell, responsive behaviour, every shortcut |
| [Motion](docs/motion.md) | How every animation works without a library, and reduced motion |
| [Visual identity](docs/visual-identity.md) | The index-cards-on-a-desk art direction and per-set colour |
| [AI usage](docs/ai-usage.md) | How AI was used to build this |

## Known limitations

- **Grounding proves a quote is real, not that the card is right.** A verified card quotes your notes,
  but could still misread them. Sets made from a bare topic have no notes to check against.
- **Refinement can't re-check sources.** The server only sees the set, not your notes, so edited or
  added items have no verdict. Unchanged items keep theirs.
- **Streaming is only as smooth as the provider's chunks.** In JSON mode Groq's current models often
  send large chunks, so cards can arrive in a few bursts rather than one by one.
- **Progress lives in this browser.** No accounts or sync. Clearing site data clears it, it keeps up to
  12 saved sets, and share links carry the cards but not anyone's progress.
- **Only graded cards are scheduled.** A card joins *Due today* after you grade it once.
- **No OCR.** Scanned PDFs without a text layer can't be read, and neither can legacy `.doc` or `.pptx`.
- **Anki export is a text import**, so the cards arrive in Anki without their review history.
- **One provider.** Groq retires models (the original default, Llama 3.3 70B, stopped working), so
  the default may need updating. A fallback model covers rate limits and outages, not retirements.
- **Rate limiting needs Upstash** and is per IP. Without it, anyone with the URL can spend the Groq
  quota. See [docs/deploying.md](docs/deploying.md).
- **20,000-character input cap.** Long notes can still hit the model's context limit, which returns a
  clear "input too long" error.

## What I'd do next

1. **Sync across devices.** An optional account, or at least export/import of progress, so studying
   isn't tied to one browser.
2. **Re-verify sources on refine.** Keep the notes client-side and send them with refinements.
3. **OCR for scanned PDFs**, loaded on demand like the other parsers.
4. **FSRS** once there's enough review history to fit its parameters per user, instead of SM-2's fixed
   ones.
5. **`.apkg` export** with review history, so moving to Anki doesn't reset the schedule.
6. Let the model return mixed block types (a diagram, a checklist, a table) and render each one
   appropriately.
