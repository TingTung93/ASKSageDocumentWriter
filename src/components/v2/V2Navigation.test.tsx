import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { V2FirstRun } from './V2FirstRun';
import { v2ViewFromSearchParams } from './V2Layout';

describe('V2 embedded-view navigation contract', () => {
  it.each([
    ['', 'workspace'],
    ['view=documents', 'documents'],
    ['view=library', 'library'],
    ['view=audit', 'audit'],
    ['view=settings', 'settings'],
    ['view=unknown', 'workspace'],
  ] as const)('maps "%s" to %s', (search, expected) => {
    expect(v2ViewFromSearchParams(new URLSearchParams(search))).toBe(expected);
  });

  it('opens embedded settings from first-run onboarding', () => {
    const onDismiss = vi.fn();
    const onOpenSettings = vi.fn();
    render(
      <MemoryRouter>
        <V2FirstRun onDismiss={onDismiss} onOpenSettings={onOpenSettings} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: /open settings/i }));

    expect(onDismiss).toHaveBeenCalledOnce();
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });
});
