import type { DeleteResult } from './types';

interface DeleteWithReviewOptions {
  filePaths: string[];
  moveToTrash: (filePaths: string[]) => Promise<DeleteResult[]>;
  permanentlyDelete: (filePaths: string[]) => Promise<DeleteResult[]>;
  confirmPermanentDelete: (filePaths: string[]) => Promise<boolean>;
}

export async function deleteWithPermanentReview({
  filePaths,
  moveToTrash,
  permanentlyDelete,
  confirmPermanentDelete,
}: DeleteWithReviewOptions): Promise<DeleteResult[]> {
  const trashResults = await moveToTrash(filePaths);
  const failedPaths = trashResults.filter((result) => !result.success).map((result) => result.path);
  if (failedPaths.length === 0 || !await confirmPermanentDelete(failedPaths)) return trashResults;

  const permanentResults = await permanentlyDelete(failedPaths);
  const merged = new Map(trashResults.map((result) => [result.path, result]));
  for (const result of permanentResults) merged.set(result.path, result);
  return filePaths.map((filePath) => merged.get(filePath)).filter((result): result is DeleteResult => Boolean(result));
}
