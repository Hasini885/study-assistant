# Deploying to Vercel

The project is Vercel-ready:

- the Vite build is served as static files from `dist`
- `api/health.js`, `api/study-set.js`, `api/refine.js` and `api/explain.js` are serverless functions

## Deploy

Push the repo to GitHub, then import it at [vercel.com/new](https://vercel.com/new). The Vite preset is
detected automatically. Before the first deploy, add the environment variables:

| Name | Value |
|---|---|
| `GROQ_API_KEY` | **required** — your key from [console.groq.com/keys](https://console.groq.com/keys) |
| `GROQ_MODEL` | optional — defaults to `openai/gpt-oss-120b` |
| `GROQ_FALLBACK_MODEL` | optional — retried once on a 429/5xx; defaults to `qwen/qwen3.8-27b`, `none` disables it |
| `UPSTASH_REDIS_REST_URL` | optional — enables per-IP rate limiting (below) |
| `UPSTASH_REDIS_REST_TOKEN` | optional — pairs with the URL above |
| `RATE_LIMIT_REQUESTS` / `RATE_LIMIT_WINDOW` | optional — defaults to `10` per `60 s` |
| `REQUEST_TIMEOUT_MS` | optional — per model call, defaults to `25000` |

Or from the CLI:

```bash
npm i -g vercel
vercel login
vercel link
vercel env add GROQ_API_KEY production
vercel --prod
```

## Things that matter in production

- **Function duration.** `vercel.json` sets `maxDuration: 60`. A request makes one model call, and in
  the worst case four: a self-repair attempt, with each attempt retried once on the fallback model if
  the primary is rate-limited or down. `REQUEST_TIMEOUT_MS` (25 s by default) applies to each call.
  Most requests finish in a few seconds, but if your plan caps duration lower, lower
  `REQUEST_TIMEOUT_MS` to match. Otherwise the platform kills the function and the user gets an opaque
  gateway error instead of the app's own "the model timed out".
- **Streaming.** Responses to `Accept: text/event-stream` are written progressively, which Vercel's
  Node runtime supports. If a proxy in front buffers the stream, the client still gets the finished
  set; it just won't see cards arrive one by one.
- **Node 20+** is required (`AbortSignal.any`), pinned via `engines` in `package.json`.
- **Rate limiting needs Upstash.** `/api/study-set` and `/api/refine` share a per-IP sliding window,
  and `/api/explain` has its own. Serverless instances share no memory, so the count lives in Upstash
  Redis: a free database from [console.upstash.com](https://console.upstash.com), or Vercel's Upstash
  integration (which names the variables `KV_REST_API_URL` / `KV_REST_API_TOKEN`; either pair works).
  Without them the limiter is a no-op, which is what you want locally but means anyone with the URL
  can spend your Groq quota. It fails open: if Upstash is down, requests go through rather than the app
  going down with it.
- **Security headers.** `vercel.json` sends a Content-Security-Policy (scripts and connections from
  the app's own origin only, `blob:` workers for pdf.js, inline styles for React's `style` attributes,
  no framing), plus `nosniff`, `strict-origin-when-cross-origin`, `X-Frame-Options` and a
  `Permissions-Policy`. `vite preview` serves the same headers, so the Playwright tests run under the
  real policy. If you add a third-party script or font, the CSP has to allow it.
- **Models get retired.** The original default, `llama-3.3-70b-versatile`, stopped working when Groq
  retired it, and every request failed with "model does not exist". If that happens again, set
  `GROQ_MODEL` to a current model.
- **Rotate your key** if it has ever been pasted somewhere it shouldn't be. Deploying makes it live.
- **Watch for invisible characters in the key.** The first deploy failed with a generic "could not
  reach the model provider". The real cause was in the function logs: `Cannot convert argument to a
  ByteString because the character at index 7 has a value of 65279`. That's U+FEFF, a byte-order mark,
  prefixed onto the key by the shell pipeline that set the variable. `Bearer ` is seven characters, so
  index 7 was the first character of the key. `backend/groq.js` now strips BOMs, wrapping quotes and
  whitespace from the key (and `rateLimit.js` does the same for the Upstash values), and logs the
  underlying `cause` of any transport failure.
