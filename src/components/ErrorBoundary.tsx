import { Component, type ReactNode, type ErrorInfo } from 'react';
import { debugLog } from '../lib/debug/log';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

// Catches render-time crashes anywhere in the tree and surfaces them in
// the page (and the debug log). Without this, a render error in
// production builds is silent and the user just sees a blank screen.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): State {
    return { error, info: null };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    debugLog.add(
      'error',
      `[ErrorBoundary] ${error.name}: ${error.message}\n${error.stack ?? ''}\n${info.componentStack ?? ''}`,
    );
    this.setState({ info });
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <main>
          <h1 style={{ color: '#b00' }}>Render error</h1>
          <p>The React tree crashed. Details below and in the debug panel.</p>
          <pre
            style={{
              background: '#fee',
              border: '1px solid #c33',
              padding: '0.75rem',
              fontSize: 12,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {this.state.error.name}: {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
            {this.state.info?.componentStack && '\n\nComponent stack:' + this.state.info.componentStack}
          </pre>
        </main>
      );
    }
    return this.props.children;
  }
}
