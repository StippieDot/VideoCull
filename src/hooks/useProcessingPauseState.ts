import { useEffect, useState } from 'react';
import type { ProcessingPauseState } from '../types';

export default function useProcessingPauseState(): ProcessingPauseState {
  const [pauseState, setPauseState] = useState<ProcessingPauseState>({ status: 'running' });

  useEffect(() => {
    if (!window.electronAPI?.onProcessingPauseState) return;
    let receivedEvent = false;
    const unsubscribe = window.electronAPI.onProcessingPauseState((state) => {
      receivedEvent = true;
      setPauseState(state);
    });
    window.electronAPI.getProcessingPauseState().then((state) => {
      if (!receivedEvent) setPauseState(state);
    }, (err) => {
      console.warn('[app] Failed to read the processing pause state:', err);
    });
    return unsubscribe;
  }, []);

  return pauseState;
}
