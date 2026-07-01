/**
 * Freeform DOCX assembler — builds a clean Word document from
 * DraftParagraph[] without requiring a template DOCX skeleton.
 * Uses standard Word styles (Heading1–4, Normal, ListBullet, etc.)
 * and produces a valid .docx file via JSZip.
 */

import JSZip from 'jszip';
import type { DraftParagraph } from '../draft/types';
import {
  normalizeDraftParagraphs,
} from '../docx/ir';
import { validateStructuredBlocks } from '../docx/validate';
import {
  buildParagraphElement,
  buildTableElement,
  createWordDocument,
  serializeXml,
  W_NS,
} from '../docx/ooxml';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// ─── Document XML ────────────────────────────────────────────────

type BuildParagraphInput = Parameters<typeof buildParagraphElement>[1];

function withFreeformAlertLabel(block: BuildParagraphInput): BuildParagraphInput {
  const label =
    block.role === 'note'
      ? 'NOTE: '
      : block.role === 'caution'
        ? 'CAUTION: '
        : block.role === 'warning'
          ? 'WARNING: '
          : null;

  if (!label || (block.runs && block.runs.length > 0)) return block;

  return {
    ...block,
    runs: [
      { text: label, bold: true },
      { text: block.text },
    ],
  };
}

function buildDocumentXml(paragraphs: DraftParagraph[]): string {
  const dom = createWordDocument();
  const body = dom.getElementsByTagNameNS(W_NS, 'body')[0];
  if (!body) throw new Error('internal error: created Word document has no body');

  const validation = validateStructuredBlocks(
    normalizeDraftParagraphs(paragraphs),
    { repair: true },
  );

  let nextParagraphGetsPageBreak = false;
  for (const block of validation.blocks) {
    if (block.kind === 'page_break') {
      nextParagraphGetsPageBreak = true;
      continue;
    }
    if (block.kind === 'table') {
      if (nextParagraphGetsPageBreak) {
        body.appendChild(
          buildParagraphElement(dom, {
            kind: 'paragraph',
            role: 'body',
            text: '',
            page_break_before: true,
          }),
        );
      }
      body.appendChild(buildTableElement(dom, block));
      nextParagraphGetsPageBreak = false;
      continue;
    }
    body.appendChild(
      buildParagraphElement(
        dom,
        withFreeformAlertLabel({
          ...block,
          page_break_before: nextParagraphGetsPageBreak,
        }),
      ),
    );
    nextParagraphGetsPageBreak = false;
  }

  const sectPr = dom.createElementNS(W_NS, 'w:sectPr');
  const pgSz = dom.createElementNS(W_NS, 'w:pgSz');
  pgSz.setAttributeNS(W_NS, 'w:w', '12240');
  pgSz.setAttributeNS(W_NS, 'w:h', '15840');
  sectPr.appendChild(pgSz);
  const pgMar = dom.createElementNS(W_NS, 'w:pgMar');
  pgMar.setAttributeNS(W_NS, 'w:top', '1440');
  pgMar.setAttributeNS(W_NS, 'w:right', '1440');
  pgMar.setAttributeNS(W_NS, 'w:bottom', '1440');
  pgMar.setAttributeNS(W_NS, 'w:left', '1440');
  pgMar.setAttributeNS(W_NS, 'w:header', '720');
  pgMar.setAttributeNS(W_NS, 'w:footer', '720');
  pgMar.setAttributeNS(W_NS, 'w:gutter', '0');
  sectPr.appendChild(pgMar);
  body.appendChild(sectPr);

  return serializeXml(dom);
}

// ─── Styles XML ──────────────────────────────────────────────────

function buildStylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W_NS}">
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
