/**
 * generate-fixtures.ts
 * Generates 4 synthetic DOCX test fixtures using JSZip (raw XML).
 * Run: npx tsx src/test/fixtures/generate-fixtures.ts
 */
import JSZip from 'jszip';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const R_NS = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const WP_NS = 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function para(text: string, opts: { style?: string; bold?: boolean; tab?: boolean; align?: string } = {}): string {
  const pPr = opts.style
    ? `<w:pPr><w:pStyle w:val="${opts.style}"/>${opts.align ? `<w:jc w:val="${opts.align}"/>` : ''}</w:pPr>`
    : opts.align ? `<w:pPr><w:jc w:val="${opts.align}"/></w:pPr>` : '';
  if (opts.tab) {
    return `<w:p>${pPr}<w:r><w:t xml:space="preserve">Before Tab</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>After Tab — ${text}</w:t></w:r></w:p>`;
  }
  if (opts.bold) {
    return `<w:p>${pPr}<w:r><w:rPr><w:b/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;
  }
  return `<w:p>${pPr}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

function headingPara(level: number, text: string): string {
  return `<w:p><w:pPr><w:pStyle w:val="Heading${level}"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

function sdt(tag: string, alias: string, content: string): string {
  return `<w:sdt>
    <w:sdtPr><w:tag w:val="${tag}"/><w:alias w:val="${alias}"/></w:sdtPr>
    <w:sdtContent><w:p><w:r><w:t>[${content}]</w:t></w:r></w:p></w:sdtContent>
  </w:sdt>`;
}

function tableRow(cells: string[]): string {
  const tcs = cells.map(c => `<w:tc><w:p><w:r><w:t>${c}</w:t></w:r></w:p></w:tc>`).join('');
  return `<w:tr>${tcs}</w:tr>`;
}

function table(rows: string[][]): string {
  return `<w:tbl>
    <w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="9360" w:type="dxa"/></w:tblPr>
    <w:tblGrid><w:gridCol w:w="4680"/><w:gridCol w:w="4680"/></w:tblGrid>
    ${rows.map(r => tableRow(r)).join('\n')}
  </w:tbl>`;
}

function makeContentTypes(extras: { part: string; type: string }[]): string {
  const base = [
    { ext: 'rels', ct: 'application/vnd.openxmlformats-package.relationships+xml' },
    { ext: 'xml', ct: 'application/xml' },
  ];
  const defaults = base.map(b => `<Default Extension="${b.ext}" ContentType="${b.ct}"/>`).join('\n');
  const overrides = [
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>`,
    `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>`,
    `<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>`,
    ...extras.map(e => `<Override PartName="${e.part}" ContentType="${e.type}"/>`),
  ].join('\n');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
${defaults}
${overrides}
</Types>`;
}

function makeRootRels(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
}

function makeDocumentRels(extras: { id: string; type: string; target: string }[]): string {
  const base = [
    { id: 'rId1', type: 'styles', target: 'styles.xml' },
    { id: 'rId2', type: 'settings', target: 'settings.xml' },
  ];
  const all = [
    ...base.map(r => `<Relationship Id="${r.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${r.type}" Target="${r.target}"/>`),
    ...extras.map(e => `<Relationship Id="${e.id}" Type="${e.type}" Target="${e.target}"/>`),
  ];
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${all.join('\n')}
</Relationships>`;
}

function makeStyles(extraStyles: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W_NS} xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:jc w:val="left"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/><w:jc w:val="left"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="Heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="Heading 3"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="22"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="BodyText"><w:name w:val="Body Text"/><w:basedOn w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="TableGrid"><w:name w:val="Table Grid"/></w:style>
  <w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="Caption"/><w:basedOn w:val="Normal"/><w:rPr><w:i/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:sz w:val="48"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/></w:pPr></w:style>
  <w:style w:type="character" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/></w:style>
  ${extraStyles.join('\n')}
</w:styles>`;
}

function makeSettings(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings ${W_NS}>
  <w:defaultTabStop w:val="720"/>
  <w:compat/>
</w:settings>`;
}

function makeNumbering(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering ${W_NS}>
  <w:abstractNum w:abstractNumId="0">
    <w:multiLevelType w:val="multilevel"/>
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2."/><w:lvlJc w:val="left"/></w:lvl>
    <w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="lowerRoman"/><w:lvlText w:val="%3."/><w:lvlJc w:val="left"/></w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="1">
    <w:multiLevelType w:val="multilevel"/>
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val=""/><w:lvlJc w:val="left"/></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;
}

