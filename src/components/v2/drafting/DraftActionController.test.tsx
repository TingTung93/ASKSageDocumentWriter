import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  DraftActionControllerProvider,
  useDraftActionController,
  type DraftActionRegistration,
} from './DraftActionController';

function Harness({ registration }: { registration: DraftActionRegistration }) {
  const controller = useDraftActionController();
  useEffect(() => {
    controller.register(registration);
    return () => controller.register(null);
  }, [controller.register, registration]);
  return (
    <>
      <button onClick={() => controller.run('tighten')}>direct tighten</button>
      <button onClick={() => controller.run('accept_proposal')}>direct accept</button>
    </>
  );
}

function registration(overrides: Partial<DraftActionRegistration> = {}): DraftActionRegistration {
  return {
    scopeLabel: 'paragraph 2 in Scope',
    busy: false,
    hasProposal: true,
    propose: vi.fn(),
    proposeCustom: vi.fn(),
    focusInstruction: vi.fn(),
    accept: vi.fn(),
    reject: vi.fn(),
    ...overrides,
  };
}

describe('DraftActionController', () => {
  it('routes direct controls and guarded shortcuts through one registration', () => {
    const actions = registration();
    render(
      <DraftActionControllerProvider>
        <Harness registration={actions} />
      </DraftActionControllerProvider>,
    );
    fireEvent.click(screen.getByText('direct tighten'));
    expect(actions.propose).toHaveBeenCalledWith(expect.objectContaining({ id: 'tighten' }));

    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true, shiftKey: true });
    expect(actions.accept).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent(/Accepting proposal.*paragraph 2/i);
  });

  it('does not run review shortcuts while typing or without a proposal', () => {
    const actions = registration({ hasProposal: false });
    render(
      <DraftActionControllerProvider>
        <Harness registration={actions} />
        <textarea aria-label="Editor" />
      </DraftActionControllerProvider>,
    );
    fireEvent.keyDown(screen.getByLabelText('Editor'), {
      key: 'Enter', ctrlKey: true, shiftKey: true,
    });
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true, shiftKey: true });
    expect(actions.accept).not.toHaveBeenCalled();
  });

  it('guards commands while the active workflow is busy', () => {
    const actions = registration({ busy: true });
    render(
      <DraftActionControllerProvider>
        <Harness registration={actions} />
      </DraftActionControllerProvider>,
    );
    act(() => fireEvent.click(screen.getByText('direct tighten')));
    expect(actions.propose).not.toHaveBeenCalled();
  });
});
