import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ModelInfo } from '../lib/asksage/types';

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

import { Settings, formatModelCapabilitySummary, formatModelOptionLabel } from './Settings';

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

  it('renders a refresh models and capabilities button', () => {
    renderSettings();
    expect(screen.getByRole('button', { name: /refresh models and capabilities/i })).toBeInTheDocument();
  });
});

describe('Settings model labels', () => {
  it('includes capability and pricing details in dropdown labels', () => {
    const model: ModelInfo = {
      id: 'anthropic/claude-sonnet-4.5',
      name: 'Claude Sonnet 4.5',
      object: 'model',
      owned_by: 'anthropic',
      created: 'na',
      pricing: {
        prompt_per_token: 0.000003,
        completion_per_token: 0.000015,
        is_free: false,
      },
      capabilities: {
        context_length: 200000,
        input_modalities: ['text', 'image'],
        output_modalities: ['text'],
        supported_parameters: ['temperature'],
      },
    };

    expect(formatModelOptionLabel(model)).toBe(
      'anthropic/claude-sonnet-4.5 · 200K ctx · text+image→text · $3.00 in / $15.00 out per 1M',
    );
    expect(formatModelCapabilitySummary(model)).toBe(
      '200K context · input: text, image · output: text · supports: temperature',
    );
  });

  it('marks Ask Sage models with unknown capabilities', () => {
    const model: ModelInfo = {
      id: 'google-claude-46-sonnet',
      name: 'google-claude-46-sonnet',
      object: 'model',
      owned_by: 'asksage',
      created: 'na',
    };

    expect(formatModelOptionLabel(model)).toBe('google-claude-46-sonnet · capabilities unknown');
    expect(formatModelCapabilitySummary(model)).toBe(
      'Capabilities unknown; this provider did not return context window or modality metadata.',
    );
  });

  it('includes local capability recommendations in model labels and summaries', () => {
    const model: ModelInfo = {
      id: 'qwen3:8b',
      name: 'qwen3:8b',
      object: 'model',
      owned_by: 'local_openai',
      created: 'na',
      capabilities: {
        context_length: 40960,
        input_modalities: ['text'],
        output_modalities: ['text'],
        supported_parameters: ['temperature', 'tools'],
        tool_calling: true,
        json_output: true,
        recommended_vram_gb: 8,
        backend_notes: 'Qwen3 8B local model; balanced default for local tool and JSON probes.',
      },
    };

    const optionLabel = formatModelOptionLabel(model);
    expect(optionLabel).toContain('41K ctx');
    expect(optionLabel).not.toContain('tools: native');
    expect(optionLabel).not.toContain('JSON: verified');
    expect(optionLabel).not.toContain('VRAM');

    const summary = formatModelCapabilitySummary(model);
    expect(summary).toContain('tools: native');
    expect(summary).toContain('JSON: verified');
    expect(summary).toContain('recommended VRAM: 8 GB');
    expect(summary).toContain('Qwen3 8B local model; balanced default for local tool and JSON probes.');
  });

  it('warns that long local context depends on backend settings and KV cache memory', () => {
    const model: ModelInfo = {
      id: 'qwen3:30b',
      name: 'qwen3:30b',
      object: 'model',
      owned_by: 'local_openai',
      created: 'na',
      capabilities: {
        context_length: 131072,
        input_modalities: ['text'],
        output_modalities: ['text'],
        tool_calling: false,
        json_output: true,
        recommended_vram_gb: 24,
        backend_notes: 'Large Qwen3 local model; prefer high-VRAM systems or quantized builds.',
      },
    };

    const summary = formatModelCapabilitySummary(model);
    expect(summary).toContain('tools: not verified');
    expect(summary).toContain('JSON: verified');
    expect(summary).toContain(
      'full context depends on backend settings',
    );
  });
});
