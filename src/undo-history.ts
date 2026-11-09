import type { UndoEntry, Video, VideoReviewChanges, VideoStatus } from './types';

export type ReviewEdit = { videoId: string; values: VideoReviewChanges };
type ReviewField = keyof VideoReviewChanges;

const REVIEW_FIELDS: ReviewField[] = ['status', 'rating', 'favorite', 'bookmarks'];

export const STATUS_LABELS: Record<VideoStatus, string> = {
  keep: 'Keep',
  delete: 'Delete',
  skipped: 'Skip',
  pending: 'Reset to pending',
};

export function reviewFieldsOf(values: VideoReviewChanges): ReviewField[] {
  return REVIEW_FIELDS.filter((field) => field in values);
}

/** The video's current value; a video without bookmarks has an empty list, so undo restores one. */
function currentValue(video: Video, field: ReviewField) {
  return field === 'bookmarks' ? video.bookmarks ?? [] : video[field];
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, index) => item === b[index]);
  return a === b;
}

function pick(source: Partial<Record<ReviewField, unknown>>, fields: ReviewField[]): VideoReviewChanges {
  return Object.fromEntries(fields.map((field) => [field, source[field]])) as VideoReviewChanges;
}

/**
 * The edit as one history entry labelled "<action> · <filename or count>", leaving out videos it
 * would not change; null when it changes nothing, so no-op clicks never fill the history.
 */
export function buildUndoEntry(videos: Video[], action: string, edits: ReviewEdit[]): UndoEntry | null {
  const videosById = new Map(videos.map((video) => [video.id, video]));
  const changes: UndoEntry['changes'] = [];
  for (const { videoId, values } of edits) {
    const video = videosById.get(videoId);
    if (!video) continue;
    const fields = reviewFieldsOf(values).filter((field) => !sameValue(currentValue(video, field), values[field]));
    if (fields.length === 0) continue;
    const before = Object.fromEntries(fields.map((field) => [field, currentValue(video, field)]));
    changes.push({ videoId, before: pick(before, fields), after: pick(values, fields) });
  }
  if (changes.length === 0) return null;
  const subject = changes.length === 1 ? videosById.get(changes[0].videoId)?.filename ?? '1 video' : `${changes.length} videos`;
  return { label: `${action} · ${subject}`, changes };
}

/** The edits that put every video of the entry back to its `before` (undo) or `after` (redo) values. */
export function editsFor(entry: UndoEntry, side: 'before' | 'after'): ReviewEdit[] {
  return entry.changes.map((change) => ({ videoId: change.videoId, values: change[side] }));
}
