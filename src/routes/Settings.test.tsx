import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const MOCK_SETTINGS = {
  models: { synthesis: null, drafting: null, critic: null, cleanup: null, schema_edit: null },
  cost: {
    drafting_tokens_in_per_section: 4000,
    drafting_tokens_out_per_section: 2000,
    chars_per_token: 4,
    cleanup_system_prompt_tokens: 500,
    cleanup_paragraph_overhead_tokens: 20,
    cleanup_output_ratio: 0.3,
    usd_per_1k_in: 0.003,
    usd_per_1k_out: 0.015,
  },
  critic: null,
  style_review: null,
  user_defaults: { shared_inputs: {} },
};

vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: () => MOCK_SETTINGS,
}));

vi.mock('../lib/settings/store', () => ({
  loadSettings: () =>
    Promise.resolve({
      models: { synthesis: null, drafting: null, critic: null, cleanup: null, schema_edit: null },
      cost: {
        drafting_tokens_in_per_section: 4000,
        drafting_tokens_out_per_section: 2000,
        chars_per_token: 4,
        cleanup_system_prompt_tokens: 500,
        cleanup_paragraph_overhead_tokens: 20,
        cleanup_output_ratio: 0.3,
        usd_per_1k_in: 0.003,
        usd_per_1k_out: 0.015,
      },
    }),
  saveSettings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/state/auth', () => ({
  useAuth: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ apiKey: 'test-key', baseUrl: 'https://test', provider: 'asksage', models: [] }),
}));

vi.mock('../lib/state/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), sticky: vi.fn() },
}));

import { Settings } from './Settings';

function renderSettings() {
  return render(
    <MemoryRouter>
      <Settings />
    </MemoryRouter>,
  );
}

describe('Settings route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the heading', () => {
    renderSettings();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/settings/i);
  });

  it('renders model overrides section', () => {
    renderSettings();
    expect(screen.getByRole('heading', { name: /AI model preferences/i })).toBeInTheDocument();
  });

  it('renders cost projection section with help hints', () => {
    renderSettings();
    expect(screen.getByRole('heading', { name: /cost projection/i })).toBeInTheDocument();
    // Check that at least one hint is rendered
    expect(screen.getByText(/Average input sent to the AI per section/i)).toBeInTheDocument();
  });

  it('renders critic settings section', () => {
    renderSettings();
    expect(screen.getByRole('heading', { name: /quality review loop/i })).toBeInTheDocument();
  });

  it('renders reset button', () => {
    renderSettings();
    expect(screen.getByRole('button', { name: /reset to defaults/i })).toBeInTheDocument();
  });
});
