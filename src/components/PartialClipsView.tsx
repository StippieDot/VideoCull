import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Ban, Check, CheckCircle2, Image, Play, Trash2, Volume2 } from 'lucide-react';
import { List } from 'react-window';
import type { ListImperativeAPI, RowComponentProps } from 'react-window';
import { DUPLICATE_GROUP_GAP, DUPLICATE_GROUP_HEADER_HEIGHT, DUPLICATE_VIDEO_ROW_HEIGHT } from './duplicateVirtualRows';
import useStore, { chooseSuggestedKeeperId, KEEPER_RESOLUTION_MARGIN_SHARE, partialClipCopyKey } from '../store';
import type { DuplicateGroup, PartialClip, PartialClipKind, PartialClipSegment, PartialClipSortField, SortOrder, Video } from '../types';
import { formatDuration, formatFps, formatResolutionLabel, formatSize, resolutionTier } from '../utils';
import { openVideoExternally, revealInExplorer } from '../appCommands';
import ContextMenu, { copyTextToClipboard } from './ContextMenu';
import { buildCopyPathSuccessDetail, buildDuplicateVideoMenu } from './contextMenuBuilders';
import { bitrateLabel, computeBestFlags, parentPath, type MetricFlags } from './DuplicateGroupsView';
import './DuplicateGroupsView.css';
import './PartialClipsView.css';

// A video with nothing missing from the longer one is the same video when it is at least this share
// of the longer one's length, and an excerpt of it otherwise.
const SAME_LENGTH_SHARE = 0.95;
const STATE_ORDER: Record<PartialClip['state'], number> = { confirmed: 0, unconfirmed: 1, differentPicture: 2 };

/** One entry of the list: the pair shown, and the same finding for other copies of the same videos. */
export interface PartialClipEntry {
  primary: PartialClip;
  others: PartialClip[];
}

/**
 * Pairs whose videos belong to the same duplicate groups say the same thing ("this clip comes from that
 * video") once per copy, so they become one entry. It shows the pair with the best picture evidence,
 * preferring the groups' suggested keepers, then the one covering most of the shorter video.
 */
export function mergeClipsByDuplicateGroup(clips: PartialClip[], groups: DuplicateGroup[]): PartialClipEntry[] {
  const groupIdOf = new Map<string, string>();
  for (const group of groups) for (const id of group.videoIds) groupIdOf.set(id, group.id);
  const keepers = new Set(groups.map((group) => group.suggestedKeeperId).filter((id): id is string => Boolean(id)));
  const side = (id: string) => groupIdOf.get(id) ?? id;
  const byKey = new Map<string, PartialClip[]>();
  for (const clip of clips) {
    const key = [side(clip.aId), side(clip.bId)].sort().join('|');
    byKey.set(key, [...(byKey.get(key) ?? []), clip]);
  }
  const keeperCount = (clip: PartialClip) => Number(keepers.has(clip.aId)) + Number(keepers.has(clip.bId));
  return [...byKey.values()].map((list) => {
    const sorted = [...list].sort((x, y) => (
      STATE_ORDER[x.state] - STATE_ORDER[y.state]
      || keeperCount(y) - keeperCount(x)
      || (y.coverage ?? 0) - (x.coverage ?? 0)
    ));
    return { primary: sorted[0]!, others: sorted.slice(1) };
  });
}

function thumbSrc(video: Video): string | null {
  if (video.thumbnails[0]) return `thumb://local/${encodeURIComponent(video.thumbnails[0])}`;
  return video.osThumbnail ?? null;
}

// A position, unlike a duration, can be 0: the start of the video.
const formatPosition = (seconds: number) => (seconds < 1 ? '0:00' : formatDuration(seconds));

/** Seconds of the shorter video inside `segments`, a stretch found twice counted once. */
function shorterSeconds(clip: PartialClip, segments: PartialClipSegment[]): number {
  const spans = segments
    .map((segment) => {
      const start = clip.shorterId === clip.aId ? segment.startA : segment.startB;
      return [start, start + segment.lengthSecs] as const;
    })
    .sort((x, y) => x[0] - y[0]);
  let total = 0;
  let reach = -Infinity;
  for (const [start, end] of spans) {
    if (end > reach) total += end - Math.max(start, reach);
    reach = Math.max(reach, end);
  }
  return total;
}

const confirmedSegments = (clip: PartialClip) => clip.segments.filter((segment) => segment.pictureState === 'confirmed');

/** Gaps in, gap out: a span of seconds. */
type Span = { start: number; end: number };

/**
 * The parts of `video` that the other video of `clip` does not have, in `video`'s own time. A stretch
 * whose sound matches and whose picture could not be checked counts as present: only a picture shown
 * to differ counts as missing.
 */
export function missingFrom(clip: PartialClip, video: Video, edgeSecs: number): Span[] {
  const length = Number(video.durationSecs) || 0;
  const present = clip.segments
    .filter((segment) => segment.pictureState !== 'differentPicture')
    .map((segment) => {
      const start = video.id === clip.aId ? segment.startA : segment.startB;
      return { start, end: start + segment.lengthSecs };
    });
  return length > 0 ? gapsIn(present, length, edgeSecs) : [];
}

/**
 * Seconds of the shorter video whose sound and picture both match. Sound-only stretches are left out:
 * many short ones (shared music) would otherwise rank a weak pair above a real copy.
 */
export const matchedSeconds = (clip: PartialClip) => shorterSeconds(clip, confirmedSegments(clip));

/**
 * One short line on what the pair shares: never "less complete", never "corrupt". The file names are
 * in the rows below it, and the time bar shows where.
 */
export type ClipKind = PartialClipKind;

/**
 * Same video and Fully inside promise that nothing of the shorter video is missing from the longer
 * one, so they are given only when missingFrom finds nothing: the same rule as the row's amber line.
 */
export function clipKind(clip: PartialClip, shorter: Video, longer: Video, edgeSecs: number): ClipKind {
  if (clip.relation !== 'partial') return 'sameSound';
  const shorterSecs = Number(shorter.durationSecs) || 0;
  if (shorterSecs <= 0 || missingFrom(clip, shorter, edgeSecs).length > 0) return 'contains';
  // Pairs of duplicate groups are not searched, so this is a copy the duplicate search did not group.
  return shorterSecs >= SAME_LENGTH_SHARE * (Number(longer.durationSecs) || Infinity) ? 'sameVideo' : 'excerpt';
}

