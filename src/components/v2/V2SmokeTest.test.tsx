// Shallow-mount smoke tests for the V2 views that don't require a
// live project. Catches "throws on mount" bugs typecheck can't see —
// null-deref in a selector, missing CSS var usage that breaks parsing,
// a hook called conditionally, etc.
//
// Intentionally does NOT cover V2ProjectWorkspace or V2DraftPane — those
// need a full project + templates + drafts shape. They remain covered
// by typecheck + the three-pane workflow that runs when a user drafts.

import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ── Shared mocks ─────────────────────────────────────────────────
const authMock = vi.hoisted(() => {
  const defaultState = (): Record<string, unknown> => ({
    provider: 'asksage',
    apiKey: null,
    baseUrl: 'https://api.asksage.health.mil',
    models: null,
    localProbe: null,
    isValidating: false,
    error: null,
    setProvider: vi.fn(),
    setApiKey: vi.fn(),
    setBaseUrl: vi.fn(),
    setModels: vi.fn(),
    setLocalProbe: vi.fn(),
    setValidating: vi.fn(),
    setError: vi.fn(),
    clear: vi.fn(),
  });
  return {
    defaultState,
    state: defaultState(),
  };
});

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
    return selector ? selector(authMock.state) : authMock.state;
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
  beforeEach(() => {
    authMock.state = authMock.defaultState();
  });

  it('V2FirstRun mounts and renders the first-run copy', async () => {
    const { V2FirstRun } = await import('./V2FirstRun');
    const { container, getByText } = render(withRouter(<V2FirstRun onDismiss={() => {}} />));
    expect(container.querySelector('.first-run')).not.toBeNull();
    expect(getByText(/Welcome to Draft Workspace/i)).not.toBeNull();
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
    // Advanced-surface controls (V2SettingsAdvanced) require settings to load,
    // which is intentionally mocked as undefined in this smoke test.
  });

  it('V2SettingsView can test a restored local_openai provider without an API key', async () => {
    authMock.state = {
      ...authMock.defaultState(),
      provider: 'local_openai',
      apiKey: null,
      baseUrl: 'http://localhost:11434/v1',
      models: [{ id: 'qwen3:14b' }],
      localProbe: {
        ok: true,
        baseUrl: 'http://localhost:11434/v1',
        model: 'qwen3:14b',
        capabilities: {
          models: true,
          chat: true,
          tools: false,
          jsonOutput: true,
          embeddings: false,
        },
        warnings: ['Tool calls were not returned in native OpenAI format.'],
      },
    };

    const { V2SettingsView } = await import('./V2SettingsView');
    const { getAllByText, getByLabelText, getByRole, getByText, queryByText } = render(withRouter(<V2SettingsView />));

    expect(getByText(/^connected$/i)).not.toBeNull();
    expect(getByRole('radio', { name: /Local OpenAI/i })).toHaveAttribute('aria-checked', 'true');
    expect(getByLabelText(/Local backend/i)).toHaveValue('ollama');
    expect(getByRole('button', { name: /Test connection/i })).not.toBeDisabled();
    expect(getAllByText(/Endpoint check/i).length).toBeGreaterThan(0);
    expect(getByText(/Tools/i)).not.toBeNull();
    expect(getAllByText(/local model selected in backend/i)).toHaveLength(3);
    expect(queryByText(/qwen3/i)).toBeNull();
  });

  it('V2SettingsView warns when local provider points away from localhost', async () => {
    authMock.state = {
      ...authMock.defaultState(),
      provider: 'local_openai',
      apiKey: null,
      baseUrl: 'http://192.168.1.20:11434/v1',
      models: null,
    };

    const { V2SettingsView } = await import('./V2SettingsView');
    const { getByText } = render(withRouter(<V2SettingsView />));

    expect(getByText(/not a localhost address/i)).not.toBeNull();
    expect(getByText(/non-CUI local or trusted server/i)).not.toBeNull();
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
