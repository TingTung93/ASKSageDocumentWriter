/**
 * Freeform DOCX assembler — builds a clean Word document from
 * DraftParagraph[] without requiring a template DOCX skeleton.
 * Uses standard Word styles (Heading1–4, Normal, ListBullet, etc.)
 * and produces a valid .docx file via JSZip.
 */

import JSZip from 'jszip';
import type { DraftParagraph } from '../draft/types';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// ─── XML namespaces ──────────────────────────────────────────────

const NS = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  mc: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
};

// ─── Style ID mapping ────────────────────────────────────────────

function styleIdForParagraph(dp: DraftParagraph): string {
  const level = dp.level ?? 0;
  switch (dp.role) {
    case 'heading':
      // Heading1 through Heading4
      return `Heading${Math.min(level + 1, 4)}`;
    case 'body':
    case 'definition':
      return 'Normal';
    case 'bullet':
      return 'ListBullet';
    case 'step':
      return 'ListNumber';
    case 'note':
    case 'caution':
    case 'warning':
      return 'Normal';
    case 'quote':
      return 'Quote';
    case 'table_row':
      return 'Normal';
    default:
      return 'Normal';
  }
}

// ─── XML builders ────────────────────────────────────────────────

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildRunXml(text: string, bold?: boolean, italic?: boolean): string {
  let rPr = '';
  if (bold || italic) {
    rPr = '<w:rPr>';
    if (bold) rPr += '<w:b/>';
    if (italic) rPr += '<w:i/>';
    rPr += '</w:rPr>';
  }
  // Split on newlines to handle multi-line text with <w:br/>
  const parts = text.split('\n');
  let tElements = '';
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) tElements += '<w:br/>';
    tElements += `<w:t xml:space="preserve">${escapeXml(parts[i])}</w:t>`;
  }
  return `<w:r>${rPr}${tElements}</w:r>`;
}

function buildParagraphXml(dp: DraftParagraph): string {
  const styleId = styleIdForParagraph(dp);
  const level = dp.level ?? 0;

  // Paragraph properties
  let pPr = `<w:pPr><w:pStyle w:val="${styleId}"/>`;

  // Page break before
  if (dp.page_break_before) {
    pPr += '<w:pageBreakBefore/>';
  }

  // Indentation for non-list roles
  if (level > 0 && dp.role !== 'bullet' && dp.role !== 'step' && dp.role !== 'heading') {
    const leftTwips = level * 720; // 0.5 inch per level
    pPr += `<w:ind w:left="${leftTwips}"/>`;
  }

  // Numbering for bullet/step roles
  if ((dp.role === 'bullet' || dp.role === 'step') && level > 0) {
    // Use indentation for nested list items in the simple assembler
    const leftTwips = level * 360; // 0.25 inch per sub-level
    pPr += `<w:ind w:left="${leftTwips}"/>`;
  }

  pPr += '</w:pPr>';

  // Runs
  let runs = '';
  if (dp.runs && dp.runs.length > 0) {
    for (const run of dp.runs) {
      runs += buildRunXml(run.text, run.bold, run.italic);
    }
  } else {
    // Prefix for note/caution/warning roles
    if (dp.role === 'note') {
      runs += buildRunXml('NOTE: ', true);
    } else if (dp.role === 'caution') {
      runs += buildRunXml('CAUTION: ', true);
    } else if (dp.role === 'warning') {
      runs += buildRunXml('WARNING: ', true);
    }
    runs += buildRunXml(dp.text);
  }

  return `<w:p>${pPr}${runs}</w:p>`;
}

function buildTableXml(rows: DraftParagraph[]): string {
  if (rows.length === 0) return '';

  // Determine column count from first row
  const colCount = Math.max(...rows.map((r) => r.cells?.length ?? 0), 1);

  let xml = '<w:tbl>';

  // Table properties — simple auto-fit with borders
  xml += '<w:tblPr>';
  xml += '<w:tblStyle w:val="TableGrid"/>';
  xml += '<w:tblW w:w="0" w:type="auto"/>';
  xml += `<w:tblBorders>
    <w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/>
    <w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>
    <w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/>
    <w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>
    <w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/>
    <w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/>
  </w:tblBorders>`;
  xml += '<w:tblLook w:val="04A0"/>';
  xml += '</w:tblPr>';

  // Grid columns
  xml += '<w:tblGrid>';
  for (let c = 0; c < colCount; c++) {
    xml += '<w:gridCol/>';
  }
  xml += '</w:tblGrid>';

  // Rows
  for (const row of rows) {
    xml += '<w:tr>';
    if (row.is_header) {
      xml += '<w:trPr><w:tblHeader/></w:trPr>';
    }
    const cells = row.cells ?? [row.text];
    for (let c = 0; c < colCount; c++) {
      const cellText = c < cells.length ? cells[c] : '';
      const bold = row.is_header;
      xml += `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>`;
      xml += `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr>${buildRunXml(cellText, bold)}</w:p>`;
      xml += '</w:tc>';
    }
    xml += '</w:tr>';
  }

  xml += '</w:tbl>';
  return xml;
}

