import { describe, it, expect, vi } from 'vitest';
import { extractFileLocally, cacheExtractedText } from './local_extract';
import type { ProjectContextFile, ProjectRecord } from '../db/schema';
import { db } from '../db/schema';

vi.mock('../db/schema', () => ({
  db: {
    projects: { put: vi.fn() }
  }
}));

vi.mock('../template/parser', () => ({
  extractParagraphs: vi.fn().mockImplementation(async (bytes) => {
    if (bytes.size === 123) return [{ text: 'Mocked DOCX text' }];
    if (bytes.size === 0) return [];
    return [{ text: 'Default DOCX text' }];
  })
}));

describe('local_extract', () => {
  describe('extractFileLocally', () => {
    it('extracts DOCX files correctly', async () => {
      const file = {
        kind: 'file',
        id: '1',
        filename: 'test.docx',
        mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        bytes: new Blob(['a'.repeat(123)]), // size 123
      } as unknown as ProjectContextFile;
      const res = await extractFileLocally(file);
      expect(res.text).toBe('Mocked DOCX text');
      expect(res.error).toBeUndefined();
    });

    it('returns error if DOCX contains no text', async () => {
      const file = {
        kind: 'file',
        id: '2',
        filename: 'empty.docx',
        mime_type: '',
        bytes: new Blob([]), // size 0
      } as unknown as ProjectContextFile;
      const res = await extractFileLocally(file);
      expect(res.text).toBeNull();
      expect(res.error).toContain('DOCX parsed but contained no text');
    });

    it('extracts plain text files correctly (utf-8)', async () => {
      const file = {
        kind: 'file',
        id: '3',
        filename: 'test.txt',
        mime_type: 'text/plain',
        bytes: new Blob([new TextEncoder().encode('Hello txt')]),
      } as unknown as ProjectContextFile;
      
      // We need to mock Blob.arrayBuffer for testing environment if it doesn't have it
      file.bytes.arrayBuffer = async () => new TextEncoder().encode('Hello txt').buffer;

      const res = await extractFileLocally(file);
      expect(res.text).toBe('Hello txt');
      expect(res.error).toBeUndefined();
    });

    it('returns error for unsupported file type', async () => {
      const file = {
        kind: 'file',
        id: '4',
        filename: 'image.png',
        mime_type: 'image/png',
        bytes: new Blob(['binary']),
      } as unknown as ProjectContextFile;
      const res = await extractFileLocally(file);
      expect(res.text).toBeNull();
      expect(res.error).toContain('local extraction not supported');
    });
  });

  describe('cacheExtractedText', () => {
    it('updates text and writes to DB', async () => {
      const file = { kind: 'file', id: 'f1', filename: 'test', bytes: new Blob() } as any;
      const project = {
        id: 'p1',
        name: 'proj',
        created_at: '',
        updated_at: '',
        context_items: [file]
      } as unknown as ProjectRecord;
      
      vi.mocked(db.projects.put).mockResolvedValueOnce('p1');
      await cacheExtractedText(project, 'f1', 'new extracted text');
      
      expect(file.extracted_text).toBe('new extracted text');
      expect(db.projects.put).toHaveBeenCalledWith(expect.objectContaining({
        id: 'p1',
        context_items: expect.arrayContaining([expect.objectContaining({ extracted_text: 'new extracted text' })])
      }));
    });
    
    it('does nothing if text is same', async () => {
      const file = { kind: 'file', id: 'f1', extracted_text: 'same text', filename: 'test', bytes: new Blob() } as any;
      const project = {
        id: 'p2',
        name: 'proj2',
        created_at: '',
        updated_at: '',
        context_items: [file]
      } as unknown as ProjectRecord;
      
      vi.mocked(db.projects.put).mockClear();
      await cacheExtractedText(project, 'f1', 'same text');
      
      expect(db.projects.put).not.toHaveBeenCalled();
    });
  });
});
