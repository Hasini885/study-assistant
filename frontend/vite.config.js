import 'dotenv/config'; // so a custom PORT in .env reaches the proxy target below
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');

// `vite preview` serves the production build with the same security headers
// Vercel adds (CSP and friends), so the end-to-end test runs under the real
// policy and a CSP that breaks the app fails a test instead of production.
const vercelHeaders = Object.fromEntries(
  JSON.parse(readFileSync(path.join(repoRoot, 'vercel.json'), 'utf8'))
    .headers.flatMap((rule) => rule.headers)
    .map(({ key, value }) => [key, value])
);

// The browser never talks to Groq directly. It calls /api/* on the Vite dev
// server, which proxies to the backend process that holds the API key.
export default defineConfig({
  // The app lives in frontend/, but the build output goes to dist/ at the repo
  // root, which is what Vercel is configured to publish.
  root: here,
  build: {
    outDir: path.join(repoRoot, 'dist'),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      // The study-set schema is shared with the backend, which owns it.
      '@contract': path.join(repoRoot, 'backend', 'shared'),
    },
  },
  plugins: [react()],
  // Frontend unit and component tests. Backend tests run under `node --test`.
  test: {
    include: ['tests/**/*.test.{js,jsx}'],
    environment: 'jsdom',
    setupFiles: ['tests/setup.js'],
  },
  preview: {
    port: 4173,
    headers: vercelHeaders,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.PORT || 8787}`,
        changeOrigin: true,
      },
    },
  },
});
