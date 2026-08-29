import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// The table imports the SAME betting and dealer modules the test suites verify,
// rather than a UI-local copy. One source of truth: if a rule changes, the
// tests and the table change together.
const shared = resolve(__dirname, '..', 'src');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': shared,
      // The shared modules live outside ui/, so their bare imports resolve
      // against the ROOT node_modules — which a deploy that only installs ui/
      // does not have. Point the one package they need at ui's own copy, so
      // the build does not depend on the Midnight SDK being installed too.
      '@noble/hashes': resolve(__dirname, 'node_modules', '@noble/hashes'),
    },
  },
  server: {
    fs: { allow: [resolve(__dirname), shared] },
  },
});
