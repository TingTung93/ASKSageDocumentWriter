import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../release/index.html', import.meta.url), 'utf8');
const failures = [];

if (!/<script>(?:.|\n)+<\/script>\s*<\/body>/i.test(html)) {
  failures.push('classic inline entry script is missing or is not at the end of <body>');
}
if (/<script\b[^>]*\btype=["']module["']/i.test(html)) {
  failures.push('module entry script found');
}
if (/<script\b[^>]*\bsrc=/i.test(html)) {
  failures.push('external JavaScript found');
}
if (/<link\b[^>]*\brel=["']stylesheet["']/i.test(html)) {
  failures.push('external stylesheet found');
}
if (/\b(?:authorization|api[-_]?key)\s*[:=]\s*["'][^"']{8,}/i.test(html)) {
  failures.push('credential-like literal found');
}

if (failures.length) {
  throw new Error(`Release artifact verification failed:\n- ${failures.join('\n- ')}`);
}

console.log(`release/index.html passed single-file and credential-shape checks (${html.length} bytes)`);
