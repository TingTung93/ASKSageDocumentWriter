import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DebugPanel } from './DebugPanel';
import { debugLog } from '../lib/debug/log';

describe('DebugPanel', () => {
  afterEach(() => {
    cleanup();
    debugLog.clear();
    window.history.replaceState(null, '', '/');
  });

  it('is available by explicit opt-in and starts closed', () => {
    window.history.replaceState(null, '', '/?diagnostics=1');
    render(<DebugPanel />);

    expect(screen.getByRole('button', { name: /debug log/i })).toHaveTextContent('▲');
    expect(screen.queryByText('(no log entries yet)')).not.toBeInTheDocument();
  });

  it('opens automatically for a startup boundary failure', () => {
    debugLog.add('error', '[ErrorBoundary] Error: startup render failed');
    render(<DebugPanel />);

    expect(screen.getByRole('button', { name: /debug log/i })).toHaveTextContent('▼');
    expect(screen.getByText(/startup render failed/)).toBeInTheDocument();
  });
});
