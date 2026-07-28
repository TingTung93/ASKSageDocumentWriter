import { fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Diagnostics } from './Diagnostics';

afterEach(() => vi.restoreAllMocks());

describe('Diagnostics', () => {
  it('uses the STARK models endpoint and Bearer auth for GenAI.mil', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"detail":"upstream unavailable"}', { status: 500 }),
    );
    const view = render(<Diagnostics provider="genai_mil" baseUrl="https://api.genai.mil/v1" apiKey="STARK_secret" />);

    fireEvent.click(view.getByRole('button', { name: /run connection tests/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.genai.mil/v1/models',
      expect.objectContaining({ method: 'GET', headers: { Authorization: 'Bearer STARK_secret' } }),
    );
    expect(view.getByText(/upstream unavailable/i)).toBeInTheDocument();
    expect(view.getByText(/<redacted>/i)).toBeInTheDocument();
    expect(view.queryByText('STARK_secret')).toBeNull();
  });
});
