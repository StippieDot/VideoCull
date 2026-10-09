import useStore from './store';

function reportCommandFailure(what: string, err?: unknown) {
  console.warn(`[app] ${what} failed:`, err ?? 'refused by the main process');
  useStore.getState().pushToast({
    title: 'Menu unavailable',
    detail: 'That menu or command could not be opened. Try again after the current action finishes.',
    kind: 'error',
    dedupeKey: 'app-command-failed',
  });
}

/** Runs an app menu command by id; a command the main process refuses (disabled, stale id) is reported, not dropped. */
export async function runAppCommand(id: string): Promise<boolean> {
  const api = window.electronAPI;
  if (!api) return false;
  try {
    if (await api.runCommand(id)) return true;
    reportCommandFailure(`Command "${id}"`);
  } catch (err) {
    reportCommandFailure(`Command "${id}"`, err);
  }
  return false;
}

/** Opens a native app menu at a window position; resolves when it closes. */
export async function openAppMenuAt(id: string, x: number, y: number): Promise<void> {
  const api = window.electronAPI;
  if (!api) return;
  try {
    if (!(await api.openAppMenu(id, x, y))) reportCommandFailure(`Menu "${id}"`);
  } catch (err) {
    reportCommandFailure(`Menu "${id}"`, err);
  }
}
