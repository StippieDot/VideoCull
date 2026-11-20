import { rebuildDuplicateGroups, summariseDuplicateGroup } from './duplicateGroupRebuild';
import type { DuplicateGroup, DuplicateVerificationStats, PartialClip, StoredDuplicateResults, Video } from './types';

/** Where the duplicate groups on screen came from: a run, or results stored by an earlier one. */
export interface DuplicateRunInfo {
  createdAt: number;
  settingsKey: string;
  scope: 'all' | 'filtered';
  /** Every video that took part, with the size and modification time it had then. */
  videos: StoredDuplicateResults['videos'];
  restored: boolean;
  /** Scope 'all': videos in the scan that did not take part in the run. */
  addedSince: number;
  /** Near-miss checking of the run; not stored, so absent for restored results. */
  verification?: DuplicateVerificationStats;
}

/** "3 near misses not yet checked". */
export function describeUncheckedNearMisses(count: number): string {
  return `${count} near ${count === 1 ? 'miss' : 'misses'} not yet checked`;
}

export function describeDuplicateRun(
  participants: Video[],
  settingsKey: string,
  scope: 'all' | 'filtered',
  createdAt = Date.now(),
): DuplicateRunInfo {
  return {
    createdAt,
    settingsKey,
    scope,
    videos: participants.map((video) => ({ id: video.id, sizeBytes: video.sizeBytes, date: video.date })),
    restored: false,
    addedSince: 0,
  };
}

/** The file content for the groups on screen: what is needed to rebuild them, without paths. */
export function toStoredResults(run: DuplicateRunInfo, groups: DuplicateGroup[], partialClips: PartialClip[] | null = null): StoredDuplicateResults {
  return {
    ...(partialClips && partialClips.length > 0 ? { partialClips } : {}),
    version: 1,
    createdAt: run.createdAt,
    settingsKey: run.settingsKey,
    scope: run.scope,
    videos: run.videos,
    // A group without pairs comes from an older run and cannot be rebuilt later, so it is not kept.
    groups: groups.filter((group) => group.pairs && group.pairs.length > 0).map((group) => ({
      id: group.id,
      videoIds: group.videoIds,
      pairs: group.pairs!,
      manualSuggestedKeeperId: group.manualSuggestedKeeperId ?? null,
      sampleCount: group.sampleCount ?? 0,
      matchType: group.matchType,
      unreadableSamples: group.unreadableSamples ?? {},
      pictureSizes: group.pictureSizes ?? {},
    })),
  };
}

/**
 * Stored groups against the current scan. A member that is gone, or whose file changed since the run
 * (a new size gives a new ID; a new modification time is compared here), is removed, a pair now on
 * the ignored list is removed, and each group is rebuilt from the pairs that remain.
 */
export function restoreStoredResults(
  stored: StoredDuplicateResults,
  currentVideos: Video[],
  ignoredPairKeys: string[],
): { groups: DuplicateGroup[]; partialClips: PartialClip[] | null; run: DuplicateRunInfo } {
  const current = new Map(currentVideos.map((video) => [video.id, video]));
  const removedVideoIds = new Set(stored.videos.filter((video) => current.get(video.id)?.date !== video.date).map((video) => video.id));
  const ignored = new Set(ignoredPairKeys);
  const partialClips = stored.partialClips?.filter((clip) => (
    current.has(clip.aId) && current.has(clip.bId) && !removedVideoIds.has(clip.aId) && !removedVideoIds.has(clip.bId)
    && !ignored.has(clip.aId < clip.bId ? `${clip.aId}|${clip.bId}` : `${clip.bId}|${clip.aId}`)
  )) ?? null;
  const groups = stored.groups.flatMap((storedGroup) => {
    const template: DuplicateGroup = { ...storedGroup, similarity: 0, suggestedKeeperId: null, reason: '' };
    const full = summariseDuplicateGroup(storedGroup.videoIds, storedGroup.pairs, template, current);
    return rebuildDuplicateGroups([full], { removedVideoIds, ignoredPairKeys: ignored }, current);
  });
  const participants = new Set(stored.videos.map((video) => video.id));
  return {
    groups,
    partialClips,
    run: {
      createdAt: stored.createdAt,
      settingsKey: stored.settingsKey,
      scope: stored.scope,
      videos: stored.videos.filter((video) => !removedVideoIds.has(video.id)),
      restored: true,
      // Videos outside a filtered run were never part of it, so only an 'all' run counts additions.
      addedSince: stored.scope === 'all' ? currentVideos.filter((video) => !participants.has(video.id)).length : 0,
    },
  };
}
