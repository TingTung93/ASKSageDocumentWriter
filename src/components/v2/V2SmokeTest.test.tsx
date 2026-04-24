// Shallow-mount smoke tests for the V2 views that don't require a
// live project. Catches "throws on mount" bugs typecheck can't see —
// null-deref in a selector, missing CSS var usage that breaks parsing,
// a hook called conditionally, etc.
//
// Intentionally does NOT cover V2ProjectWorkspace or V2DraftPane — those
// need a full project + templates + drafts shape. They remain covered
// by typecheck + the three-pane workflow that runs when a user drafts.

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ── Shared mocks ─────────────────────────────────────────────────
// Dexie live queries — return undefined, matching Dexie's real behavior
// of "query not resolved yet" on first render. Views MUST handle this.
vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: () => undefined,
}));

vi.mock('../../lib/db/schema', () => ({
  db: {
    audit: { orderBy: () => ({ reverse: () => ({ limit: () => ({ toArray: async () => [] }) }) }) },
    templates: {
      orderBy: () => ({ reverse: () => ({ toArray: async () => [] }) }),
      put: vi.fn(),
    },
    drafts: { where: () => ({ equals: () => ({ toArray: async () => [] }) }) },
    settings: { get: async () => undefined },
  },
}));

vi.mock('../../lib/state/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), sticky: vi.fn() },
  useToasts: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ toasts: [], dismiss: vi.fn(), push: vi.fn() }),
}));

vi.mock('../../lib/state/auth', () => ({
  useAuth: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = {
      provider: 'asksage',
      apiKey: null,
      baseUrl: 'https://api.asksage.health.mil',
      models: null,
      isValidating: false,
      error: null,
      setProvider: vi.fn(),
      setApiKey: vi.fn(),
      setBaseUrl: vi.fn(),
      setModels: vi.fn(),
      setValidating: vi.fn(),
      setError: vi.fn(),
      clear: vi.fn(),
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock('../../lib/settings/store', () => ({
  loadSettings: async () => ({
    id: 'app',
    models: { synthesis: null, drafting: null, critic: null, cleanup: null, schema_edit: null },
    cost: {},
    critic: {},
    style_review: {},
    user_defaults: { shared_inputs: {} },
    updated_at: new Date(0).toISOString(),
  }),
  saveSettings: vi.fn(),
}));

function withRouter(ui: React.ReactElement) {
  return <MemoryRouter>{ui}</MemoryRouter>;
}

// ── Tests ───────────────────────────────────────────────────────
describe('V2 view smoke tests', () => {
  it('V2FirstRun mounts and renders the first-run copy', async () => {
    const { V2FirstRun } = await import('./V2FirstRun');
    const { container, getByText } = render(withRouter(<V2FirstRun onDismiss={() => {}} />));
    expect(container.querySelector('.first-run')).not.toBeNull();
    expect(getByText(/Let's get you drafting/i)).not.toBeNull();
    expect(getByText(/Open Settings/i)).not.toBeNull();
  });

  it('V2LibraryView mounts with empty template list', async () => {
    const { V2LibraryView } = await import('./V2LibraryView');
    const { container, getByText } = render(
      withRouter(<V2LibraryView onOpenIngest={() => {}} />),
    );
    expect(container.querySelector('.lib-wrap')).not.toBeNull();
    expect(getByText(/Templates & sources/i)).not.toBeNull();
    // The "Upload DOCX template" add-card always renders.
    expect(getByText(/Upload DOCX template/i)).not.toBeNull();
  });

  it('V2AuditView mounts with empty audit log', async () => {
    const { V2AuditView } = await import('./V2AuditView');
    const { container, getByText } = render(withRouter(<V2AuditView />));
    expect(container.querySelector('.audit-wrap')).not.toBeNull();
    expect(getByText(/Audit trail/i)).not.toBeNull();
    expect(getByText(/Export JSON/i)).not.toBeNull();
  });

  it('V2SettingsView mounts with no API key', async () => {
    const { V2SettingsView } = await import('./V2SettingsView');
    const { container, getByText } = render(withRouter(<V2SettingsView />));
    expect(container.querySelector('.settings-wrap')).not.toBeNull();
    expect(getByText(/Connection & models/i)).not.toBeNull();
    expect(getByText(/Test connection/i)).not.toBeNull();
    // Advanced-surface escape hatch is present.
    expect(getByText(/Open full settings/i)).not.toBeNull();
  });

  it('V2CommandPalette mounts with focus-capture input', async () => {
    const { V2CommandPalette } = await import('./V2CommandPalette');
    const { container, getByPlaceholderText } = render(
      withRouter(<V2CommandPalette onClose={() => {}} setView={() => {}} />),
    );
    expect(container.querySelector('.cmdk-scrim')).not.toBeNull();
    expect(container.querySelector('.cmdk-card')).not.toBeNull();
    expect(getByPlaceholderText(/Jump to section/i)).not.toBeNull();
  });

  it('V2IngestModal mounts in drop phase', async () => {
    const { V2IngestModal } = await import('./V2IngestModal');
    const { container, getByText } = render(withRouter(<V2IngestModal onClose={() => {}} />));
    expect(container.querySelector('.modal-scrim')).not.toBeNull();
    expect(container.querySelector('.ingest-drop')).not.toBeNull();
    expect(getByText(/Drop a .docx file here/i)).not.toBeNull();
  });
});
