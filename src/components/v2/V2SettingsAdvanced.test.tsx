import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../lib/settings/types';
import { V2SettingsAdvanced } from './V2SettingsAdvanced';

const { saveSettings } = vi.hoisted(() => ({
  saveSettings: vi.fn(),
}));

vi.mock('../../lib/settings/store', () => ({
  loadSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
  saveSettings,
}));

vi.mock('../../lib/state/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

describe('V2 advanced settings consolidation', () => {
  beforeEach(() => {
    saveSettings.mockReset().mockResolvedValue(DEFAULT_SETTINGS);
    vi.stubGlobal('confirm', vi.fn(() => true));
  });

  it('propagates the same documented models-and-cost reset scope', async () => {
    render(<V2SettingsAdvanced settings={DEFAULT_SETTINGS} onOpenAudit={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));

    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({
      models: { ...DEFAULT_SETTINGS.models },
      cost: { ...DEFAULT_SETTINGS.cost },
    }));
  });

  it('opens the embedded audit owner', () => {
    const onOpenAudit = vi.fn();
    render(<V2SettingsAdvanced settings={DEFAULT_SETTINGS} onOpenAudit={onOpenAudit} />);

    fireEvent.click(screen.getByRole('button', { name: /open audit log/i }));

    expect(onOpenAudit).toHaveBeenCalledOnce();
  });
});