function headerXml(paragraphs: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr ${W_NS} ${R_NS} ${WP_NS}>
  ${paragraphs.join('\n')}
</w:hdr>`;
}

function footerXml(paragraphs: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr ${W_NS} ${R_NS} ${WP_NS}>
  ${paragraphs.join('\n')}
</w:ftr>`;
}

function sectPr(opts: {
  headerRef?: string;
  footerRef?: string;
  extraRefs?: string;
  orient?: string;
} = {}): string {
  const orient = opts.orient ?? 'portrait';
  const h = opts.headerRef ? `<w:headerReference w:type="default" r:id="${opts.headerRef}"/>` : '';
  const f = opts.footerRef ? `<w:footerReference w:type="default" r:id="${opts.footerRef}"/>` : '';
  const extra = opts.extraRefs ?? '';
  return `<w:sectPr>
    ${h}${f}${extra}
    <w:pgSz w:w="12240" w:h="15840" w:orient="${orient}"/>
    <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
  </w:sectPr>`;
}

function documentXml(bodyContent: string, sp: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W_NS} ${R_NS} ${WP_NS}>
  <w:body>
    ${bodyContent}
    ${sp}
  </w:body>
</w:document>`;
}

async function buildDocx(files: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) {
    zip.file(path, content);
  }
  const buf = await zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  return new Uint8Array(buf);
}

// ---------------------------------------------------------------------------
// Fixture 1: synthetic-memo.docx
// ---------------------------------------------------------------------------

async function generateMemo(): Promise<Uint8Array> {
  const paragraphs: string[] = [
    para('MEMORANDUM FOR RECORD', { style: 'Title', align: 'center' }),
    para('SUBJECT: Synthetic Test Memorandum for Automated Fixture Validation', { bold: true }),
    para(''),
    para('1. PURPOSE. This memorandum provides a synthetic test fixture for automated unit tests of the DOCX parser and writer components.', { style: 'BodyText' }),
    para('2. BACKGROUND. The document writer application parses Office Open XML documents to extract structural metadata including paragraph styles, formatting, and content controls.', { style: 'BodyText' }),
    // Tab paragraph - required by test
    para('DATE\tApril 2026', { tab: true }),
    para('FROM\tTest Suite Generator', { tab: true }),
    para('TO\tAutomated CI Pipeline', { tab: true }),
    para('3. APPLICABILITY. This policy applies to all test cases that exercise the DOCX round-trip writer functionality.', { style: 'BodyText' }),
    para('4. RESPONSIBILITIES.', { bold: true }),
    para('a. The testing infrastructure shall load this fixture and assert on its structural properties.', { style: 'ListParagraph' }),
    para('b. The parser shall correctly identify tab elements within paragraph runs and expose them as tab characters in the output text.', { style: 'ListParagraph' }),
    para('c. The writer shall preserve all structural elements during round-trip operations without modification to untouched paragraphs.', { style: 'ListParagraph' }),
    para('d. Content control tags shall be surfaced on the paragraph objects that reside within the structured document tag.', { style: 'ListParagraph' }),
    para('5. PROCEDURES.', { bold: true }),
    para('a. Load the fixture bytes from disk using readFileSync.', { style: 'ListParagraph' }),
    para('b. Parse the fixture using the parseDocx function exported from the parser module.', { style: 'ListParagraph' }),
    para('c. Assert that the returned paragraphs array contains the expected structural elements.', { style: 'ListParagraph' }),
    para('d. Apply document edit operations using exportEditedDocx or applyDocumentEdits.', { style: 'ListParagraph' }),
    para('e. Re-parse the resulting DOCX bytes and assert on the post-edit state.', { style: 'ListParagraph' }),
    para('6. FORMATTING STANDARDS.', { bold: true }),
    para('The document shall conform to standard memorandum formatting requirements including proper margins, font sizes, and paragraph spacing as defined in the applicable style guide.', { style: 'BodyText' }),
    para('All headings shall be formatted in bold using the appropriate paragraph style as defined in the styles.xml component of the DOCX package.', { style: 'BodyText' }),
    para('7. COORDINATION. This document was coordinated with the automated test harness and does not require signatures from actual government personnel.', { style: 'BodyText' }),
    para('8. EFFECTIVE DATE. This synthetic fixture is effective immediately upon generation and shall remain valid for the duration of the test suite lifecycle.', { style: 'BodyText' }),
    para('9. SUPERSESSION. This document supersedes all prior synthetic test fixtures for the policy memorandum template type.', { style: 'BodyText' }),
    para('10. AUTHORITY. The generator script has authority to create this fixture under the scope of the automated test infrastructure project.', { style: 'BodyText' }),
    para('11. POINTS OF CONTACT. For questions regarding this synthetic fixture, contact the development team responsible for maintaining the DOCX parser module.', { style: 'BodyText' }),
    para('12. ENCLOSURES. No enclosures are attached to this synthetic memorandum. All referenced materials exist only within the test fixture context.', { style: 'BodyText' }),
    para('// SIGNED //', { align: 'right' }),
    para('Test Fixture Generator', { align: 'right' }),
    para('Automated Systems Division', { align: 'right' }),
    para('ANNEX A: ADDITIONAL PROVISIONS', { bold: true }),
    para('A-1. This annex contains supplementary provisions that extend the main body of the memorandum for testing purposes.', { style: 'BodyText' }),
    para('A-2. Paragraph text that spans more than thirty characters will be used in the split and delete test operations.', { style: 'BodyText' }),
  ];

  const body = paragraphs.join('\n');

  const headerParas = [
    para('SYNTHETIC MEMORANDUM HEADER', { bold: true }),
    para('DISTRIBUTION: UNLIMITED — TEST FIXTURE ONLY'),
  ];

  const footerParas = [
    para('Page [PAGE] of [NUMPAGES]'),
    para('Synthetic Test Fixture — Not a Real Government Document'),
  ];

  const files: Record<string, string> = {
    '[Content_Types].xml': makeContentTypes([
      { part: '/word/numbering.xml', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml' },
      { part: '/word/header1.xml', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml' },
      { part: '/word/footer1.xml', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml' },
    ]),
    '_rels/.rels': makeRootRels(),
    'word/_rels/document.xml.rels': makeDocumentRels([
      { id: 'rId3', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering', target: 'numbering.xml' },
      { id: 'rId4', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header', target: 'header1.xml' },
      { id: 'rId5', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer', target: 'footer1.xml' },
    ]),
    'word/document.xml': documentXml(body, sectPr({ headerRef: 'rId4', footerRef: 'rId5' })),
    'word/styles.xml': makeStyles([]),
    'word/numbering.xml': makeNumbering(),
    'word/settings.xml': makeSettings(),
    'word/header1.xml': headerXml(headerParas),
    'word/footer1.xml': footerXml(footerParas),
  };

  return buildDocx(files);
}

// ---------------------------------------------------------------------------
// Fixture 2: synthetic-publication.docx
// ---------------------------------------------------------------------------

async function generatePublication(): Promise<Uint8Array> {
  const sdts = [
    sdt('doc_number', 'Document Number', 'Enter Document Number'),
    sdt('pub_title', 'Publication Title', 'Enter Publication Title'),
    sdt('effective_date', 'Effective Date', 'Enter Effective Date'),
    sdt('supersedes', 'Supersedes', 'Enter Superseded Document'),
    sdt('applicability', 'Applicability', 'Enter Applicability Statement'),
    sdt('subject', 'Subject', 'Enter Subject'),
    sdt('issuing_authority', 'Issuing Authority', 'Enter Issuing Authority'),
    sdt('page_count', 'Page Count', 'Enter Page Count'),
    sdt('classification', 'Classification', 'Enter Classification'),
    sdt('distribution', 'Distribution Statement', 'Enter Distribution Statement'),
    sdt('poc_name', 'POC Name', 'Enter Point of Contact Name'),
    sdt('poc_phone', 'POC Phone', 'Enter POC Phone Number'),
  ];

  const sections = [
    [headingPara(1, 'CHAPTER 1: PURPOSE AND SCOPE')],
    [
      para('1.1. PURPOSE. This publication establishes policies and procedures for the management of automated test fixtures within the document generation system.', { style: 'BodyText' }),
      para('1.2. SCOPE. This publication applies to all automated testing activities that exercise DOCX parsing and editing functionality within the test suite infrastructure.', { style: 'BodyText' }),
      para('1.3. AUTHORITY. The authority for this publication derives from the requirements of the test framework and the need for reproducible, controlled test fixtures.', { style: 'BodyText' }),
      para('1.4. RESPONSIBILITIES. The development team shall maintain these synthetic fixtures in a state that accurately represents the structural features required by each test case.', { style: 'BodyText' }),
    ],
    [headingPara(1, 'CHAPTER 2: POLICY')],
    [
      headingPara(2, '2.1 General Policy Requirements'),
      para('This chapter defines the general policy requirements for document template management. Templates shall conform to OOXML specification requirements and shall include all required structural elements.', { style: 'BodyText' }),
      para('The parser component shall extract all structural metadata from templates including paragraph styles, content controls, headers, footers, numbering definitions, and page setup parameters.', { style: 'BodyText' }),
      headingPara(2, '2.2 Content Control Requirements'),
      para('Content controls shall be tagged with machine-readable identifiers to enable programmatic access to metadata fill regions within the document template.', { style: 'BodyText' }),
      para('Each content control shall specify an alias attribute that provides a human-readable label for the associated fill region.', { style: 'BodyText' }),
      headingPara(2, '2.3 Style Requirements'),
      para('Documents shall define named paragraph styles in the styles.xml component of the DOCX package. Heading styles shall be defined using the standard Heading1 through Heading9 style identifiers.', { style: 'BodyText' }),
      para('Style definitions shall include formatting properties such as font size, bold weight, alignment, and indentation as appropriate for each style type.', { style: 'BodyText' }),
    ],
    [headingPara(1, 'CHAPTER 3: PROCEDURES')],
    [
      headingPara(2, '3.1 Template Creation'),
      para('3.1.1. Templates shall be created using the approved document generator tools and shall conform to the structural requirements defined in this publication.', { style: 'BodyText' }),
      para('3.1.2. All required content controls shall be present in the template before it is approved for use in the test suite.', { style: 'BodyText' }),
      para('3.1.3. The template shall be validated by running the full test suite against the generated fixture before committing to version control.', { style: 'BodyText' }),
      headingPara(2, '3.2 Template Validation'),
      para('3.2.1. Template validation shall include parsing verification, round-trip identity testing, and structural property assertion.', { style: 'BodyText' }),
      para('3.2.2. The validation process shall verify that all content controls are correctly tagged and that heading-bounded sections are properly delimited.', { style: 'BodyText' }),
      headingPara(3, '3.2.1 Parsing Validation Steps'),
      para('a. Load fixture bytes from disk.', { style: 'ListParagraph' }),
      para('b. Invoke parseDocx with appropriate metadata.', { style: 'ListParagraph' }),
      para('c. Assert paragraph count is within expected range.', { style: 'ListParagraph' }),
      para('d. Assert at least one heading-bounded section exists.', { style: 'ListParagraph' }),
    ],
    [headingPara(1, 'CHAPTER 4: REFERENCES')],
    [
      para('4.1. The following references apply to this publication:', { style: 'BodyText' }),
      para('a. OOXML Specification (ISO/IEC 29500)', { style: 'ListParagraph' }),
      para('b. Vitest Testing Framework Documentation', { style: 'ListParagraph' }),
      para('c. JSZip Library Documentation', { style: 'ListParagraph' }),
      para('d. Project test suite README', { style: 'ListParagraph' }),
    ],
    [headingPara(1, 'CHAPTER 5: DEFINITIONS')],
    [
      para('5.1. CONTENT CONTROL. A structured document tag (SDT) element that defines a fill region within a DOCX template.', { style: 'BodyText' }),
      para('5.2. HEADING-BOUNDED SECTION. A body region delimited by heading-styled paragraphs in the document body.', { style: 'BodyText' }),
      para('5.3. ROUND-TRIP. The process of parsing a DOCX, applying edits, and re-parsing to verify structural integrity.', { style: 'BodyText' }),
      para('5.4. NAMED STYLE. A paragraph or character style definition in the styles.xml component of a DOCX package.', { style: 'BodyText' }),
      para('5.5. PAGE SETUP. The collection of page size, orientation, and margin settings defined in the sectPr element.', { style: 'BodyText' }),
    ],
  ];

  const bodyContent = [
    ...sdts,
    ...sections.flat(),
  ].join('\n');

  const headerParas = [
    para('SYNTHETIC PUBLICATION HEADER', { bold: true }),
    para('FOR TESTING PURPOSES ONLY'),
  ];
  const footerParas = [
    para('DISTRIBUTION STATEMENT A: Approved for public release; distribution is unlimited.'),
    para('Synthetic Test Fixture — Page [PAGE]'),
  ];
  const footer2Paras = [
    para('SYNTHETIC PUBLICATION — CHAPTER FOOTER'),
  ];

  const files: Record<string, string> = {
    '[Content_Types].xml': makeContentTypes([
      { part: '/word/numbering.xml', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml' },
      { part: '/word/header1.xml', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml' },
      { part: '/word/footer1.xml', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml' },
      { part: '/word/footer2.xml', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml' },
    ]),
    '_rels/.rels': makeRootRels(),
    'word/_rels/document.xml.rels': makeDocumentRels([
      { id: 'rId3', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering', target: 'numbering.xml' },
      { id: 'rId4', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header', target: 'header1.xml' },
      { id: 'rId5', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer', target: 'footer1.xml' },
      { id: 'rId6', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer', target: 'footer2.xml' },
    ]),
    'word/document.xml': documentXml(bodyContent, sectPr({
      headerRef: 'rId4',
      footerRef: 'rId5',
      extraRefs: `<w:footerReference w:type="first" r:id="rId6"/>`,
    })),
    'word/styles.xml': makeStyles([]),
    'word/numbering.xml': makeNumbering(),
    'word/settings.xml': makeSettings(),
    'word/header1.xml': headerXml(headerParas),
    'word/footer1.xml': footerXml(footerParas),
    'word/footer2.xml': footerXml(footer2Paras),
  };

  return buildDocx(files);
}

// ---------------------------------------------------------------------------
// Fixture 3: synthetic-pws.docx (200+ paragraphs)
// ---------------------------------------------------------------------------

async function generatePws(): Promise<Uint8Array> {
  // Build 200+ paragraphs across structured PWS sections
  const paragraphs: string[] = [];

  // Section 1
  paragraphs.push(headingPara(1, 'SECTION 1: GENERAL INFORMATION'));
  paragraphs.push(para('1.1. TITLE OF REQUIREMENT. Information Technology Support Services for Test Infrastructure Management.', { style: 'BodyText' }));
  paragraphs.push(para('1.2. BACKGROUND. The Government requires information technology support services to maintain and enhance the automated test infrastructure supporting the document generation system.', { style: 'BodyText' }));
  paragraphs.push(para('1.3. SCOPE. The contractor shall provide all personnel, equipment, tools, facilities, supervision, and other items and non-personal services necessary to perform information technology support services.', { style: 'BodyText' }));
  paragraphs.push(para('1.4. PERIOD OF PERFORMANCE. The period of performance shall be one (1) base year with four (4) one-year option periods.', { style: 'BodyText' }));

  // Section 2
  paragraphs.push(headingPara(1, 'SECTION 2: APPLICABLE DOCUMENTS'));
  for (let i = 1; i <= 10; i++) {
    paragraphs.push(para(`2.${i}. Reference Document ${i}: Applicable regulation or standard for test infrastructure operations.`, { style: 'ListParagraph' }));
  }

  // Section 3
  paragraphs.push(headingPara(1, 'SECTION 3: REQUIREMENTS'));
  paragraphs.push(headingPara(2, '3.1 Program Management'));
  for (let i = 1; i <= 15; i++) {
    paragraphs.push(para(`3.1.${i}. The contractor shall provide program management support including task ${i} of the program management plan requirements as defined herein.`, { style: 'BodyText' }));
  }

  paragraphs.push(headingPara(2, '3.2 Technical Support Services'));
  for (let i = 1; i <= 15; i++) {
    paragraphs.push(para(`3.2.${i}. The contractor shall perform technical support task ${i} in accordance with the technical standards and procedures specified in this performance work statement.`, { style: 'BodyText' }));
  }

  paragraphs.push(headingPara(2, '3.3 System Administration'));
  for (let i = 1; i <= 15; i++) {
    paragraphs.push(para(`3.3.${i}. System administration task ${i}: The contractor shall configure, maintain, and support the automated systems and infrastructure components required for test suite execution.`, { style: 'BodyText' }));
  }

  paragraphs.push(headingPara(2, '3.4 Help Desk Support'));
  for (let i = 1; i <= 10; i++) {
    paragraphs.push(para(`3.4.${i}. Help desk support requirement ${i}: The contractor shall respond to user requests within the timeframe specified in the performance requirements summary.`, { style: 'BodyText' }));
  }

  paragraphs.push(headingPara(2, '3.5 Software Development and Maintenance'));
  for (let i = 1; i <= 15; i++) {
    paragraphs.push(para(`3.5.${i}. Software development task ${i}: The contractor shall develop, test, and maintain software components as specified in the technical requirements.`, { style: 'BodyText' }));
  }

  // Section 4: Deliverables
  paragraphs.push(headingPara(1, 'SECTION 4: DELIVERABLES'));
  paragraphs.push(headingPara(2, '4.1 Deliverable Requirements List'));

  const tbl = table([
    ['Deliverable', 'Frequency', 'Submit To', 'Due Date'],
    ['Monthly Status Report', 'Monthly', 'Contracting Officer Representative', 'NLT 5th of following month'],
    ['Program Management Plan', 'Once', 'Contracting Officer', 'Within 30 days of award'],
    ['Quality Control Plan', 'Once', 'Contracting Officer', 'Within 30 days of award'],
    ['Technical Approach Document', 'Annually', 'Contracting Officer Representative', 'Annually by anniversary date'],
    ['Incident Reports', 'As required', 'COR', 'Within 24 hours of incident'],
    ['After Action Reports', 'As required', 'COR', 'Within 5 business days'],
  ]);
  paragraphs.push(tbl);

  // More body paragraphs to push well over 200
  paragraphs.push(headingPara(1, 'SECTION 5: PERSONNEL REQUIREMENTS'));
  for (let i = 1; i <= 20; i++) {
    paragraphs.push(para(`5.${i}. The contractor shall ensure all personnel assigned to this contract meet the minimum qualifications and experience requirements specified for labor category ${i}.`, { style: 'BodyText' }));
  }

  paragraphs.push(headingPara(1, 'SECTION 6: GOVERNMENT-FURNISHED PROPERTY AND SERVICES'));
  for (let i = 1; i <= 10; i++) {
    paragraphs.push(para(`6.${i}. Government-furnished item ${i}: The Government will provide access to the specified systems and facilities necessary for contract performance.`, { style: 'BodyText' }));
  }

  paragraphs.push(headingPara(1, 'SECTION 7: CONTRACTOR FURNISHED ITEMS AND SERVICES'));
  for (let i = 1; i <= 10; i++) {
    paragraphs.push(para(`7.${i}. The contractor shall furnish all items not specifically identified as government-furnished, including item category ${i}.`, { style: 'BodyText' }));
  }

  paragraphs.push(headingPara(1, 'SECTION 8: SPECIFIC TASKS'));
  for (let i = 1; i <= 20; i++) {
    paragraphs.push(para(`8.${i}. Specific task ${i}: The contractor shall perform all work associated with task area ${i} as described in this section and in accordance with applicable technical standards.`, { style: 'BodyText' }));
  }

  paragraphs.push(headingPara(1, 'SECTION 9: PERFORMANCE REQUIREMENTS SUMMARY'));
  for (let i = 1; i <= 15; i++) {
    paragraphs.push(para(`9.${i}. Performance standard ${i}: Acceptable quality level and surveillance method for performance objective ${i} of the contract.`, { style: 'BodyText' }));
  }

  paragraphs.push(headingPara(1, 'SECTION 10: SECURITY REQUIREMENTS'));
  for (let i = 1; i <= 10; i++) {
    paragraphs.push(para(`10.${i}. Security requirement ${i}: The contractor shall comply with all applicable security regulations and requirements as specified in the DD Form 254 and applicable directives.`, { style: 'BodyText' }));
  }

  paragraphs.push(headingPara(1, 'SECTION 11: PLACE OF PERFORMANCE'));
  paragraphs.push(para('11.1. PRIMARY PLACE OF PERFORMANCE. Work under this contract shall be performed at the designated Government facility.', { style: 'BodyText' }));
  paragraphs.push(para('11.2. REMOTE WORK. Remote work may be authorized by the Contracting Officer Representative on a task-by-task basis.', { style: 'BodyText' }));
  paragraphs.push(para('11.3. TRAVEL. The contractor may be required to travel in performance of this contract. Travel will be reimbursed in accordance with the Federal Travel Regulation.', { style: 'BodyText' }));

  // Content control
  const pwsSdts = [
    sdt('contract_number', 'Contract Number', 'Enter Contract Number'),
    sdt('task_order_number', 'Task Order Number', 'Enter Task Order Number'),
    sdt('program_office', 'Program Office', 'Enter Program Office'),
  ];

  const bodyContent = [...pwsSdts, ...paragraphs].join('\n');

  const files: Record<string, string> = {
    '[Content_Types].xml': makeContentTypes([
      { part: '/word/numbering.xml', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml' },
    ]),
    '_rels/.rels': makeRootRels(),
    'word/_rels/document.xml.rels': makeDocumentRels([
      { id: 'rId3', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering', target: 'numbering.xml' },
    ]),
    'word/document.xml': documentXml(bodyContent, sectPr()),
    'word/styles.xml': makeStyles([]),
    'word/numbering.xml': makeNumbering(),
    'word/settings.xml': makeSettings(),
  };

  return buildDocx(files);
}

// ---------------------------------------------------------------------------
// Fixture 4: synthetic-mrr.docx
// ---------------------------------------------------------------------------

async function generateMrr(): Promise<Uint8Array> {
  const paragraphs: string[] = [
    para('MARKET RESEARCH REPORT', { style: 'Title', align: 'center' }),
    para(''),
    headingPara(1, '1. BACKGROUND AND PURPOSE'),
    para('1.1. This market research report documents the market research conducted in accordance with FAR Part 10 to determine the availability and commercial nature of the required supplies and services.', { style: 'BodyText' }),
    para('1.2. The purpose of this research is to identify qualified sources capable of meeting the Government\'s requirements and to determine appropriate acquisition strategy.', { style: 'BodyText' }),
    headingPara(1, '2. DESCRIPTION OF REQUIREMENT'),
    para('2.1. The Government requires information technology support services for test infrastructure management and automated document generation systems.', { style: 'BodyText' }),
    para('2.2. The requirement includes program management, technical support, system administration, help desk support, and software development services.', { style: 'BodyText' }),
    headingPara(1, '3. MARKET RESEARCH METHODS'),
    para('3.1. The following methods were used to conduct this market research:', { style: 'BodyText' }),
    para('a. Review of existing Government contracts and vehicles.', { style: 'ListParagraph' }),
    para('b. Review of industry databases and vendor catalogs.', { style: 'ListParagraph' }),
    para('c. Request for Information (RFI) issued to potential sources.', { style: 'ListParagraph' }),
    para('d. Review of prior acquisition files for similar requirements.', { style: 'ListParagraph' }),
    headingPara(1, '4. MARKET RESEARCH RESULTS'),
    para('4.1. The market research identified multiple qualified sources capable of meeting the Government\'s requirements.', { style: 'BodyText' }),
    para('4.2. The requirement is available in the commercial marketplace with standard commercial terms and conditions.', { style: 'BodyText' }),
    headingPara(1, '5. CONCLUSIONS AND RECOMMENDATIONS'),
    para('5.1. Based on the market research conducted, the contracting officer recommends proceeding with a competitive acquisition using full and open competition.', { style: 'BodyText' }),
    para('5.2. The market research supports a determination that the requirement is commercial in nature and that adequate competition exists.', { style: 'BodyText' }),
    para('5.3. The recommended contract type is a Firm-Fixed-Price contract for the base year with four option years.', { style: 'BodyText' }),
    para(''),
    para('Prepared by: Test Fixture Generator', { align: 'right' }),
    para('Date: April 2026', { align: 'right' }),
  ];

  const bodyContent = paragraphs.join('\n');

  const files: Record<string, string> = {
    '[Content_Types].xml': makeContentTypes([]),
    '_rels/.rels': makeRootRels(),
    'word/_rels/document.xml.rels': makeDocumentRels([]),
    'word/document.xml': documentXml(bodyContent, sectPr()),
    'word/styles.xml': makeStyles([]),
    'word/settings.xml': makeSettings(),
  };

  return buildDocx(files);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const out = __dirname;

  const fixtures = [
    { name: 'synthetic-memo.docx', gen: generateMemo },
    { name: 'synthetic-publication.docx', gen: generatePublication },
    { name: 'synthetic-pws.docx', gen: generatePws },
    { name: 'synthetic-mrr.docx', gen: generateMrr },
  ];

  for (const { name, gen } of fixtures) {
    const bytes = await gen();
    const outPath = resolve(out, name);
    writeFileSync(outPath, bytes);
    console.log(`Generated: ${outPath} (${bytes.byteLength} bytes)`);
  }

  console.log('\nAll fixtures generated successfully.');
}

main().catch((e) => {
  console.error('Error generating fixtures:', e);
  process.exit(1);
});