/** The header's description, where a duplicate group says "Identical files". */
function describeMatch(clip: PartialClip, shorter: Video, longer: Video, edgeSecs: number): string {
  const kind = clipKind(clip, shorter, longer, edgeSecs);
  if (kind === 'sameVideo') return 'Same sound and picture over the full length';
  if (kind === 'excerpt') return 'Lies entirely inside the master';
  if (kind === 'contains') {
    const parts = confirmedSegments(clip).length;
    return `${parts} matching ${parts === 1 ? 'part' : 'parts'}`;
  }
  return clip.state === 'differentPicture' ? 'Sound matches, picture does not' : 'Sound matches, picture not checked';
}

/** The card's badge, in the duplicate groups' badge colours: strong, partial, or sound only. */
export function matchBadge(clip: PartialClip, shorter: Video, longer: Video, edgeSecs: number): { label: string; tone: 'exact' | 'potential' | 'low-confidence' } {
  const kind = clipKind(clip, shorter, longer, edgeSecs);
  if (kind === 'sameVideo') return { label: 'Same video', tone: 'exact' };
  if (kind === 'excerpt') return { label: 'Fully inside', tone: 'exact' };
  if (kind === 'contains') return { label: `Shares ${formatDuration(matchedSeconds(clip))}`, tone: 'potential' };
  return { label: clip.state === 'differentPicture' ? 'Same sound, other picture' : 'Same sound', tone: 'low-confidence' };
}

/** `onSetKeeper`: offered on a copy that is not the keeper, as Mark as selected keeper. */
type OpenVideoMenu = (event: React.MouseEvent, videoId: string, scopeIds: string[], onSetKeeper?: () => void) => void;

/** A card of the list: one pair, or a family of videos that are copies or excerpts of each other. */
export type PartialClipCard =
  | { kind: 'pair'; entry: PartialClipEntry }
  | { kind: 'family'; entries: PartialClipEntry[]; videoIds: string[] };

/**
 * Copies and excerpts that share a video become one card, placed where its first pair is in the
 * sorted list. Weaker pairs ("contains 2:00 of") stay apart: joining through them would put
 * unrelated videos together because they share one scene.
 */
export function groupIntoFamilies(entries: PartialClipEntry[], videosById: Map<string, Video>, edgeSecs: number): PartialClipCard[] {
  const strong = new Set(entries.filter(({ primary }) => {
    const shorter = videosById.get(primary.shorterId);
    const longer = videosById.get(primary.shorterId === primary.aId ? primary.bId : primary.aId);
    const kind = shorter && longer ? clipKind(primary, shorter, longer, edgeSecs) : null;
    return kind === 'sameVideo' || kind === 'excerpt';
  }));
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const up = parent.get(id) ?? id;
    if (up === id) return id;
    const root = find(up);
    parent.set(id, root);
    return root;
  };
  for (const entry of strong) parent.set(find(entry.primary.aId), find(entry.primary.bId));
  const families = new Map<string, PartialClipEntry[]>();
  for (const entry of strong) {
    const root = find(entry.primary.aId);
    families.set(root, [...(families.get(root) ?? []), entry]);
  }
  const placed = new Set<string>();
  const cards: PartialClipCard[] = [];
  for (const entry of entries) {
    const root = strong.has(entry) ? find(entry.primary.aId) : null;
    const members = root ? families.get(root)! : [entry];
    if (members.length < 2) {
      cards.push({ kind: 'pair', entry });
    } else if (!placed.has(root!)) {
      placed.add(root!);
      cards.push({ kind: 'family', entries: members, videoIds: [...new Set(members.flatMap(({ primary }) => [primary.aId, primary.bId]))] });
    }
  }
  return cards;
}

/** Hides pairs and keeps them out of later searches; undoable. `who` names them in the toast. */
function dismissPairs(pairs: PartialClip[], who: string) {
  const { dismissPartialClips, pushToast } = useStore.getState();
  const before = useStore.getState().partialClips ?? [];
  dismissPartialClips(pairs);
  pushToast({
    title: 'Marked as not a match',
    detail: `${who} stay out of later searches.`,
    kind: 'info',
    durationMs: 8000,
    actionLabel: 'Undo',
    action: () => {
      useStore.getState().removeIgnoredDuplicatePairs(pairs.map((pair) => (pair.aId < pair.bId ? `${pair.aId}|${pair.bId}` : `${pair.bId}|${pair.aId}`)));
      // The entries return at their old place; anything dismissed since stays out.
      useStore.setState((state) => ({ partialClips: before.filter((clip) => pairs.includes(clip) || state.partialClips?.includes(clip)) }));
    },
  });
}

export type LaneRole = 'master' | 'copy' | 'excerpt' | 'part' | 'sound';

// What is true of the row against the longest video; 'part' is labelled with what it shares instead.
const ROLE_LABELS: Record<LaneRole, string> = { master: 'Longest', copy: 'Same video', excerpt: 'Fully inside', part: 'Shares', sound: 'Same sound' };

export interface Lane {
  video: Video;
  role: LaneRole;
  /** Where the video's matching stretches sit on the master, in master seconds. */
  segments: { start: number; end: number; state: PartialClipSegment['pictureState'] | 'master' }[];
  /** The pair that placed this video, and what Not a match on its row hides. */
  via: { clip: PartialClip; dismiss: PartialClip[]; partner: Video } | null;
  /** Its parts the video it was placed through does not have, in its own time (missingFrom). */
  missing: Span[];
}

/**
 * Every video of a card on one timeline: the longest is the master, and each other video is placed
 * through the pair that links it to a video already placed, so an excerpt of a copy lands where
 * that copy sits on the master. The offset between two videos comes from their longest matching
 * stretch.
 */
