import 'dotenv/config'; // so a custom PORT in .env reaches the proxy target below
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The browser never talks to Groq directly. It calls /api/* on the Vite dev
// server, which proxies to the Express process that holds the API key.
export default defineConfig({
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