// ─── Document XML ────────────────────────────────────────────────

function buildDocumentXml(paragraphs: DraftParagraph[]): string {
  let body = '';
  let i = 0;

  while (i < paragraphs.length) {
    const dp = paragraphs[i];

    // Collect consecutive table rows into a single table
    if (dp.role === 'table_row') {
      const tableRows: DraftParagraph[] = [];
      while (i < paragraphs.length && paragraphs[i].role === 'table_row') {
        tableRows.push(paragraphs[i]);
        i++;
      }
      body += buildTableXml(tableRows);
      continue;
    }

    body += buildParagraphXml(dp);
    i++;
  }

  // Section properties: Letter, 1-inch margins
  const sectPr = `<w:sectPr>
    <w:pgSz w:w="12240" w:h="15840"/>
    <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
  </w:sectPr>`;

  // Only declare namespaces we actually use. Previously this element
  // set mc:Ignorable="w14 wp14" without declaring xmlns:w14 /
  // xmlns:wp14 — Word flagged the document as containing unreadable
  // content when opening. We don't emit any w14/wp14 extensions, so
  // the whole mc:Ignorable machinery can go.
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${NS.w}" xmlns:r="${NS.r}">
  <w:body>${body}${sectPr}</w:body>
</w:document>`;
}

// ─── Styles XML ──────────────────────────────────────────────────

function buildStylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${NS.w}">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Calibri" w:eastAsia="Calibri" w:hAnsi="Calibri" w:cs="Times New Roman"/>
        <w:sz w:val="24"/>
        <w:szCs w:val="24"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr>
        <w:spacing w:after="160" w:line="259" w:lineRule="auto"/>
      </w:pPr>
    </w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:keepNext/><w:spacing w:before="160" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading4">
    <w:name w:val="heading 4"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:keepNext/><w:spacing w:before="120" w:after="60"/><w:outlineLvl w:val="3"/></w:pPr>
    <w:rPr><w:b/><w:i/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="ListBullet">
    <w:name w:val="List Bullet"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="ListNumber">
    <w:name w:val="List Number"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Quote">
    <w:name w:val="Quote"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:ind w:left="720" w:right="720"/></w:pPr>
    <w:rPr><w:i/></w:rPr>
  </w:style>
  <w:style w:type="table" w:default="1" w:styleId="TableNormal">
    <w:name w:val="Normal Table"/>
    <w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr>
  </w:style>
  <w:style w:type="table" w:styleId="TableGrid">
    <w:name w:val="Table Grid"/>
    <w:basedOn w:val="TableNormal"/>
    <w:tblPr><w:tblBorders>
      <w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/>
      <w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>
      <w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/>
      <w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>
      <w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/>
      <w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/>
    </w:tblBorders></w:tblPr>
  </w:style>
</w:styles>`;
}

// ─── Supporting OOXML parts ──────────────────────────────────────

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const WORD_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

// ─── Public API ──────────────────────────────────────────────────

export interface AssembleFreeformResult {
  blob: Blob;
  paragraph_count: number;
}

/**
 * Build a complete .docx file from DraftParagraph[]. No template
 * skeleton needed — produces a clean document with standard Word
 * styles (Heading1–4, Normal, ListBullet, ListNumber, Quote).
 */
export async function assembleFreeformDocx(
  paragraphs: DraftParagraph[],
): Promise<AssembleFreeformResult> {
  const zip = new JSZip();

  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.file('_rels/.rels', ROOT_RELS);
  zip.file('word/_rels/document.xml.rels', WORD_RELS);
  zip.file('word/document.xml', buildDocumentXml(paragraphs));
  zip.file('word/styles.xml', buildStylesXml());

  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: DOCX_MIME,
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  return { blob, paragraph_count: paragraphs.length };
}
