import { describe, expect, it } from 'vitest';
import { renderContextBlock, suggestDatasetName } from './context';
import type { ProjectContextItem } from '../db/schema';

describe('renderContextBlock — notes only', () => {
  it('returns null when there are no items', () => {
    expect(renderContextBlock([])).toBeNull();
  });

  it('returns null when only files are present (files reach the LLM via dataset/RAG)', () => {
    const items: ProjectContextItem[] = [
      {
        kind: 'file',
        id: 'f1',
        filename: 'pws.docx',
        mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size_bytes: 50_000,
        extracted_chars: 12_000,
        embedding_id: 'emb_abc',
        trained_into_dataset: 'asd_test',
        created_at: '2026-04-08T12:00:00.000Z',
      },
    ];
    expect(renderContextBlock(items)).toBeNull();
  });

  it('renders a notes-only block with role tags and timestamps', () => {
    const items: ProjectContextItem[] = [
      {
        kind: 'note',
        id: 'n1',
        role: 'user',
        text: 'Emphasize cybersecurity throughout.',
        created_at: '2026-04-08T12:00:00.000Z',
      },
      {
        kind: 'file',
        id: 'f1',
        filename: 'ignored.pdf',
        mime_type: 'application/pdf',
        size_bytes: 1024,
        extracted_chars: 500,
        trained_into_dataset: 'asd_test',
        created_at: '2026-04-08T12:00:00.000Z',
      },
    ];
    const block = renderContextBlock(items)!;
    expect(block).toContain('PROJECT CONTEXT NOTES');
    expect(block).toContain('Note (user');
    expect(block).toContain('Emphasize cybersecurity');
    // The file metadata must NOT leak into the notes block — files are
    // handled via RAG, not the prompt body.
    expect(block).not.toContain('ignored.pdf');
  });
});

describe('suggestDatasetName', () => {
  it('produces an asd_-prefixed slug from the project name', () => {
    expect(suggestDatasetName('Diasorin Liaison MDX Maintenance')).toBe(
      'asd_diasorin_liaison_mdx_maintenance',
    );
  });

  it('falls back to asd_project on degenerate input', () => {
    expect(suggestDatasetName('!!!')).toBe('asd_project');
  });

  it('caps the slug at a reasonable length', () => {
    const long = 'A'.repeat(200);
    const slug = suggestDatasetName(long);
    expect(slug.startsWith('asd_')).toBe(true);
    expect(slug.length).toBeLessThanOrEqual(44);
  });
});
