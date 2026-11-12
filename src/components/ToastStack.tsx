import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import type { CSSProperties } from 'react';
import useStore from '../store';
import type { ToastKind } from '../types';
import './ToastStack.css';

const KIND_ICONS: Record<ToastKind, typeof Info> = {
  success: CheckCircle2,
  info: Info,
  warning: AlertTriangle,
  error: XCircle,
};

/**
 * Notices in the bottom-right corner. Each one counts down along its bottom edge, and holds while
 * the pointer or keyboard focus is on it, so there is time to read it or press its button.
 */
export default function ToastStack() {
  const toasts = useStore((s) => s.toasts);
  const dismissToast = useStore((s) => s.dismissToast);
  const pauseToast = useStore((s) => s.pauseToast);
  const resumeToast = useStore((s) => s.resumeToast);

  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => {
        const Icon = KIND_ICONS[toast.kind];
        return (
          <div
            key={toast.id}
            className={`toast toast-${toast.kind}`}
            role={toast.kind === 'error' || toast.kind === 'warning' ? 'alert' : 'status'}
            style={{ '--toast-duration': `${toast.durationMs}ms` } as CSSProperties}
            onMouseEnter={() => pauseToast(toast.id)}
            onMouseLeave={(event) => {
              // Keyboard focus inside the toast keeps it paused, matching the CSS.
              if (!event.currentTarget.contains(document.activeElement)) resumeToast(toast.id);
            }}
            onFocus={() => pauseToast(toast.id)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) resumeToast(toast.id);
            }}
          >
            <Icon className="toast-icon" size={16} strokeWidth={2.25} aria-hidden="true" />
            <div className="toast-copy">
              <div className="toast-title">{toast.title}</div>
              {toast.detail && <div className="toast-detail" title={toast.detail}>{toast.detail}</div>}
            </div>
            {toast.action && (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  toast.action?.();
                  dismissToast(toast.id);
                }}
              >
                {toast.actionLabel ?? 'Undo'}
              </button>
            )}
            <button type="button" className="toast-close" onClick={() => dismissToast(toast.id)} aria-label="Dismiss notification">
              <X size={14} aria-hidden="true" />
            </button>
            <span className="toast-countdown" aria-hidden="true" />
          </div>
        );
      })}
    </div>
  );
}
