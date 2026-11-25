/**
 * Local development API server.
 *
 * Exists for one non-negotiable reason: the Groq API key must never reach the
 * browser. Vite proxies /api/* here; this process talks to Groq and returns a
 * validated study set.
 *
 * In production on Vercel these same routes are served by the serverless
 * functions in `api/`. Both call straight into `backend/pipeline.js`, so this
 * file is only transport — no logic lives here.
 */

import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import {
  buildGenerateRequest,
  buildRefineRequest,
  errorResponse,
  handleStudySetRequest,
  healthPayload,
} from './pipeline.js';
import { streamStudySet, wantsEventStream } from './sse.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8787;

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => res.json(healthPayload()));

app.post('/api/study-set', (req, res) => run(req, res, buildGenerateRequest));

app.post('/api/refine', (req, res) => run(req, res, buildRefineRequest));

async function run(req, res, build) {
  // If the user hits "cancel" or navigates away, stop the upstream call too.
  //
  // This listens on `res`, not `req`: since Node 16 the request stream emits
  // 'close' as soon as its body has been read, so aborting from there would
  // cancel every single request the moment express.json() finished parsing.
  // `res` emits 'close' when the response is done *or* the socket died, and
  // `writableFinished` tells the two apart.
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });

  // The socket address, not X-Forwarded-For: with no trusted proxy in front,
  // that header is whatever the client wants it to be.
  const ip = req.ip ?? req.socket.remoteAddress;

  if (wantsEventStream(req.headers)) {
    await streamStudySet({ res, body: req.body, ip, build, signal: controller.signal });
    return;
  }

  try {
    const result = await handleStudySetRequest({ body: req.body, ip, build, signal: controller.signal });
    if (res.writableEnded) return;
    res.json(result);
  } catch (error) {
    if (controller.signal.aborted || error?.code === 'client_aborted') return; // client is gone
    sendError(res, error);
  }
}

// Lets `NODE_ENV=production node backend/server.js` serve the built client too,
// for anywhere that isn't Vercel.
if (process.env.NODE_ENV === 'production') {
  const dist = path.join(__dirname, '..', 'dist');
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((error, req, res, next) => sendError(res, error));

function sendError(res, error) {
  const { status, headers, body } = errorResponse(error);
  res.set(headers).status(status).json(body);
}

app.listen(PORT, () => {
  console.log(`  API listening on http://localhost:${PORT}`);
  if (!process.env.GROQ_API_KEY) {
    console.warn('  ⚠  GROQ_API_KEY is not set — copy .env.example to .env and add your key.');
  }
});