export function placeOnMaster(entries: PartialClipEntry[], videosById: Map<string, Video>, edgeSecs: number): Lane[] {
  const pairs = entries.flatMap((entry) => [
    { clip: entry.primary, dismiss: [entry.primary, ...entry.others] },
    ...entry.others.map((other) => ({ clip: other, dismiss: [other] })),
  ]);
  const videos = [...new Set(pairs.flatMap(({ clip }) => [clip.aId, clip.bId]))]
    .map((id) => videosById.get(id))
    .filter((video): video is Video => Boolean(video))
    .sort((x, y) => (Number(y.durationSecs) || 0) - (Number(x.durationSecs) || 0));
  const master = videos[0];
  if (!master) return [];
  const offsets = new Map([[master.id, 0]]);
  const lanes: Lane[] = [{ video: master, role: 'master', segments: [{ start: 0, end: Number(master.durationSecs) || 0, state: 'master' }], via: null, missing: [] }];
  for (let placedOne = true; placedOne;) {
    placedOne = false;
    for (const pair of pairs) {
      const { clip } = pair;
      const known = offsets.has(clip.aId) ? clip.aId : offsets.has(clip.bId) ? clip.bId : null;
      const otherId = known === clip.aId ? clip.bId : clip.aId;
      const other = videosById.get(otherId);
      const partner = known ? videosById.get(known) : undefined;
      if (!known || !other || !partner || offsets.has(otherId)) continue;
      const at = (segment: PartialClipSegment, id: string) => (id === clip.aId ? segment.startA : segment.startB);
      const base = offsets.get(known)!;
      const anchor = [...clip.segments].sort((x, y) => Number(y.pictureState === 'confirmed') - Number(x.pictureState === 'confirmed') || y.lengthSecs - x.lengthSecs)[0];
      if (!anchor) continue;
      offsets.set(otherId, base + at(anchor, known) - at(anchor, otherId));
      const otherIsShorter = clip.shorterId === otherId;
      const kind = otherIsShorter ? clipKind(clip, other, partner, edgeSecs) : clipKind(clip, partner, other, edgeSecs);
      const role: LaneRole = kind === 'sameVideo' ? 'copy' : kind === 'sameSound' ? 'sound' : kind === 'excerpt' && otherIsShorter ? 'excerpt' : 'part';
      lanes.push({
        video: other,
        role,
        segments: clip.segments.map((segment) => {
          const start = base + at(segment, known);
          return { start, end: start + segment.lengthSecs, state: segment.pictureState };
        }),
        via: { clip, dismiss: pair.dismiss, partner },
        // Placed through a copy, that copy stands in for the longest video.
        missing: role === 'sound' ? [] : missingFrom(clip, other, edgeSecs),
      });
      placedOne = true;
    }
  }
  // Below the master in the order they occur in it (scene 1, 2, 3), the longer first at one place.
  // By where the picture matches: sound-only stretches (an intro jingle every scene shares) would
  // put every row at the same place.
  const startOf = (lane: Lane) => {
    const confirmed = lane.segments.filter((segment) => segment.state === 'confirmed');
    return Math.min(...(confirmed.length > 0 ? confirmed : lane.segments).map((segment) => segment.start));
  };
  const [masterLane, ...rest] = lanes;
  return [masterLane!, ...rest.sort((x, y) => startOf(x) - startOf(y) || (Number(y.video.durationSecs) || 0) - (Number(x.video.durationSecs) || 0))];
}

/** A card of the list, with what the sidebar filters and sorts it by. */
export interface ClipCardData {
  entries: PartialClipEntry[];
  /** From placeOnMaster: the list also needs their count for the card's height before drawing it. */
  lanes: Lane[];
  /** What its pairs are; a card of copies and excerpts is both Same video and Fully inside. */
  kinds: ClipKind[];
  /** Its weakest match, picture where compared and sound otherwise, as a duplicate group's score is. */
  score: number;
  /**
   * The most seconds any of its pairs share in sound and picture both; 0 when they share only sound,
   * so a shared song never ranks above a real excerpt.
   */
  sharedSecs: number;
  /** The most seconds any of its pairs share in sound: orders the sound-only cards among themselves. */
  soundSecs: number;
  totalBytes: number;
  /**
   * The video to keep: the copy chosen by hand, else the best copy of the longest video by the duplicate
   * keeper order, else the longest.
   */
  keeperId: string;
  /** The keeper was chosen by hand (Mark as selected keeper), not suggested. */
  keeperSelected: boolean;
  /** The longest video and its copies: the videos that can be chosen as keeper. */
  copyIds: string[];
  /**
   * Videos whose footage all stays in the keeper: its other copies and the videos fully inside it.
   * Videos that only share a stretch or sound are never in it.
   */
  deleteIds: string[];
  /** Of deleteIds, those with a better picture than the keeper; deleting them loses that quality. */
  betterPictureIds: string[];
  /** Size of deleteIds. */
  freeBytes: number;
}

/** What buildClipCards needs from the duplicate settings, and the keepers chosen by hand. */
export interface ClipCardOptions {
  edgeSecs: number;
  keeperOrder: string[];
  codecOrder: string[];
  /** By partialClipCopyKey; see the store's partialClipKeepers. */
  chosenKeepers?: Record<string, string>;
}

const bitrateOf = (video: Video) => video.videoBitrate ?? video.totalBitrate ?? 0;

/** A better picture by the rules the rows mark: a higher resolution class, or a bitrate far above. */
function hasBetterPicture(video: Video, than: Video): boolean {
  const tier = resolutionTier(video.width, video.height);
  const keeperTier = resolutionTier(than.width, than.height);
  return tier > keeperTier * (1 + KEEPER_RESOLUTION_MARGIN_SHARE)
    || (bitrateOf(than) > 0 && bitrateOf(video) >= BITRATE_GAP * bitrateOf(than));
}

/** The keeper of a card and what deleting would lose nothing of; see ClipCardData. */
export function suggestKeeper(
  lanes: Lane[],
  keeperOrder: string[],
  codecOrder: string[],
  chosenKeepers: Record<string, string> = {},
): Pick<ClipCardData, 'keeperId' | 'keeperSelected' | 'copyIds' | 'deleteIds' | 'betterPictureIds'> {
  const copies = lanes.filter((lane) => lane.role === 'master' || lane.role === 'copy');
  const copyIds = copies.map((lane) => lane.video.id);
  // Only a copy can be kept instead: anything else lacks footage the longest video has.
  const chosen = chosenKeepers[partialClipCopyKey(copyIds)];
  const keeperSelected = copies.length > 1 && Boolean(chosen) && copyIds.includes(chosen!);
  const keeperId = keeperSelected
    ? chosen!
    : (copies.length > 1 ? chooseSuggestedKeeperId(copies.map((lane) => lane.video), keeperOrder, codecOrder) : null) ?? lanes[0]!.video.id;
  const keeper = lanes.find((lane) => lane.video.id === keeperId)!.video;
  // An excerpt is fully inside the copy it was placed through, and every copy is the keeper's footage.
  const deletable = lanes.filter((lane) => lane.video.id !== keeperId && (copies.includes(lane) || lane.role === 'excerpt'));
  return {
    keeperId,
    keeperSelected,
    copyIds,
    deleteIds: deletable.map((lane) => lane.video.id),
    // Coverage wins, but not silently: the row says the clip has the better picture.
    betterPictureIds: deletable.filter((lane) => lane.role === 'excerpt' && hasBetterPicture(lane.video, keeper)).map((lane) => lane.video.id),
  };
}

