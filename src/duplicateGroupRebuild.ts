import type { DuplicateGroup, DuplicateGroupPair, Video } from './types';

// SYNC NOTE: summariseDuplicateGroup and stableDuplicateGroupId mirror the summary at the end of
// buildGroups and stableDuplicateGroupId in electron/duplicates.js. The parity test in
// tests/src/duplicateGroupRebuild.test.ts runs both on the same groups.

const DURATION_DIFFERENCE_MIN_SECS = 1;
const DURATION_DIFFERENCE_MIN_SHARE = 0.01;

function fnv1a(text: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** The same members always give the same ID, in the backend and here. */
export function stableDuplicateGroupId(ids: string[]): string {
  const key = [...ids].sort().join('\0');
  return `dup-${fnv1a(key, 0x811c9dc5)}${fnv1a(key, 0x01234567)}`;
}

function durationDifference(videos: Video[]): number | null {
  const durations = videos.map((video) => Number(video.durationSecs)).filter((duration) => duration > 0);
  if (durations.length < 2) return null;
  const longest = Math.max(...durations);
  const difference = longest - Math.min(...durations);
  if (difference <= Math.max(DURATION_DIFFERENCE_MIN_SECS, longest * DURATION_DIFFERENCE_MIN_SHARE)) return null;
  return Math.round(difference * 10) / 10;
}

/**
 * The group fields that follow from its members and accepted pairs: score, kind, wording, evidence and
 * flags. Keeper fields are left as they are; the caller applies the keeper order afterwards.
 */
export function summariseDuplicateGroup(
  memberIds: string[],
  pairs: DuplicateGroupPair[],
  template: DuplicateGroup,
  videosById: Map<string, Video>,
): DuplicateGroup {
  const sampleCount = template.sampleCount ?? 0;
  const similarities = pairs.map((pair) => pair.similarity);
  const exactVideoIds = new Set<string>();
  let fuzzyMatchType: DuplicateGroup['matchType'] | null = null;
  let fewestComparedSamples: number | null = null;
  let lowConfidence = false;
  const flags = { static: false, borderAdjusted: false, flipped: false, partialFingerprint: false };
  for (const pair of pairs) {
    if (pair.matchType === 'exact') {
      exactVideoIds.add(pair.aId);
      exactVideoIds.add(pair.bId);
      continue;
    }
    fuzzyMatchType = fuzzyMatchType && fuzzyMatchType !== pair.matchType ? 'mixed' : pair.matchType;
    if (pair.confidence === 'low') lowConfidence = true;
    if (Number.isFinite(pair.comparedSamples)) {
      fewestComparedSamples = Math.min(fewestComparedSamples ?? Infinity, pair.comparedSamples as number);
    }
    for (const flag of Object.keys(flags) as Array<keyof typeof flags>) {
      if (pair[flag]) flags[flag] = true;
    }
  }
  const hasExact = exactVideoIds.size > 0;
  const matchType = hasExact && fuzzyMatchType ? 'mixed' : hasExact ? 'exact' : fuzzyMatchType ?? template.matchType;
  const sameContent = `same content at ${fewestComparedSamples ?? sampleCount} of ${sampleCount} sampled moments`;
  const keepManual = template.manualSuggestedKeeperId && memberIds.includes(template.manualSuggestedKeeperId);
  const unreadableSamples = template.unreadableSamples
    ? Object.fromEntries(Object.entries(template.unreadableSamples).filter(([videoId]) => memberIds.includes(videoId)))
    : undefined;
  const average = similarities.length > 0 ? similarities.reduce((sum, value) => sum + value, 0) / similarities.length : 0;
  return {
    ...template,
    id: stableDuplicateGroupId(memberIds),
    videoIds: memberIds,
    pairs,
    similarity: similarities.length > 0
      ? Math.floor(Math.min(...similarities) * 10 + 1e-9) / 10
      : 0,
    averageSimilarity: Math.round(average * 10) / 10,
    matchType,
    exactVideoIds: Array.from(exactVideoIds),
    ...flags,
    comparedSamples: fewestComparedSamples,
    confidence: lowConfidence ? 'low' : 'normal',
    relation: matchType === 'exact' ? 'exact' : 'sameSpan',
    durationDifferenceSecs: durationDifference(memberIds.map((id) => videosById.get(id)).filter((video): video is Video => Boolean(video))),
    reason: matchType === 'exact'
      ? 'Identical files'
      : matchType === 'mixed'
        ? `Identical files and ${sameContent}`
        : `S${sameContent.slice(1)}`,
    manualSuggestedKeeperId: keepManual ? template.manualSuggestedKeeperId : null,
    unreadableSamples,
  };
}

function pairKey(aId: string, bId: string): string {
  return aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`;
}

/** Members that the remaining pairs connect, as separate sets. */
function connectedSets(memberIds: string[], pairs: DuplicateGroupPair[]): string[][] {
  const parent = new Map(memberIds.map((id) => [id, id]));
  const root = (id: string): string => {
    let current = id;
    while (parent.get(current) !== current) current = parent.get(current)!;
    parent.set(id, current);
    return current;
  };
  for (const pair of pairs) parent.set(root(pair.aId), root(pair.bId));
  const sets = new Map<string, string[]>();
  for (const id of memberIds) {
    const key = root(id);
    sets.set(key, [...(sets.get(key) ?? []), id]);
  }
  return [...sets.values()];
}

/**
 * Groups after videos were removed or pairs were marked as not a match. A group is rebuilt from its
 * accepted pairs: pairs with a removed video or an ignored key are dropped, the members still connected
 * form the new groups, and their scores and flags come from the pairs that are left, so A and C stop
 * being a group when only B linked them. A group without stored pairs (an older result) only loses the
 * removed members.
 */
export function rebuildDuplicateGroups(
  groups: DuplicateGroup[],
  { removedVideoIds = new Set<string>(), ignoredPairKeys = new Set<string>() }: {
    removedVideoIds?: Set<string>;
    ignoredPairKeys?: Set<string>;
  },
  videosById: Map<string, Video>,
): DuplicateGroup[] {
  return groups.flatMap((group) => {
    const memberIds = group.videoIds.filter((id) => !removedVideoIds.has(id));
    if (!group.pairs) {
      if (memberIds.length === group.videoIds.length) return [group];
      if (memberIds.length < 2) return [];
      return [{
        ...group,
        videoIds: memberIds,
        exactVideoIds: group.exactVideoIds?.filter((id) => !removedVideoIds.has(id)),
        manualSuggestedKeeperId: group.manualSuggestedKeeperId && removedVideoIds.has(group.manualSuggestedKeeperId)
          ? null
          : group.manualSuggestedKeeperId,
      }];
    }
    const pairs = group.pairs.filter((pair) => (
      !removedVideoIds.has(pair.aId) && !removedVideoIds.has(pair.bId) && !ignoredPairKeys.has(pairKey(pair.aId, pair.bId))
    ));
    if (memberIds.length === group.videoIds.length && pairs.length === group.pairs.length) return [group];
    return connectedSets(memberIds, pairs)
      .filter((ids) => ids.length >= 2)
      .map((ids) => {
        const members = new Set(ids);
        const setPairs = pairs.filter((pair) => members.has(pair.aId) && members.has(pair.bId));
        return summariseDuplicateGroup(ids, setPairs, group, videosById);
      });
  });
}
