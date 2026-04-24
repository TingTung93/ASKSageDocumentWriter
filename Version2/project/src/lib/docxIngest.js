// Extracted from Co-Writer.html — loaded via <script type="text/babel" src>.
// Components are attached to window for cross-file sharing.

// ── Template ingest ───────────────────────────────────────────
async function parseDocxTemplate(file) {
  if (!window.mammoth) throw new Error('mammoth.js not loaded');
  const arrayBuffer = await file.arrayBuffer();
  const result = await window.mammoth.convertToHtml({ arrayBuffer });
  const html = result.value;
  // Extract headings + placeholder patterns like {{FIELD_NAME}} or [FIELD NAME]
  const container = document.createElement('div');
  container.innerHTML = html;
  const sections = [];
  let curNum = 1;
  container.querySelectorAll('h1, h2, h3').forEach(h => {
    const text = h.textContent.trim();
    if (!text) return;
    const m = text.match(/^(\d+(?:\.\d+)*)\s+(.+)$/);
    const num = m ? m[1] : String(curNum++);
    const title = m ? m[2] : text;
    sections.push({ num, title, level: Number(h.tagName[1]) });
  });
  const phMatches = [...html.matchAll(/\{\{\s*([A-Z_][A-Z0-9_]*)\s*\}\}|\[\s*([A-Z][A-Z0-9 _]{2,})\s*\]/g)];
  const placeholders = [...new Set(phMatches.map(m => (m[1] || m[2]).trim()))].slice(0, 30);
  return { sections, placeholders, rawHtml: html, wordCount: html.replace(/<[^>]+>/g,' ').split(/\s+/).filter(Boolean).length };
}
window.parseDocxTemplate = parseDocxTemplate;
