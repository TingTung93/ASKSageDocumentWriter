import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DraftActionBar } from './DraftActionBar';
import { DraftDiffPreview } from './DraftDiffPreview';
import { InstructionComposer } from './InstructionComposer';

describe('draft editing controls', () => {
  it('exposes only honest, scoped preset actions', () => {
    const select = vi.fn();
    render(<DraftActionBar onSelect={select} />);

    fireEvent.click(screen.getByRole('button', { name: 'Tighten' }));
    expect(select).toHaveBeenCalledWith(expect.objectContaining({
      id: 'tighten',
      instruction: expect.stringContaining('concise'),
    }));
    expect(screen.queryByRole('button', { name: /cite/i })).not.toBeInTheDocument();
  });

  it('requires a non-empty custom instruction', () => {
    const submit = vi.fn();
    render(<InstructionComposer onSubmit={submit} />);
    const button = screen.getByRole('button', { name: 'Preview change' });
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Custom editing instruction'), {
      target: { value: '  Improve the opening.  ' },
    });
    fireEvent.click(button);
    expect(submit).toHaveBeenCalledWith('Improve the opening.');
  });

  it('labels current and proposed text without mutating either', () => {
    render(<DraftDiffPreview before="Old text" after="New text" summary="One replacement" />);
    expect(screen.getByText('Old text')).toBeInTheDocument();
    expect(screen.getByText('New text')).toBeInTheDocument();
    expect(screen.getByText('One replacement')).toBeInTheDocument();
  });
});
