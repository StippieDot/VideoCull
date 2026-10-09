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

async function runFileAction(what: string, path: string, action: (() => Promise<boolean>) | undefined) {
  if (!action) return;
  try {
    if (await action()) return;
    console.warn(`[app] ${what} refused: ${path}`);
  } catch (err) {
    console.warn(`[app] ${what} failed: ${path}`, err);
  }
  useStore.getState().pushToast({
    title: `Could not ${what.toLowerCase()}`,
    detail: 'The file may have been moved or deleted, or is outside the loaded folders.',
    kind: 'error',
    dedupeKey: `file-action-failed:${what}`,
  });
}

/** Opens a video in the default player; the main process refuses paths outside the loaded folders. */
export function openVideoExternally(path: string): Promise<void> {
  return runFileAction('Play externally', path, window.electronAPI && (() => window.electronAPI.openVideo(path)));
}

/** Shows a video or folder in the file manager. */
export function revealInExplorer(path: string): Promise<void> {
  return runFileAction('Reveal in Explorer', path, window.electronAPI && (() => window.electronAPI.openInExplorer(path)));
}
