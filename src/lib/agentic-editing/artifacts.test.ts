import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/schema';
import { putTraceArtifact } from './artifacts';

describe('trace artifacts', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('deduplicates identical artifacts within a turn', async () => {
    const input = { sessionId: 'session_1', turnId: 'turn_1', kind: 'rendered_prompt' as const, mediaType: 'text/plain' as const, content: 'Prompt', containsDocumentContent: true };
    const first = await putTraceArtifact(input);
    const second = await putTraceArtifact(input);
    expect(second.id).toBe(first.id);
  });
});
