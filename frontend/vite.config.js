import 'dotenv/config'; // so a custom PORT in .env reaches the proxy target below
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');

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
