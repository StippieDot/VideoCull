import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Ban, Check, ChevronDown, ChevronRight, Image, Play, Trash2, Volume2 } from 'lucide-react';
import { List } from 'react-window';
import type { ListImperativeAPI, RowComponentProps } from 'react-window';
import { DUPLICATE_GROUP_GAP, DUPLICATE_GROUP_HEADER_HEIGHT, DUPLICATE_VIDEO_ROW_HEIGHT } from './duplicateVirtualRows';
import useStore from '../store';
import type { DuplicateGroup, PartialClip, PartialClipSegment, PartialClipSortField, SortOrder, Video } from '../types';
import { formatDuration, formatFps, formatResolutionLabel, formatSize } from '../utils';
import { openVideoExternally, revealInExplorer } from '../appCommands';
import ContextMenu, { copyTextToClipboard } from './ContextMenu';
import { buildCopyPathSuccessDetail, buildDuplicateVideoMenu } from './contextMenuBuilders';
import { bitrateLabel, computeBestFlags, parentPath, statusBadgeContent, type MetricFlags } from './DuplicateGroupsView';
import './DuplicateGroupsView.css';
import './PartialClipsView.css';

// An excerpt covering this much of the shorter video is described as an excerpt of the longer one.
const EXCERPT_COVERAGE = 0.9;
// ...and as the same video when the shorter one is at least this share of the longer one's length.
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