const pairScore = (clip: PartialClip) => clip.pictureSimilarity ?? clip.soundSimilarity;

/** Every card of a result, unfiltered and in no particular order. */
export function buildClipCards(entries: PartialClipEntry[], videosById: Map<string, Video>, { edgeSecs, keeperOrder, codecOrder, chosenKeepers }: ClipCardOptions): ClipCardData[] {
  const kindOf = (clip: PartialClip): ClipKind => {
    const shorter = videosById.get(clip.shorterId);
    const longer = videosById.get(clip.shorterId === clip.aId ? clip.bId : clip.aId);
    return shorter && longer ? clipKind(clip, shorter, longer, edgeSecs) : 'sameSound';
  };
  return groupIntoFamilies(entries, videosById, edgeSecs).flatMap((card) => {
    const list = card.kind === 'pair' ? [card.entry] : card.entries;
    const lanes = placeOnMaster(list, videosById, edgeSecs);
    // A video no longer loaded (deleted, folder removed) leaves nothing to compare.
    if (lanes.length < 2) return [];
    const primaries = list.map((entry) => entry.primary);
    const size = (lane: Lane) => lane.video.sizeBytes ?? 0;
    const keeper = suggestKeeper(lanes, keeperOrder, codecOrder, chosenKeepers);
    return [{
      entries: list,
      lanes,
      kinds: [...new Set(primaries.map(kindOf))],
      score: Math.min(...primaries.map(pairScore)),
      sharedSecs: Math.max(...primaries.map(matchedSeconds)),
      soundSecs: Math.max(...primaries.map((clip) => shorterSeconds(clip, clip.segments))),
      totalBytes: lanes.reduce((sum, lane) => sum + size(lane), 0),
      ...keeper,
      freeBytes: lanes.filter((lane) => keeper.deleteIds.includes(lane.video.id)).reduce((sum, lane) => sum + size(lane), 0),
    }];
  });
}

/** The sidebar's path filter: a card stays when any of its videos' paths contains the text. */
export function matchesPathFilter(card: ClipCardData, pathFilter: string): boolean {
  const query = pathFilter.trim().toLowerCase();
  return !query || card.lanes.some((lane) => lane.video.path.toLowerCase().includes(query));
}

const SORT_VALUES: Record<PartialClipSortField, (card: ClipCardData) => number> = {
  sharedLength: (card) => card.sharedSecs,
  similarity: (card) => card.score,
  videoCount: (card) => card.lanes.length,
  spaceToFree: (card) => card.freeBytes,
  totalSize: (card) => card.totalBytes,
};

/** The sidebar's kind filter (none chosen shows every card) and sort. */
export function filterAndSortCards(
  cards: ClipCardData[],
  options: { kinds: Record<ClipKind, boolean>; sortBy: PartialClipSortField; sortOrder: SortOrder },
): ClipCardData[] {
  const value = SORT_VALUES[options.sortBy];
  const direction = options.sortOrder === 'asc' ? 1 : -1;
  const anyChosen = Object.values(options.kinds).some(Boolean);
  return cards
    .filter((card) => !anyChosen || card.kinds.some((kind) => options.kinds[kind]))
    .sort((x, y) => (value(x) - value(y) || x.soundSecs - y.soundSecs) * direction);
}

/** The list as the sidebar's filters and sort leave it; the view and the sidebar's counts share it. */
export function usePartialClipCards() {
  const clips = useStore((s) => s.partialClips);
  const groups = useStore((s) => s.duplicateGroups);
  const videos = useStore((s) => s.videos);
  const edgeSecs = useStore((s) => s.settings.duplicates.partialClipEdgeSecs);
  const keeperOrder = useStore((s) => s.settings.duplicates.keeperOrder);
  const codecOrder = useStore((s) => s.settings.duplicates.codecOrder);
  const chosenKeepers = useStore((s) => s.partialClipKeepers);
  const pathFilter = useStore((s) => s.duplicatePathFilter);
  const kinds = useStore((s) => s.partialClipKinds);
  const sortBy = useStore((s) => s.partialClipSortBy);
  const sortOrder = useStore((s) => s.partialClipSortOrder);
  const videosById = useMemo(() => new Map(videos.map((video) => [video.id, video])), [videos]);
  const cards = useMemo(
    () => buildClipCards(mergeClipsByDuplicateGroup(clips ?? [], groups), videosById, { edgeSecs, keeperOrder, codecOrder, chosenKeepers }),
    [chosenKeepers, clips, codecOrder, edgeSecs, groups, keeperOrder, videosById],
  );
  const matching = useMemo(() => cards.filter((card) => matchesPathFilter(card, pathFilter)), [cards, pathFilter]);
  const shown = useMemo(() => filterAndSortCards(matching, { kinds, sortBy, sortOrder }), [kinds, matching, sortBy, sortOrder]);
  return { videosById, edgeSecs, cards, matching, shown };
}

function matchLabel(clip: PartialClip): string {
  return clip.pictureSimilarity === null
    ? `sound ${Math.round(clip.soundSimilarity)}%`
    : `sound ${Math.round(clip.soundSimilarity)}% · picture ${Math.round(clip.pictureSimilarity)}%`;
}

// Stretches closer than this share of the master are drawn and listed as one: a few unmatched
// seconds at a scene cut would otherwise split a bar into a dot and a line.
const JOIN_GAP_SHARE = 0.01;

/** The lane's stretches inside the master, each state's touching or nearly touching ones joined. */
export function laneSpans(lane: Lane, masterSecs: number): Lane['segments'] {
  const spans = lane.segments
    .map((segment) => ({ ...segment, start: Math.max(0, segment.start), end: Math.min(masterSecs, segment.end) }))
    .filter((segment) => segment.end > segment.start)
    .sort((x, y) => x.start - y.start);
  const joined: Lane['segments'] = [];
  for (const span of spans) {
    const last = [...joined].reverse().find((candidate) => candidate.state === span.state);
    if (last && span.start - last.end <= JOIN_GAP_SHARE * masterSecs) joined[joined.indexOf(last)] = { ...last, end: Math.max(last.end, span.end) };
    else joined.push(span);
  }
  return joined;
}

