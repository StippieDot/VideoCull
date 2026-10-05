import { useEffect, useState } from 'react';
import usePowerState from '../hooks/usePowerState';

/** Last chance to stop the chosen sleep or shutdown after processing has finished. */
export default function FinishActionCountdown() {
  const { countdown } = usePowerState();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!countdown) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [countdown]);

  if (!countdown) return null;

  const seconds = Math.max(0, Math.ceil((countdown.endsAt - now) / 1000));
  const cancel = () => void window.electronAPI?.cancelFinishAction();
  const message = countdown.action === 'shutdown'
    ? `VideoCull closes and the PC shuts down in ${seconds} s.`
    : `The PC goes to sleep in ${seconds} s.`;

  return (
    <div className="drop-modal-backdrop">
      <div
        className="drop-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="finish-action-title"
        aria-describedby="finish-action-message"
        onKeyDown={(event) => {
          if (event.key === 'Escape') cancel();
        }}
      >
        <p className="drop-modal-title" id="finish-action-title">Processing finished</p>
        <p id="finish-action-message">{message}</p>
        <div className="drop-modal-actions">
          <button className="btn btn-primary" autoFocus onClick={cancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
