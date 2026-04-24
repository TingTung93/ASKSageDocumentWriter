import { describe, it, expect } from 'vitest';
import { parseMarkdownToParagraphs } from './drafter';

describe('parseMarkdownToParagraphs', () => {
  it('handles headings, bullets, and body paragraphs', () => {
    const md = '# Top\n\n## Section\n\n- first bullet\n- second bullet\n\nBody paragraph text.';
    const out = parseMarkdownToParagraphs(md);
    expect(out).toEqual([
      { role: 'heading', text: 'Top', level: 0 },
      { role: 'heading', text: 'Section', level: 1 },
      { role: 'bullet', text: 'first bullet', level: 0 },
      { role: 'bullet', text: 'second bullet', level: 0 },
      { role: 'body', text: 'Body paragraph text.' },
    ]);
  });

  it('parses numbered lists as steps', () => {
    const md = '1. First step\n2. Second step';
    const out = parseMarkdownToParagraphs(md);
    expect(out).toEqual([
      { role: 'step', text: 'First step', level: 0 },
      { role: 'step', text: 'Second step', level: 0 },
    ]);
  });

  it('parses pipe-delimited tables', () => {
    const md = '| Col A | Col B |\n| --- | --- |\n| 1 | 2 |';
    const out = parseMarkdownToParagraphs(md);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ role: 'table_row', is_header: true });
    expect(out[1]).toMatchObject({ role: 'table_row', is_header: false });
  });
});
