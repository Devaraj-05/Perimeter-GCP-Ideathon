import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      /**
       * Local frontend against a real backend.
       *
       * The dashboard itself needs no proxy: journal history, entries and
       * saves go straight to Firestore from the client SDK, under the same
       * rules production enforces. Only /api/* — chat, ingest, repo scan,
       * GitHub — needs a server.
       *
       * Opt-in by env var rather than a hardcoded default, because the target
       * is PRODUCTION: anything ingested through this proxy is written to the
       * real Firestore and spends the real Gemini quota. A proxy that pointed
       * at production without being asked to would be a trap.
       *
       *   PERIMETER_API=https://perimeter-914890039877.asia-south1.run.app npx vite
       *
       * Firebase ID tokens are issued per project, not per origin, so a token
       * minted at localhost verifies against the deployed requireAuth exactly
       * as one minted at the run.app domain does.
       */
      proxy: process.env.PERIMETER_API
        ? {
            '/api': {
              target: process.env.PERIMETER_API,
              changeOrigin: true,
              secure: true,
            },
          }
        : undefined,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    // Rules tests need the Firestore emulator and live in tests/. Restricting
    // the default run to server/ means a bare `vitest run` cannot appear to
    // pass without one. Run those with `npm run test:rules`.
    test: {
      // src/ is included because INV-9 lives in a React component. Restricting
      // the run to server/ meant the renderer — the only control the server
      // cannot enforce, and the one the red team console tells judges is
      // "verified by the INV-9 renderer test" — had no runtime coverage at
      // all, and a test file added under src/ would have been silently
      // ignored rather than failing loudly.
      include: ['server/**/*.test.ts', 'src/**/*.test.{ts,tsx}'],
    },
  };
});
