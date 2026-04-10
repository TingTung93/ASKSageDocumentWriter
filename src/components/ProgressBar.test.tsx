import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProgressBar } from './ProgressBar';

describe('ProgressBar', () => {
  it('renders done/total label by default', () => {
    render(<ProgressBar done={3} total={10} />);
    expect(screen.getByText('3 of 10')).toBeInTheDocument();
    expect(screen.getByText('30%')).toBeInTheDocument();
  });

  it('renders custom label when provided', () => {
    render(<ProgressBar done={5} total={20} label="Drafting section 5 of 20" />);
    expect(screen.getByText('Drafting section 5 of 20')).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
  });

  it('caps at 100%', () => {
    render(<ProgressBar done={15} total={10} />);
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('handles zero total without error', () => {
    render(<ProgressBar done={0} total={0} />);
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('shows success fill class when complete', () => {
    const { container } = render(<ProgressBar done={10} total={10} />);
    const fill = container.querySelector('.progress-bar-fill');
    expect(fill?.classList.contains('is-success')).toBe(true);
  });
});
