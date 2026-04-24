// Extracted from Co-Writer.html — loaded via <script type="text/babel" src>.
// Components are attached to window for cross-file sharing.

// ── DOCX export ───────────────────────────────────────────────
async function buildAndDownloadDocx(doc) {
  if (!window.docx) { alert('docx.js not loaded'); return; }
  const { Document, Packer, Paragraph, HeadingLevel, TextRun, Footer, PageNumber, AlignmentType } = window.docx;
  const sections = (window.SECTIONS || []).filter(s => s.status !== 'queued');

  const children = [
    new Paragraph({ text: doc.title || 'Untitled', heading: HeadingLevel.TITLE }),
    new Paragraph({ children: [new TextRun({ text: doc.subtitle || '', italics: true, color: '666666' })] }),
    new Paragraph({ text: '' }),
  ];

  for (const s of sections) {
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [
        new TextRun({ text: `${s.num}  `, bold: true }),
        new TextRun({ text: s.title, bold: true }),
      ],
    }));
    const body = (window.DRAFT_BODIES && window.DRAFT_BODIES[s.id]) || [`[§${s.num} ${s.title} — draft pending]`];
    for (const para of body) {
      children.push(new Paragraph({ children: [new TextRun({ text: para })] }));
    }
    children.push(new Paragraph({ text: '' }));
  }

  const d = new Document({
    creator: 'Ask Sage Co-Writer',
    title: doc.title || 'Draft',
    sections: [{
      properties: {},
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: 'Page ' }), new TextRun({ children: [PageNumber.CURRENT] })],
          })],
        }),
      },
      children,
    }],
  });
  const blob = await Packer.toBlob(d);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = (doc.title || 'draft').replace(/[^\w\-]+/g,'_') + '.docx';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
}
window.buildAndDownloadDocx = buildAndDownloadDocx;
