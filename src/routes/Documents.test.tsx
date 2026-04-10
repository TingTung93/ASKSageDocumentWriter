import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

let liveQueryCallIndex = 0;
vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: () => {
    const idx = liveQueryCallIndex++;
    // First call: documents (array), second: settings (object)
    if (idx % 2 === 0) return [];
    return {
      models: { cleanup: null },
      cost: {
        cleanup_system_prompt_tokens: 500,
        cleanup_paragraph_overhead_tokens: 20,
        cleanup_output_ratio: 0.3,
        usd_per_1k_in: 0.003,
        usd_per_1k_out: 0.015,
        chars_per_token: 4,
      },
    };
  },
}));

vi.mock('../lib/state/auth', () => ({
  useAuth: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ apiKey: null, baseUrl: null, provider: 'asksage', models: [] }),
}));

vi.mock('../lib/state/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), sticky: vi.fn() },
}));

vi.mock('../lib/document/migrate', () => ({
  migrateAll: (docs: unknown[]) => docs,
  migrateDocumentEdits: (edits: unknown[]) => edits,
}));

import { Documents } from './Documents';

function renderDocuments() {
  return render(
    <MemoryRouter>
      <Documents />
    </MemoryRouter>,
  );
}

describe('Documents route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    liveQueryCallIndex = 0;
  });

  it('renders the heading', () => {
    renderDocuments();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/documents.*inline cleanup/i);
  });

  it('shows a drop zone for uploading DOCX files', () => {
    renderDocuments();
    expect(screen.getByText(/drop a docx here/i)).toBeInTheDocument();
  });

  it('shows stored documents count', () => {
    renderDocuments();
    expect(screen.getByText(/stored documents/i)).toBeInTheDocument();
  });
});
