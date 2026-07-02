import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Welcome } from './Welcome';

vi.mock('../lib/state/auth', () => ({
  useAuth: () => ({
    provider: 'local_openai',
    apiKey: null,
    baseUrl: 'http://localhost:11434/v1',
    models: [{ id: 'qwen3:14b' }],
    isValidating: false,
    error: null,
    setProvider: vi.fn(),
    setApiKey: vi.fn(),
    setBaseUrl: vi.fn(),
    setModels: vi.fn(),
    setValidating: vi.fn(),
    setError: vi.fn(),
    clear: vi.fn(),
  }),
}));

vi.mock('../lib/state/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

function withRouter(ui: React.ReactElement) {
  return <MemoryRouter>{ui}</MemoryRouter>;
}

describe('Welcome local provider gate', () => {
  it('treats restored local_openai state with models and no API key as connected', () => {
    const { getByText, getByRole, queryByText } = render(withRouter(<Welcome />));

    expect(getByText(/You're connected!/i)).not.toBeNull();
    expect(getByText(/Using Local OpenAI-compatible/i)).not.toBeNull();
    expect(queryByText(/Using Ask Sage/i)).toBeNull();
    expect(getByRole('button', { name: /Reconnect/i })).not.toBeDisabled();
  });
});
