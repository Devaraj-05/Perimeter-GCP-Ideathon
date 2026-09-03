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
