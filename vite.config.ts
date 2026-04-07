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
// Strips type="module" + crossorigin from the inlined entry script AND
// moves it from <head> to just before </body>. Both steps are required:
//
//  1. Without stripping type="module", Chromium parses the script in a
//     module-script context and the DHA workstation's CORS check rejects
//     /server/* requests (see feedback memo + probe-module.html).
//
//  2. Without moving the script out of <head>, the now-classic inline
//     script runs SYNCHRONOUSLY at parse time — before <body> exists in
//     the DOM — so `document.getElementById('root')` returns null and
//     React can't mount. Module scripts have implicit defer semantics
//     that hid this; classic inline scripts do not, and `defer` is not
//     valid on inline scripts. The standard pre-defer pattern is to put
//     the script at the end of <body>, which is what we do here.
// MUST run AFTER vite-plugin-singlefile inlines the entry script body
// into the HTML asset. singlefile does that in `generateBundle`, not in
// `transformIndexHtml` — so we have to hook generateBundle ourselves
// with `order: 'post'` and patch the bundle's index.html source string
// in place.
//
// Two transformations:
//   1. Strip type="module" (and any crossorigin) from the entry script
//      tag so the browser parses it as a classic script. Required to
//      avoid the CORS preflight rejection on the DHA workstation.
//   2. Move the entry script from <head> to right before </body>. The
//      stripped classic script no longer has implicit defer semantics,
//      so it would otherwise execute synchronously at parse time —
//      before <body> and #root exist — and React would crash on mount.
const classicifyEntryScript = {
  name: 'asd-classicify-entry-script',
  generateBundle: {
    order: 'post' as const,
    handler(
      _options: unknown,
      bundle: Record<string, { type: string; source?: string | Uint8Array; fileName: string }>,
    ): void {
      for (const key of Object.keys(bundle)) {
        const asset = bundle[key];
        if (!asset || asset.type !== 'asset') continue;
        if (!asset.fileName.endsWith('.html')) continue;
        if (typeof asset.source !== 'string') continue;

        const html = asset.source;

        // Locate the inlined entry script tag deterministically using
        // indexOf, NOT a regex. The bundle body contains substrings
        // like `</script` (e.g. inside React's "<script><\/script>"
        // string literal). A non-greedy regex on `</script>` cannot
        // distinguish the real closing tag from those substrings.
        // indexOf for the literal opening tag finds the unique entry
        // script reliably.
        const openMarker = '<script type="module" crossorigin>';
        const altOpenMarker = '<script type="module">';
        let openIdx = html.indexOf(openMarker);
        let openLen = openMarker.length;
        if (openIdx === -1) {
          openIdx = html.indexOf(altOpenMarker);
          openLen = altOpenMarker.length;
        }
        if (openIdx === -1) {
          // eslint-disable-next-line no-console
          console.warn(
            `[asd-classicify] no entry script tag found in ${asset.fileName}; skipping`,
          );
          continue;
        }

        // The closing tag is the LAST </script> in the file. Use
        // lastIndexOf because the bundle body may legitimately contain
        // </script substrings as JS string literals (escaped or not),
        // but the only REAL </script> in the document is the one that
        // closes our inlined entry. Searching from the end avoids any
        // ambiguity introduced by content inside the bundle.
        const closeIdx = html.lastIndexOf('</script>');
        if (closeIdx === -1 || closeIdx < openIdx) {
          // eslint-disable-next-line no-console
          console.warn(
            `[asd-classicify] no closing </script> after open at ${openIdx} in ${asset.fileName}; skipping`,
          );
          continue;
        }
        const closeLen = '</script>'.length;
        const scriptBody = html.slice(openIdx + openLen, closeIdx);

        // Remove the original tag (open through close) by slicing around
        // it. Then locate </body> and INSERT the new classic <script>
        // there using slice + concat — NEVER String.prototype.replace
        // with a replacement string built from bundle content. The
        // bundle contains `$` characters (template literals like
        // `^word/${t}\.xml$`) and String.prototype.replace interprets
        // sequences like `$\`` (dollar-backtick) in the REPLACEMENT
        // string as "the portion of the input before the match". That
        // injects the HTML <head> into the middle of our script body
        // and corrupts the bundle. This is exactly what produced the
        // "Unexpected token '<'" parse failure on the previous build.
        const before = html.slice(0, openIdx);
        const after = html.slice(closeIdx + closeLen);
        const noScript = before + after;
        const bodyCloseIdx = noScript.indexOf('</body>');
        const classicOpen = '<script>';
        const classicClose = '</script>';
        let out: string;
        if (bodyCloseIdx === -1) {
          out = noScript + classicOpen + scriptBody + classicClose;
        } else {
          out =
            noScript.slice(0, bodyCloseIdx) +
            classicOpen +
            scriptBody +
            classicClose +
            '\n' +
            noScript.slice(bodyCloseIdx);
        }
        asset.source = out;
        // eslint-disable-next-line no-console
        console.log(
          `[asd-classicify] ${asset.fileName}: ${scriptBody.length} bytes of script body moved from <head> to end of <body>`,
        );
      }
    },
  },
};

export default defineConfig({
  plugins: [react(), viteSingleFile(), classicifyEntryScript],
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
