import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';
import { parseDocx } from '../src/lib/template/parser';
import { assembleProjectDocx } from '../src/lib/export/assemble';
import { assembleFreeformDocx } from '../src/lib/freeform/assemble';
import type { TemplateRecord } from '../src/lib/db/schema';

const outputDir = process.argv[2] ?? resolve('release', 'acceptance');
await mkdir(outputDir, { recursive: true });
const dom = new JSDOM('');
Object.assign(globalThis, {
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  Node: dom.window.Node,
  Document: dom.window.Document,
  Element: dom.window.Element,
});

const fixtureName = 'synthetic-publication.docx';
const fixtureBytes = await readFile(resolve('src', 'test', 'fixtures', fixtureName));
const parsed = await parseDocx(new Uint8Array(fixtureBytes), {
  filename: fixtureName,
  docx_blob_id: 'acceptance-template',
});
const template: TemplateRecord = {
  id: 'acceptance-template',
  name: 'Synthetic publication acceptance fixture',
  filename: fixtureName,
  ingested_at: new Date(0).toISOString(),
  // JSZip's Node path accepts Uint8Array directly; the application stores a
  // browser Blob at runtime, but both represent the exact same DOCX bytes.
  docx_bytes: new Uint8Array(fixtureBytes) as unknown as Blob,
  schema_json: parsed.schema,
};
const templateOutput = await assembleProjectDocx({
  template,
  draftedBySectionId: new Map(),
});
async function outputBytes(value: Blob): Promise<Uint8Array> {
  if (typeof value.arrayBuffer === 'function') {
    return new Uint8Array(await value.arrayBuffer());
  }
  return value as unknown as Uint8Array;
}
await writeFile(
  resolve(outputDir, 'template-roundtrip.docx'),
  await outputBytes(templateOutput.blob),
);

const resumableSections = parsed.schema.sections.filter(
  (section) => section.fill_region.kind === 'heading_bounded',
).slice(0, 2);
if (resumableSections.length < 2) {
  throw new Error('Synthetic publication fixture needs two heading-bounded sections for resumed-run acceptance');
}
const resumedDrafts = new Map([
  [
    resumableSections[0].id,
    [
      {
        role: 'body' as const,
        text: 'This section was completed before the synthetic interruption and must not be replayed.',
        runs: [
          { text: 'Completed before interruption. ', bold: true },
          { text: 'Preserved without another provider call.', italic: true },
        ],
      },
      { role: 'bullet' as const, text: 'Previously accepted content remains in the exported document.' },
    ],
  ],
  [
    resumableSections[1].id,
    [
      {
        role: 'body' as const,
        text: 'This section was completed after the synthetic run resumed from its first incomplete stage.',
        page_break_before: true,
      },
      {
        role: 'table_row' as const,
        text: 'Stage | Result',
        cells: ['Stage', 'Result'],
        is_header: true,
      },
      {
        role: 'table_row' as const,
        text: 'Resume | Passed',
        cells: ['Resume', 'Passed'],
      },
    ],
  ],
]);
const resumedOutput = await assembleProjectDocx({
  template,
  draftedBySectionId: resumedDrafts,
});
if (resumedOutput.total_failed > 0 || resumedOutput.total_assembled !== 2) {
  throw new Error(`Resumed-run fixture did not assemble both sections: ${JSON.stringify(resumedOutput.section_results)}`);
}
await writeFile(
  resolve(outputDir, 'template-resumed-run.docx'),
  await outputBytes(resumedOutput.blob),
);

const freeformOutput = await assembleFreeformDocx([
  { role: 'heading', level: 0, text: 'Purpose' },
  { role: 'body', text: 'This synthetic document validates the released freeform assembler.' },
  { role: 'heading', level: 0, text: 'Findings' },
  { role: 'bullet', text: 'Accepted revisions remain durable after reload.' },
  { role: 'table_row', text: 'Gate | Result', cells: ['Gate', 'Result'], is_header: true },
  { role: 'table_row', text: 'OOXML | Pass', cells: ['OOXML', 'Pass'] },
  { role: 'page_break', text: '' },
  { role: 'heading', level: 0, text: 'References' },
  { role: 'body', text: 'Synthetic fixtures only.' },
]);
await writeFile(
  resolve(outputDir, 'freeform-revised.docx'),
  await outputBytes(freeformOutput.blob),
);

type PreservationRow = {
  fixture: string;
  zip_valid: boolean;
  document_xml_valid: boolean;
  headers: boolean;
  footers: boolean;
  styles: boolean;
  drawings: boolean;
  lists: boolean;
  tables: boolean;
  rich_runs: boolean;
  page_breaks: boolean;
  word_desktop: 'pending';
  libreoffice_desktop: 'pending';
};

async function inspectFixture(fixture: string): Promise<PreservationRow> {
  const bytes = await readFile(resolve(outputDir, fixture));
  const zip = await JSZip.loadAsync(bytes);
  const documentXml = await zip.file('word/document.xml')?.async('string');
  if (!documentXml) throw new Error(`${fixture} is missing word/document.xml`);
  const parsedDocument = new dom.window.DOMParser().parseFromString(documentXml, 'application/xml');
  const parserError = parsedDocument.getElementsByTagName('parsererror').length > 0;
  const names = Object.keys(zip.files);
  return {
    fixture,
    zip_valid: true,
    document_xml_valid: !parserError,
    headers: names.some((name) => /^word\/header\d+\.xml$/.test(name)),
    footers: names.some((name) => /^word\/footer\d+\.xml$/.test(name)),
    styles: names.includes('word/styles.xml'),
    drawings: /<(?:w:)?drawing\b/.test(documentXml),
    lists: /<(?:w:)?numPr\b|<(?:w:)?pStyle\b[^>]*(?:w:)?val="List/.test(documentXml),
    tables: /<(?:w:)?tbl\b/.test(documentXml),
    rich_runs: /<(?:w:)?rPr\b/.test(documentXml),
    page_breaks: /<(?:w:)?pageBreakBefore\b|<(?:w:)?br\b[^>]*(?:w:)?type="page"/.test(documentXml),
    word_desktop: 'pending',
    libreoffice_desktop: 'pending',
  };
}

const fixtureNames = [
  'template-roundtrip.docx',
  'template-resumed-run.docx',
  'freeform-revised.docx',
];
const preservationMatrix = await Promise.all(fixtureNames.map(inspectFixture));
await writeFile(
  resolve(outputDir, 'preservation-matrix.json'),
  `${JSON.stringify({
    generated_at: new Date().toISOString(),
    note: 'Automated OOXML checks are evidence only for package structure. Desktop fields remain pending until opened manually.',
    fixtures: preservationMatrix,
  }, null, 2)}\n`,
);

console.log(outputDir);