/** The sidebar's path filter (any copy in the entry may match) and sort, applied to the merged entries. */
export function filterAndSortPartialClips(
  entries: PartialClipEntry[],
  options: { pathFilter: string; sortBy: PartialClipSortField; sortOrder: SortOrder },
  videosById: Map<string, Video>,
): PartialClipEntry[] {
  const query = options.pathFilter.trim().toLowerCase();
  const matches = (entry: PartialClipEntry) => [entry.primary, ...entry.others]
    .some((clip) => [clip.aId, clip.bId].some((id) => videosById.get(id)?.path.toLowerCase().includes(query)));
  const size = (id: string) => videosById.get(id)?.sizeBytes ?? 0;
  const value = ({ primary }: PartialClipEntry) => {
    if (options.sortBy === 'coverage') return primary.coverage ?? 0;
    if (options.sortBy === 'totalSize') return size(primary.aId) + size(primary.bId);
    return primary.relation === 'partial' ? matchedSeconds(primary) : shorterSeconds(primary, primary.segments);
  };
  const direction = options.sortOrder === 'asc' ? 1 : -1;
  return entries.filter((entry) => !query || matches(entry)).sort((x, y) => (value(x) - value(y)) * direction);
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

/**
 * Seconds of the shorter video whose sound and picture both match. Sound-only stretches are left out:
 * many short ones (shared music) would otherwise rank a weak pair above a real copy.
 */
export const matchedSeconds = (clip: PartialClip) => shorterSeconds(clip, confirmedSegments(clip));

/**
 * One short line on what the pair shares: never "less complete", never "corrupt". The file names are
 * in the rows below it, and the time bar shows where.
 */
export type ClipKind = 'sameVideo' | 'excerpt' | 'contains' | 'sameSound';

export function clipKind(clip: PartialClip, shorter: Video, longer: Video): ClipKind {
  if (clip.relation !== 'partial') return 'sameSound';
  const shorterSecs = Number(shorter.durationSecs) || 0;
  if (shorterSecs <= 0 || matchedSeconds(clip) < EXCERPT_COVERAGE * shorterSecs) return 'contains';
  // Pairs of duplicate groups are not searched, so this is a copy the duplicate search did not group.
  return shorterSecs >= SAME_LENGTH_SHARE * (Number(longer.durationSecs) || Infinity) ? 'sameVideo' : 'excerpt';
}

/** The header's description, where a duplicate group says "Identical files". */
function describeMatch(clip: PartialClip, shorter: Video, longer: Video): string {
  const kind = clipKind(clip, shorter, longer);
  if (kind === 'sameVideo') return 'Same sound and picture over the full length';
  if (kind === 'excerpt') return 'Lies entirely inside the master';
  if (kind === 'contains') {
    const parts = confirmedSegments(clip).length;
    return `${parts} matching ${parts === 1 ? 'part' : 'parts'}`;
  }
  return clip.state === 'differentPicture' ? 'Sound matches, picture does not' : 'Sound matches, picture not checked';
}

/** The card's badge, in the duplicate groups' badge colours: strong, partial, or sound only. */
export function matchBadge(clip: PartialClip, shorter: Video, longer: Video): { label: string; tone: 'exact' | 'potential' | 'low-confidence' } {
  const kind = clipKind(clip, shorter, longer);
  if (kind === 'sameVideo') return { label: 'Same video', tone: 'exact' };
  if (kind === 'excerpt') return { label: 'Fully inside', tone: 'exact' };
  if (kind === 'contains') return { label: `Shares ${formatDuration(matchedSeconds(clip))}`, tone: 'potential' };
  return { label: clip.state === 'differentPicture' ? 'Same sound, other picture' : 'Same sound', tone: 'low-confidence' };
}

type OpenVideoMenu = (event: React.MouseEvent, videoId: string, scopeIds: string[]) => void;

/** A card of the list: one pair, or a family of videos that are copies or excerpts of each other. */
export type PartialClipCard =
  | { kind: 'pair'; entry: PartialClipEntry }
  | { kind: 'family'; entries: PartialClipEntry[]; videoIds: string[] };

/**
 * Copies and excerpts that share a video become one card, placed where its first pair is in the
 * sorted list. Weaker pairs ("contains 2:00 of") stay apart: joining through them would put
 * unrelated videos together because they share one scene.
 */
export function groupIntoFamilies(entries: PartialClipEntry[], videosById: Map<string, Video>): PartialClipCard[] {
  const strong = new Set(entries.filter(({ primary }) => {
    const shorter = videosById.get(primary.shorterId);
    const longer = videosById.get(primary.shorterId === primary.aId ? primary.bId : primary.aId);
    const kind = shorter && longer ? clipKind(primary, shorter, longer) : null;
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
}

/**
 * Every video of a card on one timeline: the longest is the master, and each other video is placed
 * through the pair that links it to a video already placed, so an excerpt of a copy lands where
 * that copy sits on the master. The offset between two videos comes from their longest matching
 * stretch.
 */
export function placeOnMaster(entries: PartialClipEntry[], videosById: Map<string, Video>): Lane[] {
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
  const lanes: Lane[] = [{ video: master, role: 'master', segments: [{ start: 0, end: Number(master.durationSecs) || 0, state: 'master' }], via: null }];
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
      const kind = otherIsShorter ? clipKind(clip, other, partner) : clipKind(clip, partner, other);
      const role: LaneRole = kind === 'sameVideo' ? 'copy' : kind === 'sameSound' ? 'sound' : kind === 'excerpt' && otherIsShorter ? 'excerpt' : 'part';
      lanes.push({
        video: other,
        role,
        segments: clip.segments.map((segment) => {
          const start = base + at(segment, known);
          return { start, end: start + segment.lengthSecs, state: segment.pictureState };
        }),
        via: { clip, dismiss: pair.dismiss, partner },
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
function LaneBar({ lane, masterSecs }: { lane: Lane; masterSecs: number }) {
  if (masterSecs <= 0) return <div className="partial-lane" />;
  // The master's row is the time scale the other rows are drawn on, not a match of its own.
  if (!lane.via) {
    return (
      <div className="partial-lane" role="img" aria-label={`Time scale of the longest video, 0:00 to ${formatDuration(masterSecs)}`}>
        <div className="partial-lane-axis" />
        <span className="partial-lane-label partial-lane-axis-labels">
          <span>0:00</span>
          <span>Timeline of the longest video</span>
          <span>{formatDuration(masterSecs)}</span>
        </span>
      </div>
    );
  }
  const where = (start: number, end: number) => `${formatPosition(start)} to ${formatPosition(end)}`;
  const spans = laneSpans(lane, masterSecs);
  const matching = spans.filter((span) => span.state === 'confirmed');
  const listed = matching.length > 0 ? matching : spans;
  const times = listed.slice(0, 2).map((span) => where(span.start, span.end)).join(', ')
    + (listed.length > 2 ? `, +${listed.length - 2} more` : '');
  const label = `${matching.length > 0 ? 'Matches the longest video' : 'Same sound as the longest video'} at ${times}; ${matchLabel(lane.via.clip)}`;
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
    </div>
  );
}

function ClipVideoRow({ lane, masterSecs, splittable, flags, scopeIds, onContextMenu, onKeepOnly }: {
  lane: Lane;
  masterSecs: number;
  /** More than two videos: each row can take its own pair out of the card. */
  splittable: boolean;
  /** Better / worse marks, only between copies of the same video. */
  flags: MetricFlags;
  scopeIds: string[];
  onContextMenu: OpenVideoMenu;
  /** Copies of the same video: keep this one and mark the other copies for deletion. */
  onKeepOnly?: () => void;
}) {
  const { video, via } = lane;
  // An unknown value (no resolution read yet) is left out rather than shown as an empty chip.
  const chip = (key: string, label: string) => label && <span className={`meta-chip ${flags[key] ?? 'equal'}`}>{label}</span>;
  const setVideoStatus = useStore((s) => s.setVideoStatus);
  const enterReviewAndPlay = useStore((s) => s.enterReviewAndPlay);
  const thumbnail = thumbSrc(video);
  const badge = statusBadgeContent(video);
  const toggle = (status: 'keep' | 'delete') => setVideoStatus(video.id, video.status === status ? 'pending' : status);
  return (
    <div
      className={`duplicate-row partial-clip-video ${video.status !== 'pending' ? `status-${video.status}` : ''}`}
      onContextMenu={(event) => onContextMenu(event, video.id, scopeIds)}
    >
      {thumbnail ? <img src={thumbnail} alt="" /> : <span className="partial-clip-thumb-placeholder" />}
      <div className="duplicate-row-copy">
        <div className="duplicate-row-title">
          <strong title={video.path}>{video.filename}</strong>
          <span className={`partial-clip-role ${lane.role}`}>
            {lane.role === 'part' && via ? `Shares ${formatDuration(matchedSeconds(via.clip))}` : ROLE_LABELS[lane.role]}
          </span>
          {badge && (
            <span className={`duplicate-inline-flag ${badge.className}`}>
              {badge.icon}
              {badge.label}
            </span>
          )}
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
      <LaneBar lane={lane} masterSecs={masterSecs} />
      <div className="partial-clip-actions">
        {onKeepOnly && (
          <button className="duplicate-group-action-btn" onClick={onKeepOnly} aria-label={`Keep ${video.filename}, delete the other copy`}>
            Keep this one
          </button>
        )}
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

const ClipCard = memo(function ClipCard({ entries, lanes, index, videosById, onVideoContextMenu }: {
  entries: PartialClipEntry[];
  /** From placeOnMaster: the list needs their count for the card's height before drawing it. */
  lanes: Lane[];
  /** Place in the list, for the title bar's entry stepper. */
  index: number;
  videosById: Map<string, Video>;
  onVideoContextMenu: OpenVideoMenu;
}) {
  const setVideoStatus = useStore((s) => s.setVideoStatus);
  const master = lanes[0];
  const first = entries[0]?.primary;
  if (!master || !first) return null;
  const masterSecs = Number(master.video.durationSecs) || 0;
  const scopeIds = lanes.map((lane) => lane.video.id);
  const shorter = videosById.get(first.shorterId);
  const longer = videosById.get(first.shorterId === first.aId ? first.bId : first.aId);
  const pair = entries.length === 1 && shorter && longer ? { shorter, longer } : null;
  const badge = pair ? matchBadge(first, pair.shorter, pair.longer) : { label: 'Same footage', tone: 'exact' };
  const count = (role: LaneRole, one: string, many: string) => {
    const n = lanes.filter((lane) => lane.role === role).length;
    return n === 0 ? null : `${n} ${n === 1 ? one : many}`;
  };
  const description = pair
    ? describeMatch(first, pair.shorter, pair.longer)
    : [count('copy', 'same video', 'same videos'), count('excerpt', 'fully inside', 'fully inside'), count('part', 'sharing a stretch', 'sharing stretches')].filter(Boolean).join(', ');
  const score = first.pictureSimilarity ?? first.soundSimilarity;
  const allPairs = entries.flatMap((entry) => [entry.primary, ...entry.others]);
  const totalBytes = lanes.reduce((sum, lane) => sum + (lane.video.sizeBytes ?? 0), 0);
  const copies = lanes.filter((lane) => lane.role === 'master' || lane.role === 'copy');
  const flags = cardFlags(lanes);
  const keepOnly = (keep: Video) => () => {
    for (const lane of copies) setVideoStatus(lane.video.id, lane.video.id === keep.id ? 'keep' : 'delete');
  };
  return (
    <article className={`partial-clip-card ${first.relation}`} data-entry-index={index}>
      <header className="duplicate-group-header partial-clip-header">
        <div className="duplicate-group-title">
          {/* The badge and the timelines say what the videos share; the sentence is in the tooltip. */}
          <span className={`duplicate-match-badge ${badge.tone}`} title={description}>{badge.label}</span>
          <strong title={matchLabel(first)}>{score.toFixed(1)}%</strong>
          <em className="duplicate-group-fact">{lanes.length} videos</em>
          <em className="duplicate-group-fact">{formatSize(totalBytes)}</em>
        </div>
        <div className="duplicate-group-actions">
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
          splittable={lanes.length > 2}
          flags={flags.get(lane.video.id) ?? {}}
          scopeIds={scopeIds}
          onContextMenu={onVideoContextMenu}
          onKeepOnly={copies.length > 1 && copies.includes(lane) ? keepOnly(lane.video) : undefined}
        />
      ))}
    </article>
  );
});

/** A row of the list: a card, or the switch that shows the pairs with a different picture. */
type ListItem =
  | { kind: 'card'; entries: PartialClipEntry[]; lanes: Lane[]; index: number }
  | { kind: 'toggle'; count: number; /** The card index of the first card it shows. */ index: number };

interface RowData {
  items: ListItem[];
  videosById: Map<string, Video>;
  onVideoContextMenu: OpenVideoMenu;
  showDifferent: boolean;
  onToggleDifferent: () => void;
}

const TOGGLE_ROW_HEIGHT = 36;
const CARD_BORDERS = 2;

// Sync: the header and row heights in PartialClipsView.css are these values.
function itemHeight(index: number, { items }: RowData): number {
  const item = items[index]!;
  const gap = index > 0 ? DUPLICATE_GROUP_GAP : 0;
  if (item.kind === 'toggle') return gap + TOGGLE_ROW_HEIGHT;
  return gap + CARD_BORDERS + DUPLICATE_GROUP_HEADER_HEIGHT + item.lanes.length * DUPLICATE_VIDEO_ROW_HEIGHT;
}

function PartialClipRow({ index, style, ariaAttributes, items, videosById, onVideoContextMenu, showDifferent, onToggleDifferent }: RowComponentProps<RowData>) {
  const item = items[index]!;
  const shell = { ...style, boxSizing: 'border-box' as const, paddingTop: index > 0 ? DUPLICATE_GROUP_GAP : 0, paddingLeft: 20, paddingRight: 20 };
  return (
    <div style={shell} {...ariaAttributes}>
      {item.kind === 'toggle' ? (
        <button type="button" className="partial-clips-toggle" aria-expanded={showDifferent} onClick={onToggleDifferent}>
          {showDifferent ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
          {item.count.toLocaleString()} {item.count === 1 ? 'pair' : 'pairs'} with the same sound and a different picture
        </button>
      ) : (
        <ClipCard entries={item.entries} lanes={item.lanes} index={item.index} videosById={videosById} onVideoContextMenu={onVideoContextMenu} />
      )}
    </div>
  );
}

/**
 * The result of Find partial clips: pairs where one video contains a stretch of the other, and pairs
 * that only share sound. No keeper and no delete suggestion: an excerpt is not interchangeable with its
 * source.
 */
function PartialClipsView() {
  const clips = useStore((s) => s.partialClips);
  const groups = useStore((s) => s.duplicateGroups);
  const videos = useStore((s) => s.videos);
  const pathFilter = useStore((s) => s.duplicatePathFilter);
  const sortBy = useStore((s) => s.partialClipSortBy);
  const sortOrder = useStore((s) => s.partialClipSortOrder);
  const [menu, setMenu] = useState<{ x: number; y: number; videoId: string; scopeIds: string[] } | null>(null);
  const [showDifferent, setShowDifferent] = useState(false);
  const listRef = useRef<ListImperativeAPI | null>(null);
  const videosById = useMemo(() => new Map(videos.map((video) => [video.id, video])), [videos]);
  const { allCount, shown, shownCards, differentPicture } = useMemo(() => {
    const entries = mergeClipsByDuplicateGroup(clips ?? [], groups);
    const visible = filterAndSortPartialClips(entries, { pathFilter, sortBy, sortOrder }, videosById);
    const withPicture = visible.filter((entry) => entry.primary.state !== 'differentPicture');
    return {
      allCount: entries.length,
      shown: withPicture,
      shownCards: groupIntoFamilies(withPicture, videosById),
      differentPicture: visible.filter((entry) => entry.primary.state === 'differentPicture'),
    };
  }, [clips, groups, pathFilter, sortBy, sortOrder, videosById]);
  // Cards, as the title bar's stepper counts them; the line under the title counts pairs.
  const visibleCount = shownCards.length + differentPicture.length;
  const partialCount = shown.filter((entry) => entry.primary.relation === 'partial').length;
  const soundOnlyCount = shown.length + differentPicture.length - partialCount;
  const openVideoMenu = useCallback<OpenVideoMenu>((event, videoId, scopeIds) => {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, videoId, scopeIds });
  }, []);

  // Every card's lanes up front: the list needs each card's height before it draws the card.
  const items = useMemo<ListItem[]>(() => {
    const cardItem = (entries: PartialClipEntry[], index: number): ListItem => ({ kind: 'card', entries, index, lanes: placeOnMaster(entries, videosById) });
    const list = shownCards.map((item, index) => cardItem(item.kind === 'pair' ? [item.entry] : item.entries, index));
    if (differentPicture.length === 0) return list;
    return [
      ...list,
      { kind: 'toggle', count: differentPicture.length, index: shownCards.length },
      ...(showDifferent ? differentPicture.map((entry, index) => cardItem([entry], shownCards.length + index)) : []),
    ];
  }, [differentPicture, shownCards, showDifferent, videosById]);

  const toggleDifferent = useCallback(() => setShowDifferent((open) => !open), []);
  const rowProps = useMemo<RowData>(() => ({ items, videosById, onVideoContextMenu: openVideoMenu, showDifferent, onToggleDifferent: toggleDifferent }), [items, openVideoMenu, showDifferent, toggleDifferent, videosById]);

  // The title bar's stepper: the first card in view.
  const handleRowsRendered = useCallback(({ startIndex }: { startIndex: number; stopIndex: number }) => {
    useStore.getState().setDuplicatePosition({ group: items[startIndex]?.index ?? 0, total: visibleCount });
  }, [items, visibleCount]);
  useEffect(() => {
    useStore.getState().setDuplicatePosition({ group: 0, total: visibleCount });
  }, [visibleCount]);
  useEffect(() => () => useStore.getState().setDuplicatePosition(null), []);

  const jump = useStore((s) => s.duplicateGroupJump);
  const handledJumpRef = useRef(jump?.id ?? 0);
  useEffect(() => {
    if (!jump || handledJumpRef.current === jump.id) return;
    // A card in the closed section: open it, and this runs again once its cards are in the list.
    if (jump.index >= shownCards.length && !showDifferent) {
      setShowDifferent(true);
      return;
    }
    handledJumpRef.current = jump.id;
    const row = items.findIndex((item) => item.kind === 'card' && item.index === jump.index);
    if (row >= 0) listRef.current?.scrollToRow({ index: row, align: 'start' });
  }, [items, jump, shownCards.length, showDifferent]);

  const menuVideo = menu ? videosById.get(menu.videoId) : undefined;
  const menuItems = menu && menuVideo ? buildDuplicateVideoMenu({
    onPlay: () => useStore.getState().enterReviewAndPlay(menuVideo.id, menu.scopeIds),
    onOpenExternal: () => openVideoExternally(menuVideo.path),
    onReveal: () => revealInExplorer(menuVideo.path),
    onMarkDelete: () => useStore.getState().setVideoStatus(menuVideo.id, 'delete'),
    onMarkKeep: () => useStore.getState().setVideoStatus(menuVideo.id, 'keep'),
    onResetPending: () => useStore.getState().setVideoStatus(menuVideo.id, 'pending'),
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
            {partialCount.toLocaleString()} with matching picture
            {soundOnlyCount > 0 ? `, ${soundOnlyCount.toLocaleString()} with only the same sound` : ''}
            {/* Pairs, not cards: allCount counts pairs, so the two compare. */}
            {shown.length + differentPicture.length < allCount ? `. ${(shown.length + differentPicture.length).toLocaleString()} of ${allCount.toLocaleString()} match the filter` : ''}
          </span>
        </div>
      </div>
      {visibleCount === 0 ? (
        <p className="partial-clips-empty">
          {allCount === 0 ? 'No video contains part of another.' : 'No entries match the path filter.'}
        </p>
      ) : (
        <List
          className="partial-clips-list"
          listRef={listRef}
          rowCount={items.length}
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
