import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('./package.json');

export default defineConfig({
  plugins: [react()],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    outDir: 'dist',
  },
  server: {
    port: 5173,
    // Large local-only folders stall the dev server's first responses while the watcher indexes them.
    watch: {
      ignored: ['**/testspace/**', '**/website/**', '**/release/**', '**/coverage/**'],
    },
  },
});
