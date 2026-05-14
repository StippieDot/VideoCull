import React from 'react';

type AppErrorBoundaryState = {
  error: Error | null;
};

function reportRendererError(payload: {
  kind: string;
  message: string;
  stack?: string | null;
  componentStack?: string | null;
}) {
  try {
    window.electronAPI?.reportRendererError?.(payload);
  } catch {
    // Logging should never trigger another render failure.
  }
}

export default class AppErrorBoundary extends React.Component<React.PropsWithChildren, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    reportRendererError({
      kind: 'react-render',
      message: error.message,
      stack: error.stack ?? null,
      componentStack: info.componentStack ?? null,
    });
  }

  render() {
    if (this.state.error) {
      return (
        <div className="app-crash-fallback">
          <div className="app-crash-panel">
            <h1>Video Cull hit a display error</h1>
            <p>The app is still running, but the interface crashed. The error was sent to the terminal log.</p>
            <button type="button" onClick={() => window.location.reload()}>
              Reload interface
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
