import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../db/schema';
import { putTraceArtifact } from './artifacts';
import { exportEditingDiagnostics } from './diagnostics';
import { createEditingSession, appendEditingTurn } from './store';

afterEach(async () => { await db.delete(); await db.open(); });
describe('exportEditingDiagnostics', () => {
  it('does not include document content in a sanitized export', async () => {
    await createEditingSession({ id: 's', target_kind: 'uploaded_document', target_id: 'd', status: 'completed', created_at: '2026-01-01', updated_at: '2026-01-01' });
    await appendEditingTurn({ id: 't', session_id: 's', target: { kind: 'uploaded_document', targetId: 'd' }, base_version_id: 'v', instruction: 'x', acceptance_criteria: [], provider_id: 'genai_mil', models_used: [], status: 'completed', created_at: '2026-01-01' });
    await putTraceArtifact({ sessionId: 's', turnId: 't', kind: 'rendered_prompt', content: 'Sensitive document words', containsDocumentContent: true });
    expect(await exportEditingDiagnostics('s', 'sanitized')).not.toContain('Sensitive document words');
    expect(await exportEditingDiagnostics('s', 'full')).toContain('Sensitive document words');
  });
});
