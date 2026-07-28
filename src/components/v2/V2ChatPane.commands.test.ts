import { describe, expect, it } from 'vitest';
import { parseSlashCommand } from './V2ChatPane';

describe('V2 chat commands', () => {
  it('recognizes only implemented preset actions', () => {
    expect(parseSlashCommand('/tighten')).toEqual({ kind: 'preset', command: 'tighten' });
    expect(parseSlashCommand('/cite')).toBeNull();
    expect(parseSlashCommand('/regenerate')).toBeNull();
  });

  it('separates explicit edit instructions from ordinary project notes', () => {
    expect(parseSlashCommand('/edit Rewrite for executives')).toEqual({
      kind: 'custom',
      instruction: 'Rewrite for executives',
    });
    expect(parseSlashCommand('Remember that the deadline is Friday')).toBeNull();
    expect(parseSlashCommand('/edit   ')).toBeNull();
  });
});
