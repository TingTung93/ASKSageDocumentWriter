/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Single-file build. The entire app — JS, CSS, assets — is inlined into
// release/index.html. This is the only file the user needs on a target
// machine.
//
// Why single-file: the deployment target is a DHA workstation where the
// user cannot run npm/node and cannot install or run a local web server.
// A single self-contained HTML file can be downloaded from GitHub (raw),
// emailed, dropped on a share, or git-pulled, and then opened directly
// from the filesystem in any browser. HashRouter (in src/App.tsx) makes
// routing work without server-side URL rewriting.
//
// Why CLASSIC SCRIPT (format: 'iife' + transformIndexHtml strip
// type="module"): on the DHA workstation, Chromium computes a different
// CORS context for module scripts on file:// origins than for classic
// scripts. Empirically verified on 2026-04-07: probe.html (classic
// inline script) reaches /server/* on api.asksage.health.mil; an
// otherwise byte-identical probe-module.html (only difference: script
// tag is type="module") gets a CORS preflight rejection in ~85ms for
// every /server/* call. Same browser, same network, same fetch options.
// We cannot change the browser's CORS policy, so we must avoid module
// scripts entirely. Rollup output format 'iife' produces a bundle with
// no top-level import/export syntax; the transformIndexHtml plugin
// strips type="module" from the inlined script tag so the browser
// parses it as a classic script.
const stripModuleScriptType = {
  name: 'asd-strip-module-script-type',
  transformIndexHtml(html: string): string {
    return html
      .replace(/<script\s+type="module"\s+crossorigin\s*/g, '<script ')
      .replace(/<script\s+type="module"\s*/g, '<script ');
  },
};

export default defineConfig({
  plugins: [react(), viteSingleFile(), stripModuleScriptType],
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
    // Modern es target is fine; the IIFE wrapper means the script doesn't
    // need module support to run.
    target: 'es2020',
    rollupOptions: {
      output: {
        // IIFE: wraps the entire bundle in (function(){...})() with no
        // top-level import/export, so it can be parsed as a classic
        // script. Single-file build is implied by inlineDynamicImports.
        format: 'iife',
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
