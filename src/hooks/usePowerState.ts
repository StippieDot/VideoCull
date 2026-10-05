import { useEffect, useState } from 'react';
import type { PowerState } from '../types';

const IDLE_STATE: PowerState = { processing: false, finishAction: 'none', countdown: null };

export default function usePowerState(): PowerState {
  const [state, setState] = useState<PowerState>(IDLE_STATE);

  useEffect(() => {
    if (!window.electronAPI?.onPowerState) return;
    let receivedEvent = false;
    const unsubscribe = window.electronAPI.onPowerState((next) => {
      receivedEvent = true;
      setState(next);
    });
    void window.electronAPI.getPowerState().then((initial) => {
      if (!receivedEvent) setState(initial);
    });
    return unsubscribe;
  }, []);

  return state;
}
