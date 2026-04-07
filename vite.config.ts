/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Single-file build. The entire app — JS, CSS, assets — is inlined into
// dist/index.html. This is the only file the user needs on a target machine.
//
// Why single-file: the deployment target is a DHA workstation where the
// user cannot run npm/node and cannot install or run a local web server.
// A single self-contained HTML file can be downloaded from GitHub (raw),
// emailed, dropped on a share, or git-pulled, and then opened directly
// from the filesystem in any browser. HashRouter (in src/App.tsx) makes
// routing work without server-side URL rewriting.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: './',
  build: {
    // Output to release/ rather than the conventional dist/ because the
    // user's global .gitignore excludes dist/ and we need this artifact
    // tracked in git so it can be pulled to the DHA workstation.
    outDir: 'release',
    emptyOutDir: true,
    // Single-file builds don't need source maps and they can't be inlined.
    sourcemap: false,
    // Allow the inlined bundle to grow without warnings; we expect a fat
    // single HTML file by design.
    chunkSizeWarningLimit: 5000,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
