import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RevisionTimeline } from './RevisionTimeline';
import type { DocumentVersionRecord } from '../../../lib/agentic-editing/types';

const versions: DocumentVersionRecord[] = [
  {
    id: 'old',
    target_kind: 'template_draft',
    target_id: 'draft',
    label: 'Initial draft',
    status: 'accepted',
    snapshot_json: '[]',
    created_at: '2026-07-27T00:00:00.000Z',
  },
  {
    id: 'current',
    target_kind: 'template_draft',
    target_id: 'draft',
    parent_version_id: 'old',
    label: 'Tightened wording',
    status: 'accepted',
    snapshot_json: '[]',
    created_at: '2026-07-27T01:00:00.000Z',
  },
  {
    id: 'preview',
    target_kind: 'template_draft',
    target_id: 'draft',
    label: 'Unapproved',
    status: 'preview',
    snapshot_json: '[]',
    created_at: '2026-07-27T02:00:00.000Z',
  },
];

describe('RevisionTimeline', () => {
  it('shows accepted lineage, hides previews, and restores only prior revisions', () => {
    const undo = vi.fn();
    render(<RevisionTimeline canUndo onUndo={undo} versions={versions} />);
    fireEvent.click(screen.getByText('Revision history (2)'));

    expect(screen.getByText('Tightened wording')).toBeInTheDocument();
    expect(screen.getByText('Initial draft')).toBeInTheDocument();
    expect(screen.queryByText('Unapproved')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(undo).toHaveBeenCalledWith(expect.objectContaining({ id: 'old' }));
  });
});
