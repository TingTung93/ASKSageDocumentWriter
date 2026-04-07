// parseDocx — main entry point for the OOXML template parser.
//
// Takes the raw bytes of a DOCX file and returns the structural half of
// a TemplateSchema (formatting, fill_regions, named styles, numbering).
// Performs zero LLM calls; everything here is deterministic OOXML
// extraction. The semantic half (intent, target_words, validation) is
// added by Phase 1b's Gemini Flash pass.

import JSZip from 'jszip';
import {
  PARSER_VERSION,
  SCHEMA_VERSION,
  type FormattingHalf,
  type HeaderFooterPart,
  type TemplateSchema,
} from '../types';
import { parseDocumentXml } from './document';
import { parseStylesXml } from './styles';
import { parseNumberingXml } from './numbering';
import { findContentControls } from './contentControls';
import { detectFillRegions } from './fillRegions';

export interface ParseDocxOptions {
  filename: string;
  /** IndexedDB key under which the original DOCX bytes are stored */
  docx_blob_id: string;
  /** Stable id for this template */
  id?: string;
  /** Display name; defaults to filename without extension */
  name?: string;
}

export interface ParseDocxResult {
  schema: TemplateSchema;
  /** The DOCX bytes wrapped as a Blob, ready to persist alongside the schema */
  docx_blob: Blob;
}

export async function parseDocx(
  bytes: ArrayBuffer | Uint8Array | Blob,
  opts: ParseDocxOptions,
): Promise<ParseDocxResult> {
  // JSZip accepts ArrayBuffer, Uint8Array, and Blob directly. Don't
  // round-trip through Blob.arrayBuffer() because jsdom (used by vitest)
  // doesn't implement that method on its Blob shim.
  let zipInput: ArrayBuffer | Uint8Array | Blob;
  let blob: Blob;
  if (bytes instanceof Blob) {
    blob = bytes;
    // In jsdom we can't convert Blob → ArrayBuffer, but JSZip can take
    // the Blob directly.
    zipInput = bytes;
  } else if (bytes instanceof Uint8Array) {
    zipInput = bytes;
    blob = makeBlob(bytes);
  } else {
    zipInput = bytes;
    blob = makeBlob(new Uint8Array(bytes));
  }
  const zip = await JSZip.loadAsync(zipInput);

  const documentXml = await zip.file('word/document.xml')?.async('string');
  if (!documentXml) {
    throw new Error('Not a valid DOCX: word/document.xml is missing');
  }

  const stylesXml = await zip.file('word/styles.xml')?.async('string');
  const numberingXml = await zip.file('word/numbering.xml')?.async('string');

  const docDom = parseXml(documentXml);
  const stylesDom = stylesXml ? parseXml(stylesXml) : null;
  const numberingDom = numberingXml ? parseXml(numberingXml) : null;

  const styles = stylesDom
    ? parseStylesXml(stylesDom)
    : { default_font: { family: null, size_pt: null }, named_styles: [] };
  const numbering = numberingDom ? parseNumberingXml(numberingDom) : [];
  const document = parseDocumentXml(docDom);
  const contentControls = findContentControls(docDom);

  const fillRegions = detectFillRegions({
    paragraphs: document.paragraphs,
    contentControls,
    namedStyles: styles.named_styles,
  });

  const headers = listHeaderFooterParts(zip, 'header');
  const footers = listHeaderFooterParts(zip, 'footer');

  const formatting: FormattingHalf = {
    page_setup: document.page_setup,
    default_font: styles.default_font,
    theme: null,
    named_styles: styles.named_styles,
    numbering_definitions: numbering,
    headers,
    footers,
  };

  const schema: TemplateSchema = {
    $schema: SCHEMA_VERSION,
    id: opts.id ?? cryptoRandomId(),
    name: opts.name ?? stripExtension(opts.filename),
    version: 1,
    source: {
      filename: opts.filename,
      ingested_at: new Date().toISOString(),
      structural_parser_version: PARSER_VERSION,
      semantic_synthesizer: null,
      docx_blob_id: opts.docx_blob_id,
    },
    formatting,
    metadata_fill_regions: fillRegions.metadata,
    sections: fillRegions.body,
    style: {
      voice: null,
      tense: null,
      register: null,
      jargon_policy: null,
      banned_phrases: [],
    },
  };

  return { schema, docx_blob: blob };
}

function parseXml(xml: string): Document {
  const dom = new DOMParser().parseFromString(xml, 'text/xml');
  // DOMParser doesn't throw on malformed XML; it embeds an error element.
  const errs = dom.getElementsByTagName('parsererror');
  if (errs.length > 0) {
    throw new Error(`XML parse error: ${errs[0]!.textContent ?? 'unknown'}`);
  }
  return dom;
}

function listHeaderFooterParts(zip: JSZip, kind: 'header' | 'footer'): HeaderFooterPart[] {
  const parts: HeaderFooterPart[] = [];
  zip.forEach((relativePath) => {
    if (relativePath.match(new RegExp(`^word/${kind}\\d+\\.xml$`))) {
      parts.push({ type: 'default', part: relativePath });
    }
  });
  return parts;
}

function stripExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, '');
}

function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `tpl_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
}

function makeBlob(u8: Uint8Array): Blob {
  // Wrap in a fresh ArrayBuffer copy so the Blob is detached from any
  // upstream Buffer (Node) backing memory.
  const copy = new Uint8Array(u8.byteLength);
  copy.set(u8);
  try {
    return new Blob([copy]);
  } catch {
    // jsdom's Blob constructor sometimes objects to typed arrays; fall
    // back to a stub that's "good enough" for tests (the schema viewer
    // path uses real browser Blobs at runtime).
    return { size: copy.byteLength } as unknown as Blob;
  }
}
