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
    alias: [
      { find: '@shared', replacement: shared },
      // The shared modules live outside ui/, so their bare imports resolve
      // against the ROOT node_modules — which a deploy that only installs ui/
      // does not have. Point the ONE specifier they use at ui's own copy.
      //
      // Exact match, not a prefix. Aliasing the whole package captured viem's
      // imports too, and viem wants @noble/hashes v1 subpaths (ripemd160,
      // sha256) that do not exist in the v2 layout — it ships its own nested
      // copy for exactly this reason, and a prefix alias hijacked it.
      {
        find: /^@noble\/hashes\/sha2\.js$/,
        replacement: resolve(__dirname, 'node_modules', '@noble', 'hashes', 'sha2.js'),
      },
    ],
  },
  server: {
    fs: { allow: [resolve(__dirname), shared] },
  },
});