// Matches start and end a second or two off the real cut, so shorter gaps are the search, not footage.
const GAP_NOISE_SECS = 3;
// Noise and intro allowances never pass this share of a video: on a short clip they would hide most of it.
// Sync: the Intros and outros setting's help in SettingsModal.tsx states this share.
const EDGE_MAX_SHARE = 0.1;

/**
 * The parts of 0..length that no span covers, leaving out gaps no longer than the ones laneSpans
 * joins (so a bar drawn whole is never also reported as missing a piece), alignment noise, and
 * intros and outros of up to `edgeSecs` (the partialClipEdgeSecs setting).
 */
export function gapsIn(spans: Span[], length: number, edgeSecs: number): Span[] {
  const noise = Math.min(GAP_NOISE_SECS, EDGE_MAX_SHARE * length);
  const edge = Math.min(edgeSecs, EDGE_MAX_SHARE * length);
  const gaps: Span[] = [];
  let reach = 0;
  for (const span of [...spans].sort((x, y) => x.start - y.start)) {
    if (span.start > reach) gaps.push({ start: reach, end: Math.min(span.start, length) });
    reach = Math.max(reach, span.end);
  }
  if (reach < length) gaps.push({ start: reach, end: length });
  return gaps.filter((gap) => {
    const secs = gap.end - gap.start;
    const atEdge = gap.start <= 0 || gap.end >= length;
    return secs > Math.max(JOIN_GAP_SHARE * length, noise) && (!atEdge || secs > edge);
  });
}

/** "first 0:12", "last 0:04", or "0:40 at 5:10", in the video's own time. */
function describeGap(gap: { start: number; end: number }, length: number): string {
  const duration = formatDuration(gap.end - gap.start);
  if (gap.start <= 0) return `first ${duration}`;
  if (gap.end >= length) return `last ${duration}`;
  return `${duration} at ${formatPosition(gap.start)}`;
}

/** The sound and picture match as icon chips; no picture chip when the picture was not compared. */
function MatchChips({ clip }: { clip: PartialClip }) {
  return (
    <span className="duplicate-meta-chips">
      <span className="meta-chip" title={`Sound matches ${Math.round(clip.soundSimilarity)}%`}>
        <Volume2 size={12} aria-hidden="true" />
        {Math.round(clip.soundSimilarity)}%
      </span>
      {clip.pictureSimilarity !== null && (
        <span className="meta-chip" title={`Picture matches ${Math.round(clip.pictureSimilarity)}%`}>
          <Image size={12} aria-hidden="true" />
          {Math.round(clip.pictureSimilarity)}%
        </span>
      )}
    </span>
  );
}

/** The row's place on the master: one bar per matching stretch, on the scale of the master's length. */
function LaneBar({ lane, masterSecs, uncovered, betterPicture }: {
  lane: Lane;
  masterSecs: number;
  /** Suggested for deletion although its picture is better than the keeper's (suggestKeeper). */
  betterPicture: boolean;
  /** On the master's row: its parts that no other video of the card matches. */
  uncovered: { start: number; end: number }[];
}) {
  if (masterSecs <= 0) return <div className="partial-lane" />;
  const where = (start: number, end: number) => `${formatPosition(start)} to ${formatPosition(end)}`;
  const list = (spans: { start: number; end: number }[], describe: (span: { start: number; end: number }) => string) =>
    spans.slice(0, 2).map(describe).join(', ') + (spans.length > 2 ? `, +${spans.length - 2} more` : '');
  // The master's row is the time scale the other rows are drawn on, not a match of its own.
  if (!lane.via) {
    const missing = list(uncovered, (gap) => where(gap.start, gap.end));
    return (
      <div className="partial-lane" role="img" aria-label={`Time scale of the longest video, 0:00 to ${formatDuration(masterSecs)}${missing ? `; not in the other videos: ${missing}` : ''}`}>
        <div className="partial-lane-axis">
          {uncovered.map((gap) => (
            <span
              key={gap.start}
              className="partial-lane-gap"
              title={`Not in the other videos: ${where(gap.start, gap.end)}`}
              style={{ left: `${(gap.start / masterSecs) * 100}%`, width: `${Math.max(0.5, ((gap.end - gap.start) / masterSecs) * 100)}%` }}
            />
          ))}
        </div>
        <span className="partial-lane-label partial-lane-axis-labels">
          <span>0:00</span>
          <span>Timeline of the longest video</span>
          <span>{formatDuration(masterSecs)}</span>
        </span>
        {missing && <span className="partial-lane-missing">Not in the other videos: {missing}</span>}
      </div>
    );
  }
  // This video's own stretches outside the longest one have no place on its timeline, so they are
  // told in this video's own time.
  const ownSecs = Number(lane.video.durationSecs) || 0;
  const outsideText = list(lane.missing, (gap) => describeGap(gap, ownSecs));
  const spans = laneSpans(lane, masterSecs);
  const matching = spans.filter((span) => span.state === 'confirmed');
  const times = list(matching.length > 0 ? matching : spans, (span) => where(span.start, span.end));
  const label = `${matching.length > 0 ? 'Matches the longest video' : 'Same sound as the longest video'} at ${times}; ${matchLabel(lane.via.clip)}${outsideText ? `; not in the longest: ${outsideText}` : ''}`;
  return (
    <div className="partial-lane" role="img" aria-label={label}>
      <div className="partial-lane-track">
        {spans.map((span, index) => (
          <span
            key={index}
            className={`partial-lane-segment ${span.state}`}
            title={where(span.start, span.end)}
            style={{ left: `${(span.start / masterSecs) * 100}%`, width: `${Math.max(0.5, ((span.end - span.start) / masterSecs) * 100)}%` }}
          />
        ))}
      </div>
      <span className="partial-lane-label">
        <MatchChips clip={lane.via.clip} />
        <span className="partial-lane-times" title="Where this video appears on the timeline of the longest video">{times}</span>
      </span>
      {outsideText && <span className="partial-lane-missing" title="Parts of this video, in its own time, that the longest video does not have">Not in the longest: {outsideText}</span>}
      {/* A fully-inside video has no missing parts, so this note never shares the line with them. */}
      {betterPicture && !outsideText && (
        <span className="partial-lane-missing" title="Suggested for deletion because the keeper has all its footage, but this video has the better picture: deleting it loses that quality">
          Better picture than the keeper
        </span>
      )}
    </div>
  );
}

