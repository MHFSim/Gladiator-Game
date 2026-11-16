import { defineConfig } from 'vite';

// Relative Basis, damit das Spiel unter https://<user>.github.io/<repo>/ läuft
const version = new Date().toISOString().slice(0, 16).replace('T', ' ');

export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 6000,
    assetsInlineLimit: 0,
  },
  server: { host: true },
});
