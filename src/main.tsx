import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import AppErrorBoundary from './components/AppErrorBoundary';
import './index.css';

function reportRendererError(payload: {
  kind: string;
  message: string;
  stack?: string | null;
  source?: string | null;
  lineno?: number | null;
  colno?: number | null;
}) {
  try {
    window.electronAPI?.reportRendererError?.(payload);
  } catch {
    // Last-resort logging should never be able to crash the renderer.
  }
}

window.addEventListener('error', (event) => {
  reportRendererError({
    kind: 'window-error',
    message: event.message,
    stack: event.error?.stack ?? null,
    source: event.filename,
    lineno: event.lineno,
    colno: event.colno,
  });
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  reportRendererError({
    kind: 'unhandled-rejection',
    message: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack ?? null : null,
  });
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
);