function ClipVideoRow({ lane, masterSecs, uncovered, splittable, flags, scopeIds, onContextMenu, keeper, onSetKeeper, betterPicture, isSelected, onToggleSelection }: {
  lane: Lane;
  /** This row is the card's keeper: chosen by hand, or suggested. */
  keeper: 'selected' | 'suggested' | null;
  onSetKeeper?: () => void;
  /** Suggested for deletion although its picture is better than the keeper's. */
  betterPicture: boolean;
  isSelected: boolean;
  onToggleSelection: (videoId: string) => void;
  masterSecs: number;
  uncovered: { start: number; end: number }[];
  /** More than two videos: each row can take its own pair out of the card. */
  splittable: boolean;
  /** Better / worse marks, only between copies of the same video. */
  flags: MetricFlags;
  scopeIds: string[];
  onContextMenu: OpenVideoMenu;
}) {
  const { video, via } = lane;
  // An unknown value (no resolution read yet) is left out rather than shown as an empty chip.
  const chip = (key: string, label: string) => label && <span className={`meta-chip ${flags[key] ?? 'equal'}`}>{label}</span>;
  const setVideoStatus = useStore((s) => s.setVideoStatus);
  const enterReviewAndPlay = useStore((s) => s.enterReviewAndPlay);
  const thumbnail = thumbSrc(video);
  const toggle = (status: 'keep' | 'delete') => setVideoStatus(video.id, video.status === status ? 'pending' : status);
  return (
    <div
      className={`duplicate-row partial-clip-video ${video.status !== 'pending' ? `status-${video.status}` : ''}`}
      onContextMenu={(event) => onContextMenu(event, video.id, scopeIds, onSetKeeper)}
    >
      <label className="duplicate-select-cell" title="Select video">
        <input type="checkbox" checked={isSelected} onChange={() => onToggleSelection(video.id)} aria-label={`Select ${video.filename}`} />
      </label>
      {thumbnail ? <img src={thumbnail} alt="" /> : <span className="partial-clip-thumb-placeholder" />}
      <div className="duplicate-row-copy">
        <div className="duplicate-row-title">
          <strong title={video.path}>{video.filename}</strong>
          <span className={`partial-clip-role ${lane.role}`}>
            {lane.role === 'part' && via ? `Shares ${formatDuration(matchedSeconds(via.clip))}` : ROLE_LABELS[lane.role]}
            {keeper && (
              <span
                className="partial-clip-keeper"
                title={keeper === 'selected'
                  ? 'Selected keeper: chosen by hand. Mark the suggested copy as selected keeper to go back to it.'
                  : 'Suggested keeper: all footage of the videos suggested for deletion is in this video'}
              >
                <span aria-hidden="true">·</span>
                <CheckCircle2 size={11} aria-hidden="true" />
                {keeper === 'selected' ? 'Selected keeper' : 'Suggested keeper'}
              </span>
            )}
          </span>
        </div>
        <span className="duplicate-row-path" title={video.path}>{parentPath(video.path)}</span>
        <span className="duplicate-meta-chips">
          {chip('resolution', formatResolutionLabel(video.width, video.height))}
          {chip('fps', formatFps(video.fps))}
          {chip('bitrate', bitrateLabel(video))}
          {chip('duration', formatDuration(video.durationSecs))}
          {chip('size', formatSize(video.sizeBytes))}
        </span>
      </div>
      <LaneBar lane={lane} masterSecs={masterSecs} uncovered={uncovered} betterPicture={betterPicture} />
      {/* The row's colored edge and the pressed Keep or Delete button say how it is marked. */}
      <div className="partial-clip-actions">
        <button
          className={`duplicate-play-btn ${video.status === 'keep' ? 'active' : ''}`}
          onClick={() => toggle('keep')}
          aria-pressed={video.status === 'keep'}
          title={video.status === 'keep' ? 'Unmark keep' : 'Mark keep'}
          aria-label={`${video.status === 'keep' ? 'Unmark keep' : 'Mark keep'}: ${video.filename}`}
        >
          <Check size={14} />
        </button>
        <button
          className={`duplicate-play-btn ${video.status === 'delete' ? 'active' : ''}`}
          onClick={() => toggle('delete')}
          aria-pressed={video.status === 'delete'}
          title={video.status === 'delete' ? 'Unmark delete' : 'Mark delete'}
          aria-label={`${video.status === 'delete' ? 'Unmark delete' : 'Mark delete'}: ${video.filename}`}
        >
          <Trash2 size={14} />
        </button>
        <button
          className="duplicate-play-btn"
          onClick={() => enterReviewAndPlay(video.id, scopeIds)}
          title="Play in review mode"
          aria-label={`Play ${video.filename}`}
        >
          <Play size={14} />
        </button>
        {splittable && via && (
          <button
            className="duplicate-play-btn"
            onClick={() => dismissPairs(via.dismiss, `${video.filename} and ${via.partner.filename}`)}
            title="Not a match: take this video out of the card and keep the pair out of later searches"
            aria-label={`Not a match: ${video.filename} and ${via.partner.filename}`}
          >
            <Ban size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

// Between videos that are not copies, only a bitrate this many times another's is worth a mark.
const BITRATE_GAP = 1.5;

/**
 * Better / worse marks. Copies of the same video compare everything, as duplicates do. Other rows
 * compare only what says which file looks better: resolution, and a bitrate far apart.
 */
export function cardFlags(lanes: Lane[]): Map<string, MetricFlags> {
  const copies = lanes.filter((lane) => lane.role === 'master' || lane.role === 'copy');
  const copyFlags = copies.length > 1 ? computeBestFlags(copies.map((lane) => lane.video)) : new Map<string, MetricFlags>();
  const all = computeBestFlags(lanes.map((lane) => lane.video));
  const bitrate = (video: Video) => video.videoBitrate ?? video.totalBitrate ?? 0;
  const top = Math.max(...lanes.map((lane) => bitrate(lane.video)));
  const far = lanes.some((lane) => bitrate(lane.video) > 0 && bitrate(lane.video) * BITRATE_GAP <= top);
  return new Map(lanes.map(({ video }) => [video.id, copyFlags.get(video.id) ?? {
    resolution: all.get(video.id)?.resolution ?? 'equal',
    bitrate: !far || bitrate(video) <= 0 ? 'equal' : bitrate(video) * BITRATE_GAP <= top ? 'worse' : 'best',
  }]));
}

const ClipCard = memo(function ClipCard({ card, index, videosById, edgeSecs, onVideoContextMenu, selectedIds, onToggleSelection, onSelectForDeletion }: {
  card: ClipCardData;
  selectedIds: Set<string>;
  onToggleSelection: (videoId: string) => void;
  onSelectForDeletion: (card: ClipCardData) => void;
  /** Place in the list, for the title bar's entry stepper. */
  index: number;
  videosById: Map<string, Video>;
  /** The partialClipEdgeSecs setting. */
  edgeSecs: number;
  onVideoContextMenu: OpenVideoMenu;
}) {
  const { entries, lanes } = card;
  const setPartialClipKeeper = useStore((s) => s.setPartialClipKeeper);
  const keeperOrder = useStore((s) => s.settings.duplicates.keeperOrder);
  const codecOrder = useStore((s) => s.settings.duplicates.codecOrder);
  const setKeeper = (copyIds: string[], videoId: string) => {
    const suggested = suggestKeeper(lanes, keeperOrder, codecOrder).keeperId;
    setPartialClipKeeper(copyIds, videoId === suggested ? null : videoId);
  };
  const master = lanes[0];
  const first = entries[0]?.primary;
  if (!master || !first) return null;
  const masterSecs = Number(master.video.durationSecs) || 0;
  const scopeIds = lanes.map((lane) => lane.video.id);
  const shorter = videosById.get(first.shorterId);
  const longer = videosById.get(first.shorterId === first.aId ? first.bId : first.aId);
  const pair = entries.length === 1 && shorter && longer ? { shorter, longer } : null;
  const badge = pair ? matchBadge(first, pair.shorter, pair.longer, edgeSecs) : { label: 'Same footage', tone: 'exact' };
  const count = (role: LaneRole, one: string, many: string) => {
    const n = lanes.filter((lane) => lane.role === role).length;
    return n === 0 ? null : `${n} ${n === 1 ? one : many}`;
  };
  const description = pair
    ? describeMatch(first, pair.shorter, pair.longer, edgeSecs)
    : [count('copy', 'same video', 'same videos'), count('excerpt', 'fully inside', 'fully inside'), count('part', 'sharing a stretch', 'sharing stretches')].filter(Boolean).join(', ');
  const allPairs = entries.flatMap((entry) => [entry.primary, ...entry.others]);
  const flags = cardFlags(lanes);
  // The longest video's parts that no other video of the card matches in picture.
  // Sound with an unchecked picture counts as present here too, as it does in missingFrom.
  const matched = lanes.slice(1).flatMap((lane) => lane.segments.filter((segment) => segment.state !== 'differentPicture'));
  // With one other video its row's gaps already say this; only several rows together leave parts
  // that none of them has. Only sound in common: nothing of the longest is matched, which says nothing.
  const uncovered = lanes.length > 2 && matched.length > 0 ? gapsIn(matched, masterSecs, edgeSecs) : [];
  return (
    <article className={`partial-clip-card ${first.relation}`} data-entry-index={index}>
      <header className="duplicate-group-header partial-clip-header">
        <div className="duplicate-group-title">
          {/* The badge and the timelines say what the videos share; the sentence is in the tooltip. */}
          <span className={`duplicate-match-badge ${badge.tone}`} title={description}>{badge.label}</span>
          <strong title={pair ? matchLabel(first) : `Weakest of ${allPairs.length} matches`}>{card.score.toFixed(1)}%</strong>
          <em className="duplicate-group-fact">{lanes.length} videos</em>
          <em className="duplicate-group-fact">{formatSize(card.totalBytes)}</em>
        </div>
        <div className="duplicate-group-actions">
          {card.deleteIds.length > 0 && (
            <button
              className="duplicate-group-action-btn select"
              onClick={() => onSelectForDeletion(card)}
              title="Select the videos whose footage all stays in the suggested keeper"
            >
              <Trash2 size={13} />
              Select for deletion
            </button>
          )}
          <button
            className="duplicate-group-action-btn"
            onClick={() => dismissPairs(allPairs, pair ? `${pair.shorter.filename} and ${pair.longer.filename}` : `These ${lanes.length} videos`)}
            title="Hide this card and keep its pairs out of later searches"
          >
            <Ban size={13} />
            Not a match
          </button>
        </div>
      </header>
      {lanes.map((lane) => (
        <ClipVideoRow
          key={lane.video.id}
          lane={lane}
          masterSecs={masterSecs}
          uncovered={lane === master ? uncovered : []}
          splittable={lanes.length > 2}
          flags={flags.get(lane.video.id) ?? {}}
          scopeIds={scopeIds}
          onContextMenu={onVideoContextMenu}
          keeper={lane.video.id !== card.keeperId || card.deleteIds.length === 0 ? null : card.keeperSelected ? 'selected' : 'suggested'}
          // Choosing the suggested copy again goes back to the suggestion.
          onSetKeeper={card.copyIds.length > 1 && card.copyIds.includes(lane.video.id) && lane.video.id !== card.keeperId
            ? () => setKeeper(card.copyIds, lane.video.id)
            : undefined}
          betterPicture={card.betterPictureIds.includes(lane.video.id)}
          isSelected={selectedIds.has(lane.video.id)}
          onToggleSelection={onToggleSelection}
        />
      ))}
    </article>
  );
});

interface RowData {
  cards: ClipCardData[];
  videosById: Map<string, Video>;
  edgeSecs: number;
  onVideoContextMenu: OpenVideoMenu;
  selectedIds: Set<string>;
  onToggleSelection: (videoId: string) => void;
  onSelectForDeletion: (card: ClipCardData) => void;
}

const CARD_BORDERS = 2;

// Sync: the header and row heights in PartialClipsView.css are these values.
function itemHeight(index: number, { cards }: RowData): number {
  const gap = index > 0 ? DUPLICATE_GROUP_GAP : 0;
  return gap + CARD_BORDERS + DUPLICATE_GROUP_HEADER_HEIGHT + cards[index]!.lanes.length * DUPLICATE_VIDEO_ROW_HEIGHT;
}

function PartialClipRow({ index, style, ariaAttributes, cards, ...cardProps }: RowComponentProps<RowData>) {
  const shell = { ...style, boxSizing: 'border-box' as const, paddingTop: index > 0 ? DUPLICATE_GROUP_GAP : 0, paddingLeft: 20, paddingRight: 20 };
  return (
    <div style={shell} {...ariaAttributes}>
      <ClipCard card={cards[index]!} index={index} {...cardProps} />
    </div>
  );
}

/**
 * The result of Find partial clips: pairs where one video contains a stretch of the other, and pairs
 * that only share sound. A deletion is suggested only for a video whose footage all stays in the
 * keeper (suggestKeeper): an excerpt is not interchangeable with its source otherwise.
 */
function PartialClipsView() {
  const { videosById, edgeSecs, cards, shown } = usePartialClipCards();
  const protectKeep = useStore((s) => s.settings.duplicates.protectKeep);
  const protectSkipped = useStore((s) => s.settings.duplicates.protectSkipped);
  const [menu, setMenu] = useState<{ x: number; y: number; videoId: string; scopeIds: string[]; onSetKeeper?: () => void } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  // As in duplicate review: protected videos are never suggested, and with the keeper already marked
  // Delete, selecting the rest would delete every copy of that footage.
  const markableIds = useCallback((card: ClipCardData) => {
    if (videosById.get(card.keeperId)?.status === 'delete') return [];
    return card.deleteIds.filter((id) => {
      const video = videosById.get(id);
      return video && !(protectKeep && video.status === 'keep') && !(protectSkipped && video.status === 'skipped');
    });
  }, [protectKeep, protectSkipped, videosById]);
  const toggleSelection = useCallback((videoId: string) => setSelectedIds((previous) => {
    const next = new Set(previous);
    if (!next.delete(videoId)) next.add(videoId);
    return next;
  }), []);
  const selectForDeletion = useCallback((card: ClipCardData) => setSelectedIds((previous) => {
    const inCard = new Set(card.lanes.map((lane) => lane.video.id));
    return new Set([...[...previous].filter((id) => !inCard.has(id)), ...markableIds(card)]);
  }), [markableIds]);
  const markSelected = () => {
    const ids = [...selectedIds].filter((id) => videosById.has(id));
    if (ids.length === 0) return;
    useStore.getState().setVideoStatusesBatch(ids, 'delete');
    useStore.getState().pushToast({
      title: 'Partial clips marked',
      detail: `${ids.length} ${ids.length === 1 ? 'video' : 'videos'} marked for deletion. Nothing was deleted from disk.`,
      kind: 'success',
    });
  };
  const listRef = useRef<ListImperativeAPI | null>(null);
  const openVideoMenu = useCallback<OpenVideoMenu>((event, videoId, scopeIds, onSetKeeper) => {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, videoId, scopeIds, onSetKeeper });
  }, []);
  const rowProps = useMemo<RowData>(() => ({
    cards: shown, videosById, edgeSecs, onVideoContextMenu: openVideoMenu, selectedIds, onToggleSelection: toggleSelection, onSelectForDeletion: selectForDeletion,
  }), [edgeSecs, openVideoMenu, selectForDeletion, selectedIds, shown, toggleSelection, videosById]);

  // The title bar's stepper: the first card in view.
  const handleRowsRendered = useCallback(({ startIndex }: { startIndex: number; stopIndex: number }) => {
    useStore.getState().setDuplicatePosition({ group: startIndex, total: shown.length });
  }, [shown.length]);
  useEffect(() => {
    useStore.getState().setDuplicatePosition({ group: 0, total: shown.length });
  }, [shown.length]);
  useEffect(() => () => useStore.getState().setDuplicatePosition(null), []);

  const jump = useStore((s) => s.duplicateGroupJump);
  const handledJumpRef = useRef(jump?.id ?? 0);
  useEffect(() => {
    if (!jump || handledJumpRef.current === jump.id) return;
    handledJumpRef.current = jump.id;
    if (jump.index < shown.length) listRef.current?.scrollToRow({ index: jump.index, align: 'start' });
  }, [jump, shown.length]);

  const menuVideo = menu ? videosById.get(menu.videoId) : undefined;
  const menuItems = menu && menuVideo ? buildDuplicateVideoMenu({
    onPlay: () => useStore.getState().enterReviewAndPlay(menuVideo.id, menu.scopeIds),
    onOpenExternal: () => openVideoExternally(menuVideo.path),
    onReveal: () => revealInExplorer(menuVideo.path),
    onMarkDelete: () => useStore.getState().setVideoStatus(menuVideo.id, 'delete'),
    onMarkKeep: () => useStore.getState().setVideoStatus(menuVideo.id, 'keep'),
    onResetPending: () => useStore.getState().setVideoStatus(menuVideo.id, 'pending'),
    onSetSelectedKeeper: menu.onSetKeeper,
    onCopyPath: () => {
      const { pushToast } = useStore.getState();
      copyTextToClipboard(menuVideo.path).then(
        () => pushToast({ title: 'Path copied', detail: buildCopyPathSuccessDetail(menuVideo.path), kind: 'success' }),
        () => pushToast({ title: 'Copy failed', detail: 'The path could not be copied to the clipboard.', kind: 'error' }),
      );
    },
  }) : [];

  return (
    <div className="duplicate-groups-view partial-clips-view">
      <div className="duplicate-toolbar">
        <div>
          <h2>Partial clips</h2>
          <span>
            {shown.length.toLocaleString()} {shown.length === 1 ? 'entry' : 'entries'}
            {shown.length < cards.length ? ` of ${cards.length.toLocaleString()}; the rest are filtered out` : ''}
          </span>
        </div>
        <div className="duplicate-toolbar-actions">
          <button
            className="duplicate-action-btn secondary"
            onClick={() => setSelectedIds(new Set(shown.flatMap(markableIds)))}
            title="Select, in the entries shown, the videos whose footage all stays in the suggested keeper. Files are not deleted until you confirm batch deletion."
          >
            Select suggested deletions
          </button>
          {selectedIds.size > 0 && (
            <button className="duplicate-action-btn secondary" onClick={() => setSelectedIds(new Set())}>
              Clear selected
            </button>
          )}
          <button
            className="duplicate-action-btn"
            onClick={markSelected}
            disabled={selectedIds.size === 0}
            title="Mark the selected videos for deletion review. Files are not deleted until you confirm batch deletion."
          >
            <Trash2 size={14} />
            Mark selected as Delete{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
          </button>
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="partial-clips-empty">
          {cards.length === 0 ? 'No video contains part of another.' : 'No entries match the filters.'}
        </p>
      ) : (
        <List
          className="partial-clips-list"
          listRef={listRef}
          rowCount={shown.length}
          rowComponent={PartialClipRow}
          rowHeight={itemHeight}
          rowProps={rowProps}
          overscanCount={2}
          onRowsRendered={handleRowsRendered}
        />
      )}
      {menu && menuVideo && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}

export default memo(PartialClipsView);
