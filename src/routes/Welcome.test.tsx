import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Welcome } from './Welcome';
import { createLLMClient } from '../lib/provider/factory';
import { probeLocalOpenAIEndpoint } from '../lib/provider/local_openai';
import type { LocalEndpointProbeResult } from '../lib/provider/local_openai';

const authMock = vi.hoisted(() => {
  const defaultState = () => ({
    provider: 'local_openai',
    apiKey: null as string | null,
    baseUrl: 'http://localhost:11434/v1',
    models: [{ id: 'qwen3:14b' }] as { id: string }[] | null,
    localProbe: null as LocalEndpointProbeResult | null,
    isValidating: false,
    error: null as string | null,
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

const clientMock = vi.hoisted(() => ({
  getModels: vi.fn(),
}));

const localProbeMock = vi.hoisted(() => ({
  probe: vi.fn(),
}));

vi.mock('../lib/state/auth', () => ({
  useAuth: () => authMock.state,
}));

vi.mock('../lib/provider/factory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/provider/factory')>();
  return {
    ...actual,
    createLLMClient: vi.fn(() => clientMock),
  };
});

vi.mock('../lib/provider/local_openai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/provider/local_openai')>();
  return {
    ...actual,
    probeLocalOpenAIEndpoint: vi.fn(() => localProbeMock.probe()),
  };
});

vi.mock('../lib/state/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

function withRouter(ui: React.ReactElement) {
  return <MemoryRouter>{ui}</MemoryRouter>;
}

describe('Welcome local provider gate', () => {
  beforeEach(() => {
    authMock.state = authMock.defaultState();
    clientMock.getModels.mockResolvedValue([{ id: 'qwen3:14b' }]);
    localProbeMock.probe.mockResolvedValue({
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
    });
    vi.clearAllMocks();
  });

  it('treats restored local_openai state with models and no API key as connected', () => {
    const { getByText, getByRole, queryByText } = render(withRouter(<Welcome />));

    expect(getByText(/You're connected!/i)).not.toBeNull();
    expect(getByText(/Using Local OpenAI-compatible/i)).not.toBeNull();
    expect(queryByText(/Using Ask Sage/i)).toBeNull();
    expect(getByRole('button', { name: /Reconnect/i })).not.toBeDisabled();
  });

  it('shows Local OpenAI as a selectable provider and allows connecting without an API key', () => {
    authMock.state = {
      ...authMock.defaultState(),
      provider: 'asksage',
      apiKey: null,
      baseUrl: 'https://api.asksage.health.mil',
      models: null,
    };

    const { getAllByText, getByRole, getByLabelText, getByText } = render(withRouter(<Welcome />));

    fireEvent.click(getByRole('radio', { name: /Local OpenAI/i }));

    expect(getByText(/Ollama \/ llama\.cpp/i)).not.toBeNull();
    expect(getAllByText(/Most local backends do not require an API key/i).length).toBeGreaterThan(0);
    expect(getByLabelText(/Local backend/i)).toHaveValue('ollama');
    expect(getByLabelText(/Server URL/i)).toHaveValue('http://localhost:11434/v1');
    expect(getByRole('button', { name: /Connect/i })).not.toBeDisabled();
  });

  it('switches from an old provider default to the Ollama local default URL', () => {
    authMock.state = {
      ...authMock.defaultState(),
      provider: 'openrouter',
      apiKey: 'sk-or-test',
      baseUrl: 'https://openrouter.ai/api/v1',
      models: null,
    };

    const { getByRole, getByLabelText } = render(withRouter(<Welcome />));

    fireEvent.click(getByRole('radio', { name: /Local OpenAI/i }));

    expect(getByLabelText(/Local backend/i)).toHaveValue('ollama');
    expect(getByLabelText(/Server URL/i)).toHaveValue('http://localhost:11434/v1');
  });

  it('warns when the Local OpenAI base URL is not localhost', () => {
    authMock.state = {
      ...authMock.defaultState(),
      baseUrl: 'http://192.168.1.20:11434/v1',
    };

    const { getByText } = render(withRouter(<Welcome />));

    expect(getByText(/not a localhost address/i)).not.toBeNull();
    expect(getByText(/non-CUI local or trusted server/i)).not.toBeNull();
  });

  it('runs the local endpoint probe after model validation and shows a probe summary', async () => {
    authMock.state = {
      ...authMock.defaultState(),
      models: null,
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

    const { getByRole, getByText } = render(withRouter(<Welcome />));

    fireEvent.click(getByRole('button', { name: /Connect/i }));

    await waitFor(() => {
      expect(createLLMClient).toHaveBeenCalledWith({
        provider: 'local_openai',
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
      });
      expect(probeLocalOpenAIEndpoint).toHaveBeenCalledWith({
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
        model: 'qwen3:14b',
      });
      expect(authMock.state.setLocalProbe).toHaveBeenCalledWith({
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
      });
    });
    expect(getByText(/Endpoint check/i)).not.toBeNull();
    expect(getByText(/^Models: yes$/i)).not.toBeNull();
    expect(getByText(/^Chat: yes$/i)).not.toBeNull();
    expect(getByText(/^Tools: no$/i)).not.toBeNull();
    expect(getByText(/^JSON: yes$/i)).not.toBeNull();
    expect(getByText(/^Embeddings: no$/i)).not.toBeNull();
  });
});
