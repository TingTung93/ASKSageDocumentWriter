import { describe, expect, it } from 'vitest';
import {
  naiveChunkText,
  selectChunksForSection,
  renderSelectedChunks,
  NAIVE_CHUNK_SIZE_CHARS,
} from './chunk';
import type { BodyFillRegion } from '../template/types';
import type { ProjectContextFile, ReferenceChunk } from '../db/schema';

const ts = '2026-04-08T12:00:00.000Z';

function makeFile(id: string, filename: string, chunks?: ReferenceChunk[]): ProjectContextFile {
  return {
    kind: 'file',
    id,
    filename,
    mime_type: 'text/plain',
    size_bytes: 100,
    bytes: new Blob(['placeholder']),
    chunks,
    created_at: ts,
  };
}

function makeSection(id: string, name: string, intent?: string): BodyFillRegion {
  return {
    id,
    name,
    order: 0,
    required: true,
    fill_region: {
      kind: 'heading_bounded',
      heading_text: name,
      heading_style_id: null,
      body_style_id: null,
      anchor_paragraph_index: 0,
      end_anchor_paragraph_index: 5,
      permitted_roles: ['body'],
    },
    intent,
  };
}

describe('naiveChunkText', () => {
  it('returns the input as one chunk when shorter than the target size', () => {
    const text = 'short text';
    expect(naiveChunkText(text, 1000)).toEqual([text]);
  });

  it('splits long text on paragraph boundaries', () => {
    const para = 'a'.repeat(2000);
    const text = `${para}\n\n${para}\n\n${para}`;
    const chunks = naiveChunkText(text, 2500, 100);
    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk respects the target size with some slack for overlap.
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(2500 + 200);
  });

  it('hard-splits a single paragraph that blows past the target', () => {
    const huge = 'x'.repeat(20_000);
    const chunks = naiveChunkText(huge, 5_000, 200);
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(5_000);
  });

  it('returns an empty array for empty input', () => {
    expect(naiveChunkText('')).toEqual([]);
  });
});

describe('selectChunksForSection', () => {
  it('falls back to naive chunking when a file has no semantic chunks', () => {
    const file = makeFile('f1', 'pws.txt');
    const text =
      'The contractor shall provide periodic maintenance services for the equipment.\n\n' +
      'The point of contact for billing inquiries is the Government Contracting Officer.\n\n' +
      'All deliverables shall conform to the schedule in Section 5.';
    const selected = selectChunksForSection({
      files: [file],
      extractedById: new Map([['f1', text]]),
      section: makeSection('scope', 'Scope of Work', 'Define the contractor responsibilities for periodic maintenance.'),
      template_example: 'The contractor shall provide periodic maintenance services for the equipment.',
      size_class: 'body',
    });
    expect(selected.length).toBeGreaterThan(0);
    expect(selected[0]?.source_file).toBe('pws.txt');
  });

  it('prefers semantically chunked files when chunks are present', () => {
    const file = makeFile('f1', 'pws.docx', [
      {
        id: 'c1',
        title: 'Scope of Work',
        summary: 'Defines what the contractor is responsible for under the maintenance agreement.',
        text: 'The contractor shall provide periodic maintenance.',
      },
      {
        id: 'c2',
        title: 'Period of Performance',
        summary: 'States the date range during which the contractor will perform the work.',
        text: 'The period of performance is one base year plus four option years.',
      },
    ]);
    const selected = selectChunksForSection({
      files: [file],
      extractedById: new Map(),
      section: makeSection('scope', '1. Scope', 'Define the scope of contractor responsibility for maintenance.'),
      template_example: 'The contractor shall be responsible for the scope of maintenance work.',
      size_class: 'body',
    });
    // The Scope chunk should score higher than Period of Performance.
    expect(selected[0]?.chunk_id).toBe('c1');
  });

  it('honors the per-section character budget', () => {
    const big = 'a'.repeat(50_000);
    const file = makeFile('f1', 'big.txt', [
      { id: 'c1', title: 'one', summary: 'first chunk', text: big },
      { id: 'c2', title: 'two', summary: 'second chunk', text: big },
      { id: 'c3', title: 'three', summary: 'third chunk', text: big },
    ]);
    const selected = selectChunksForSection({
      files: [file],
      extractedById: new Map(),
      section: makeSection('s', 'Section', 'something'),
      size_class: 'body',
      budget_chars: 60_000,
    });
    // Two of three chunks would exceed the budget — only one should fit
    // (the highest-scoring is always included even if alone exceeds).
    expect(selected.length).toBeLessThan(3);
  });

  it('always selects the highest-scoring chunk even when it alone exceeds the budget', () => {
    const huge = 'a'.repeat(200_000);
    const file = makeFile('f1', 'huge.txt', [
      { id: 'big', title: 'big', summary: 'a huge chunk', text: huge },
    ]);
    const selected = selectChunksForSection({
      files: [file],
      extractedById: new Map(),
      section: makeSection('s', 'Section', 'a section'),
      size_class: 'body',
      budget_chars: 10_000,
    });
    expect(selected.length).toBe(1);
    expect(selected[0]?.chunk_id).toBe('big');
  });

  it('caps chunks for short sections at the size-class chunk count', () => {
    // Build five chunks that all match the section query so all five
    // would be eligible by score; the `short` size class should still
    // cap at 2 chunks.
    const chunks: ReferenceChunk[] = [];
    for (let i = 0; i < 5; i++) {
      chunks.push({
        id: `c${i}`,
        title: `Maintenance plan part ${i}`,
        summary: 'Defines maintenance procedures for the equipment.',
        text: `Maintenance procedure ${i}: perform inspections.`,
      });
    }
    const file = makeFile('f1', 'plan.docx', chunks);
    const selected = selectChunksForSection({
      files: [file],
      extractedById: new Map(),
      section: makeSection('m', 'Maintenance', 'Describe maintenance procedures.'),
      template_example: 'Maintenance procedures are performed monthly.',
      size_class: 'short',
    });
    expect(selected.length).toBeLessThanOrEqual(2);
  });

  it('handles zero files cleanly', () => {
    const selected = selectChunksForSection({
      files: [],
      extractedById: new Map(),
      section: makeSection('s', 'Section'),
      size_class: 'body',
    });
    expect(selected).toEqual([]);
  });
});

describe('renderSelectedChunks', () => {
  it('returns null when nothing is selected', () => {
    expect(renderSelectedChunks([], 0)).toBeNull();
  });

  it('renders a header with selected/total counts', () => {
    const block = renderSelectedChunks(
      [
        {
          source_file: 'pws.docx',
          source_file_id: 'f1',
          chunk_id: 'c1',
          title: 'Scope',
          text: 'verbatim scope text',
          score: 0.42,
        },
      ],
      5,
    )!;
    expect(block).toContain('1 of 5 chunks selected');
    expect(block).toContain('pws.docx');
    expect(block).toContain('Scope');
    expect(block).toContain('verbatim scope text');
    expect(block).toContain('relevance 0.420');
  });
});

describe('NAIVE_CHUNK_SIZE_CHARS', () => {
  it('is sized in the multi-thousand range so naive fallback isn\'t too granular', () => {
    expect(NAIVE_CHUNK_SIZE_CHARS).toBeGreaterThanOrEqual(2000);
  });
});
