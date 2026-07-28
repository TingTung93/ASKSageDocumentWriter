import { act, fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  DraftSelectionProvider,
  useDraftSelection,
} from './DraftSelectionContext';
import {
  templateSectionSelection,
  type DraftSelectionScope,
} from './selection';

const scopeOne: DraftSelectionScope = {
  projectId: 'project-1',
  templates: [{ id: 'template-1', sectionIds: ['one', 'two'] }],
};
const scopeTwo: DraftSelectionScope = {
  projectId: 'project-2',
  templates: [{ id: 'template-2', sectionIds: ['other'] }],
};

function Harness() {
  const selection = useDraftSelection();
  return (
    <div>
      <output data-testid="selection">
        {selection.selection
          ? `${selection.origin}:${selection.selection.projectId}:${selection.selection.sectionId}`
          : 'none'}
      </output>
      <button onClick={() => selection.observeSelection(
        templateSectionSelection('project-1', 'template-1', 'one'),
      )}>
        observe one
      </button>
      <button onClick={() => selection.pinSelection(
        templateSectionSelection('project-1', 'template-1', 'two'),
      )}>
        pin two
      </button>
      <button onClick={selection.clearPinnedSelection}>unpin</button>
      <button onClick={() => selection.pinSelection(
        templateSectionSelection('project-1', 'template-1', 'missing'),
      )}>
        pin stale
      </button>
    </div>
  );
}

describe('DraftSelectionProvider', () => {
  it('keeps observed viewport state separate from explicit pinned selection', () => {
    const view = render(
      <DraftSelectionProvider scope={scopeOne}>
        <Harness />
      </DraftSelectionProvider>,
    );

    fireEvent.click(view.getByRole('button', { name: 'observe one' }));
    expect(view.getByTestId('selection')).toHaveTextContent('observed:project-1:one');

    fireEvent.click(view.getByRole('button', { name: 'pin two' }));
    expect(view.getByTestId('selection')).toHaveTextContent('pinned:project-1:two');

    fireEvent.click(view.getByRole('button', { name: 'unpin' }));
    expect(view.getByTestId('selection')).toHaveTextContent('observed:project-1:one');
  });

  it('rejects a stale target instead of exposing it', () => {
    const view = render(
      <DraftSelectionProvider scope={scopeOne}>
        <Harness />
      </DraftSelectionProvider>,
    );
    fireEvent.click(view.getByRole('button', { name: 'pin stale' }));
    expect(view.getByTestId('selection')).toHaveTextContent('none');
  });

  it('clears synchronously when the project changes', () => {
    const view = render(
      <DraftSelectionProvider scope={scopeOne}>
        <Harness />
      </DraftSelectionProvider>,
    );
    fireEvent.click(view.getByRole('button', { name: 'pin two' }));
    expect(view.getByTestId('selection')).toHaveTextContent('project-1');

    act(() => {
      view.rerender(
        <DraftSelectionProvider scope={scopeTwo}>
          <Harness />
        </DraftSelectionProvider>,
      );
    });
    expect(view.getByTestId('selection')).toHaveTextContent('none');
  });

});
