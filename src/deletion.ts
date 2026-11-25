import useStore from './store';
import type { DeleteFailureReason, DeleteResult } from './types';
import { formatSize, trashName } from './utils';

export interface DeleteApi {
  moveToTrash: (filePaths: string[]) => Promise<DeleteResult[]>;
  permanentlyDelete: (filePaths: string[]) => Promise<DeleteResult[]>;
}

interface DeleteMarkedVideosOptions extends DeleteApi {
  filePaths: string[];
  /** Asked for the files the Recycle Bin could not take. Only `trash-unavailable` reaches it. */
  confirmPermanentDelete: (filePaths: string[]) => Promise<boolean>;
  /** Asked for files that were in use; accepting retries just those files. */
  confirmRetry?: (filePaths: string[]) => Promise<boolean>;
}

const defaultConfirmRetry = (filePaths: string[]) => Promise.resolve(window.confirm(
  `${filePaths.length} ${filePaths.length === 1 ? 'file is' : 'files are'} still in use by another program. Try again?`,
));

const failedWith = (results: Map<string, DeleteResult>, reason: DeleteFailureReason) =>
  [...results.values()].filter((result) => !result.success && result.reason === reason).map((result) => result.path);

/**
 * Moves the files to the Recycle Bin. Files that were busy are retried on request (only those),
 * and files the Recycle Bin cannot take go to the permanent delete after review. Every other
 * failure is final: it is reported, never turned into a permanent delete.
 */
export async function deleteMarkedVideos({
  filePaths,
  moveToTrash,
  permanentlyDelete,
  confirmPermanentDelete,
  confirmRetry = defaultConfirmRetry,
}: DeleteMarkedVideosOptions): Promise<DeleteResult[]> {
  // The Review player may hold the file open; leaving Review lets it go before the delete starts.
  const { reviewMode, setReviewMode } = useStore.getState();
  if (reviewMode) {
    setReviewMode(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const merged = new Map<string, DeleteResult>();
  const record = (results: DeleteResult[]) => results.forEach((result) => merged.set(result.path, result));
  record(await moveToTrash(filePaths));

  for (let busy = failedWith(merged, 'in-use'); busy.length > 0 && await confirmRetry(busy); busy = failedWith(merged, 'in-use')) {
    record(await moveToTrash(busy));
  }

  const unavailable = failedWith(merged, 'trash-unavailable');
  if (unavailable.length > 0 && await confirmPermanentDelete(unavailable)) {
    record(await permanentlyDelete(unavailable));
  }
  return filePaths.map((filePath) => merged.get(filePath)).filter((result): result is DeleteResult => Boolean(result));
}

export interface DeleteSummary {
  title: string;
  detail: string;
  kind: 'success' | 'warning' | 'error';
}

const reasonText = (reason: DeleteFailureReason): string => ({
  changed: 'changed since the scan',
  unverifiable: 'could not be checked',
  'out-of-scope': 'outside the loaded folders',
  'in-use': 'in use',
  permission: 'permission denied',
  'not-found': 'no longer exists',
  'trash-unavailable': `no ${trashName()} available`,
  unknown: 'unknown error',
})[reason];

/** "2 in use, 1 permission denied" */
export function describeFailureReasons(results: DeleteResult[]): string {
  const counts = new Map<DeleteFailureReason, number>();
  for (const result of results) {
    if (result.success) continue;
    const reason = result.reason ?? 'unknown';
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts].map(([reason, count]) => `${count} ${reasonText(reason)}`).join(', ');
}

/** The one place delete results become toast text. `freedBytes` adds the size to the success message. */
export function summarizeDeleteResults(results: DeleteResult[], { freedBytes }: { freedBytes?: number } = {}): DeleteSummary {
  const removed = results.filter((result) => result.success).length;
  const failed = results.length - removed;
  const permanent = results.filter((result) => result.method === 'permanent' && result.success).length;
  const removedFolders = new Set(results.map((result) => result.removedFolder).filter(Boolean)).size;
  const folderDetail = removedFolders > 0
    ? ` ${removedFolders} empty ${removedFolders === 1 ? 'folder was' : 'folders were'} cleaned up.`
    : '';
  const why = failed > 0 ? describeFailureReasons(results) : '';
  const skipped = `${permanent} skipped ${trashName()}.`;

  if (failed > 0 && removed > 0) {
    return {
      title: 'Delete partly failed',
      detail: `${removed} removed, ${failed} failed (${why}).${permanent > 0 ? ` ${skipped}` : ''}${folderDetail}`,
      kind: 'error',
    };
  }
  if (failed > 0) {
    return { title: 'Delete failed', detail: `${failed} ${failed === 1 ? 'file' : 'files'} could not be removed: ${why}.`, kind: 'error' };
  }
  if (permanent > 0) {
    return { title: 'Permanently deleted', detail: `${permanent} ${permanent === 1 ? 'file' : 'files'} skipped ${trashName()}.${folderDetail}`, kind: 'warning' };
  }
  const noun = removed === 1 ? 'video' : 'videos';
  return {
    title: `Moved to ${trashName()}`,
    detail: freedBytes === undefined
      ? `${removed} ${noun} removed from the session.${folderDetail}`
      : `${removed} ${noun} removed, ${formatSize(freedBytes)} freed.${folderDetail}`,
    kind: 'success',
  };
}
