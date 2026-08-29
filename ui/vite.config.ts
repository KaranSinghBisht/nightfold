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
    alias: { '@shared': shared },
  },
  server: {
    fs: { allow: [resolve(__dirname), shared] },
  },
});
