import { useCallback, useState } from 'react';

const KEY_PREFIX = 'videocull:';

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const stored = window.localStorage.getItem(KEY_PREFIX + key);
    return stored === null ? fallback : stored === '1';
  } catch {
    return fallback;
  }
}

/** A boolean that survives restarts. Storage can be unavailable, in which case it lasts for the session. */
export function usePersistedFlag(key: string, fallback: boolean): [boolean, (next: boolean | ((current: boolean) => boolean)) => void] {
  const [value, setValue] = useState(() => readFlag(key, fallback));

  const update = useCallback((next: boolean | ((current: boolean) => boolean)) => {
    setValue((current) => {
      const resolved = typeof next === 'function' ? next(current) : next;
      try {
        window.localStorage.setItem(KEY_PREFIX + key, resolved ? '1' : '0');
      } catch {
        // Storage is blocked; the choice still holds until the app closes.
      }
      return resolved;
    });
  }, [key]);

  return [value, update];
}
