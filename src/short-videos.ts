import type { Video } from './types';

export interface ShortVideoSelection {
  /** Videos that would be marked Delete. */
  eligible: Video[];
  eligibleBytes: number;
  /** Short videos left alone, each counted once under the first protection that applies. */
  protectedCounts: {
    alreadyDelete: number;
    keep: number;
    skipped: number;
    rated: number;
    favorite: number;
    bookmarked: number;
  };
  /** Videos whose length is unknown, so they are never compared with the threshold. */
  unknownDuration: number;
}

function emptySelection(): ShortVideoSelection {
  return {
    eligible: [],
    eligibleBytes: 0,
    protectedCounts: { alreadyDelete: 0, keep: 0, skipped: 0, rated: 0, favorite: 0, bookmarked: 0 },
    unknownDuration: 0,
  };
}

/**
 * Picks the videos shorter than `thresholdSecs` that are safe to mark Delete.
 * Decisions and ratings protect a video even while the rating or favourite UI is hidden,
 * because hiding a feature must not make its data count for nothing.
 */
export function selectShortVideosForDelete(videos: readonly Video[], thresholdSecs: number): ShortVideoSelection {
  const selection = emptySelection();
  if (!Number.isFinite(thresholdSecs) || thresholdSecs <= 0) return selection;

  for (const video of videos) {
    const duration = video.durationSecs;
    if (duration === null || !Number.isFinite(duration) || duration <= 0) {
      selection.unknownDuration += 1;
      continue;
    }
    if (duration >= thresholdSecs) continue;

    const counts = selection.protectedCounts;
    if (video.status === 'delete') counts.alreadyDelete += 1;
    else if (video.status === 'keep') counts.keep += 1;
    else if (video.status === 'skipped') counts.skipped += 1;
    else if (video.rating > 0) counts.rated += 1;
    else if (video.favorite) counts.favorite += 1;
    else if ((video.bookmarks?.length ?? 0) > 0) counts.bookmarked += 1;
    else {
      selection.eligible.push(video);
      selection.eligibleBytes += video.sizeBytes;
    }
  }
  return selection;
}
