import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Track call order so we can return different values for different useLiveQuery calls.
let liveQueryCallIndex = 0;
vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: () => {
    const idx = liveQueryCallIndex++;
    // First call: templates (array), second+: settings (object)
    if (idx % 2 === 0) return [];
    return {
      models: { synthesis: null, drafting: null, critic: null, cleanup: null, schema_edit: null },
      cost: {},
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

import { Templates } from './Templates';

function renderTemplates() {
  return render(
    <MemoryRouter>
      <Templates />
    </MemoryRouter>,
  );
}

describe('Templates route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    liveQueryCallIndex = 0;
  });

  it('renders the heading', () => {
    renderTemplates();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/template library/i);
  });

  it('shows a drop zone for uploading DOCX files', () => {
    renderTemplates();
    // DropZone + EmptyState both mention DOCX; verify at least one exists
    const matches = screen.getAllByText(/drop a docx/i);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('shows empty state when no templates exist', () => {
    renderTemplates();
    expect(screen.getByText(/no templates yet/i)).toBeInTheDocument();
  });
});
