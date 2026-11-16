import { defineConfig } from 'vite';

// Relative Basis, damit das Spiel unter https://<user>.github.io/<repo>/ läuft
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 6000,
    assetsInlineLimit: 0,
  },
  server: { host: true },
});
