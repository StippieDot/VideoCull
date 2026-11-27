import { useState, useEffect, useCallback } from 'react';
import { keybindFromEvent, formatKeybind } from '../keybinds';
import type { Keybind } from '../keybinds';
import './KeybindInput.css';

interface Props {
  value: Keybind;
  onChange: (bind: Keybind) => void;
  conflict?: string | null;
}

export default function KeybindInput({ value, onChange, conflict }: Props) {
  const [recording, setRecording] = useState(false);

  const startRecording = useCallback(() => {
    setRecording(true);
    // Signal to all other keyboard handlers to stand down while recording
    document.body.setAttribute('data-capturing-keybind', 'true');
  }, []);

  const stopRecording = useCallback(() => {
    setRecording(false);
    document.body.removeAttribute('data-capturing-keybind');
  }, []);

  useEffect(() => {
    if (!recording) return;

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();

      if (e.key === 'Escape') {
        stopRecording();
        return;
      }

      const bind = keybindFromEvent(e);
      if (bind) {
        onChange(bind);
        stopRecording();
      }
    };

    // useCapture=true so we get the event before other listeners
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [recording, onChange, stopRecording]);

  // Cancel on blur (click elsewhere)
  const handleBlur = useCallback(() => {
    if (recording) stopRecording();
  }, [recording, stopRecording]);

  return (
    <button
      type="button"
      className={[
        'keybind-input',
        recording  ? 'keybind-recording' : '',
        conflict   ? 'keybind-conflict'  : '',
      ].filter(Boolean).join(' ')}
      onClick={startRecording}
      onBlur={handleBlur}
      title={conflict ? `Conflicts with: ${conflict}` : recording ? 'Press a key combination…' : 'Click to record'}
      aria-label={recording ? 'Recording keybind: press any key' : formatKeybind(value)}
    >
      {recording ? (
        <span className="keybind-recording-label">Press a key…</span>
      ) : (
        <kbd>{formatKeybind(value)}</kbd>
      )}
      {conflict && !recording && <span className="keybind-conflict-dot" title={`Conflicts with: ${conflict}`} />}
    </button>
  );
}
