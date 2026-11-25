import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Play, Trash2 } from 'lucide-react';
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

/** Segment positions in the longer video, where the time bar and the wording place them. */
function inLonger(clip: PartialClip, segment: PartialClipSegment): { start: number; end: number } {
  const longerIsA = clip.shorterId !== clip.aId;
  const start = longerIsA ? segment.startA : segment.startB;
  return { start, end: start + segment.lengthSecs };
}

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

const span = (clip: PartialClip, segment: PartialClipSegment) => {
  const { start, end } = inLonger(clip, segment);
  return `${formatPosition(start)} to ${formatPosition(end)}`;
};

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

export function describePartialClip(clip: PartialClip, shorter: Video, longer: Video): string {
  const kind = clipKind(clip, shorter, longer);
  if (kind === 'sameSound') return clip.state === 'differentPicture' ? 'Same sound, different picture' : 'Same sound, picture not checked';
  if (kind === 'sameVideo') return 'Same video';
  if (kind === 'excerpt') return 'Excerpt of the longer video';
  const confirmed = confirmedSegments(clip);
  const matched = shorterSeconds(clip, confirmed);
  return confirmed.length === 1
    ? `Contains ${formatDuration(matched)} of the longer video, ${span(clip, confirmed[0]!)}`
    : `Contains ${formatDuration(matched)} of the longer video in ${confirmed.length} parts`;
}

function evidenceLabel(clip: PartialClip): string {
  return clip.pictureSimilarity === null
    ? `Sound ${Math.round(clip.soundSimilarity)}% similar`
    : `Sound ${Math.round(clip.soundSimilarity)}%, picture ${Math.round(clip.pictureSimilarity)}% similar`;
}

function TimeBar({ clip, longer }: { clip: PartialClip; longer: Video }) {
  const duration = Number(longer.durationSecs) || 0;
  if (duration <= 0) return null;
  const matches = confirmedSegments(clip).map((segment) => span(clip, segment));
  return (
    <div
      className="partial-clip-timeline"
      role="img"
      aria-label={matches.length > 0 ? `Matching parts of the longer video: ${matches.join(', ')}` : 'Shared sound in the longer video'}
    >
      <span>0:00</span>
      <div className="partial-clip-timebar">
        {clip.segments.map((segment, index) => {
          const { start, end } = inLonger(clip, segment);
          return (
            <span
              key={index}
              className={`partial-clip-segment ${segment.pictureState}`}
              title={span(clip, segment)}
              style={{ left: `${(start / duration) * 100}%`, width: `${Math.max(0.5, ((end - start) / duration) * 100)}%` }}
            />
          );
        })}
      </div>
      <span>{formatDuration(duration)}</span>
    </div>
  );
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

/** Hides an entry, with the copies listed under it, and keeps it out of later searches; undoable. */
function dismissEntry(entry: PartialClipEntry, shorter: Video, longer: Video) {
  const { dismissPartialClips, pushToast } = useStore.getState();
  // The copies too, so the finding does not come back through another copy.
  const pairs = [entry.primary, ...entry.others];
  const before = useStore.getState().partialClips ?? [];
  dismissPartialClips(pairs);
  pushToast({
    title: 'Marked as not a match',
    detail: `${shorter.filename} and ${longer.filename} stay out of later searches.`,
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

const FamilyCard = memo(function FamilyCard({ entries, videoIds, index, videosById, onVideoContextMenu }: {
  entries: PartialClipEntry[];
  videoIds: string[];
  index: number;
  videosById: Map<string, Video>;
  onVideoContextMenu: OpenVideoMenu;
}) {
  const members = videoIds
    .map((id) => videosById.get(id))
    .filter((video): video is Video => Boolean(video))
    .sort((x, y) => (Number(y.durationSecs) || 0) - (Number(x.durationSecs) || 0));
  return (
    <article className="partial-clip-card partial" data-entry-index={index}>
      <header className="partial-clip-header">
        <p className="partial-clip-summary">{members.length} videos with the same footage</p>
      </header>
      <ul className="partial-clip-relations">
        {entries.map((entry) => {
          const { primary } = entry;
          const shorter = videosById.get(primary.shorterId);
          const longer = videosById.get(primary.shorterId === primary.aId ? primary.bId : primary.aId);
          if (!shorter || !longer) return null;
          const line = clipKind(primary, shorter, longer) === 'sameVideo'
            ? `${shorter.filename} and ${longer.filename} are the same video`
            : `${shorter.filename} is an excerpt of ${longer.filename}`;
          return (
            <li key={`${primary.aId}|${primary.bId}`}>
              <span title={evidenceLabel(primary)}>{line}</span>
              <button className="duplicate-action-btn secondary" onClick={() => dismissEntry(entry, shorter, longer)} title="Hide this pair and keep it out of later searches">
                Not a match
              </button>
            </li>
          );
        })}
      </ul>
      {members.map((video) => (
        <ClipVideoRow key={video.id} video={video} flags={{}} scopeIds={videoIds} onContextMenu={onVideoContextMenu} />
      ))}
    </article>
  );
});

function ClipVideoRow({ video, flags, scopeIds, onContextMenu, onKeepOnly }: {
  video: Video;
  /** Better / worse marks, only between two copies of the same video. */
  flags: MetricFlags;
  scopeIds: string[];
  onContextMenu: OpenVideoMenu;
  /** Two copies of the same video: keep this one and mark the other for deletion. */
  onKeepOnly?: () => void;
}) {
  // An unknown value (no resolution read yet) is left out rather than shown as an empty chip.
  const chip = (key: string, label: string) => label && <span className={`meta-chip ${flags[key] ?? 'equal'}`}>{label}</span>;
  const setVideoStatus = useStore((s) => s.setVideoStatus);
  const enterReviewAndPlay = useStore((s) => s.enterReviewAndPlay);
  const thumbnail = thumbSrc(video);
  const badge = statusBadgeContent(video);
  const toggle = (status: 'keep' | 'delete') => setVideoStatus(video.id, video.status === status ? 'pending' : status);
  return (
    <div
      className={`partial-clip-video ${video.status !== 'pending' ? `status-${video.status}` : ''}`}
      onContextMenu={(event) => onContextMenu(event, video.id, scopeIds)}
    >
      {thumbnail ? <img src={thumbnail} alt="" /> : <span className="partial-clip-thumb-placeholder" />}
      <div className="duplicate-row-copy">
        <div className="duplicate-row-title">
          <strong title={video.path}>{video.filename}</strong>
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
      <div className="partial-clip-actions">
        {onKeepOnly && (
          <button className="duplicate-action-btn secondary" onClick={onKeepOnly} aria-label={`Keep ${video.filename}, delete the other copy`}>
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
      </div>
    </div>
  );
}

const ClipCard = memo(function ClipCard({ entry, index, videosById, onVideoContextMenu }: {
  entry: PartialClipEntry;
  /** Place in the list, for the title bar's entry stepper. */
  index: number;
  videosById: Map<string, Video>;
  onVideoContextMenu: OpenVideoMenu;
}) {
  const setVideoStatus = useStore((s) => s.setVideoStatus);
  const { primary: clip, others } = entry;
  const shorter = videosById.get(clip.shorterId);
  const longer = videosById.get(clip.shorterId === clip.aId ? clip.bId : clip.aId);
  if (!shorter || !longer) return null;
  const scopeIds = [shorter.id, longer.id];
  const headline = describePartialClip(clip, shorter, longer);
  const sameVideo = clipKind(clip, shorter, longer) === 'sameVideo';
  const flags = sameVideo ? computeBestFlags([shorter, longer]) : new Map<string, MetricFlags>();
  const keepOnly = (keep: Video, other: Video) => () => {
    setVideoStatus(keep.id, 'keep');
    setVideoStatus(other.id, 'delete');
  };
  const notAMatch = () => dismissEntry(entry, shorter, longer);
  return (
    <article className={`partial-clip-card ${clip.relation}`} data-entry-index={index}>
      <header className="partial-clip-header">
        <p className="partial-clip-summary" title={evidenceLabel(clip)}>{headline}</p>
        <button className="duplicate-action-btn secondary" onClick={notAMatch} title="Hide this entry and keep it out of later searches">
          Not a match
        </button>
      </header>
      <TimeBar clip={clip} longer={longer} />
      <ClipVideoRow video={shorter} flags={flags.get(shorter.id) ?? {}} scopeIds={scopeIds} onContextMenu={onVideoContextMenu} onKeepOnly={sameVideo ? keepOnly(shorter, longer) : undefined} />
      <ClipVideoRow video={longer} flags={flags.get(longer.id) ?? {}} scopeIds={scopeIds} onContextMenu={onVideoContextMenu} onKeepOnly={sameVideo ? keepOnly(longer, shorter) : undefined} />
      {sameVideo && shorter.status === 'keep' && longer.status === 'keep' && (
        <p className="partial-clip-warning">Both copies are marked keep.</p>
      )}
      {others.length > 0 && (
        <details className="partial-clip-copies">
          <summary>Also found in {others.length} other {others.length === 1 ? 'copy' : 'copies'} of these videos</summary>
          <ul>
            {others.map((other) => {
              const otherShorter = videosById.get(other.shorterId);
              const otherLonger = videosById.get(other.shorterId === other.aId ? other.bId : other.aId);
              if (!otherShorter || !otherLonger) return null;
              return (
                <li key={`${other.aId}|${other.bId}`}>
                  <span>{describePartialClip(other, otherShorter, otherLonger)}: {otherShorter.filename} and {otherLonger.filename}</span>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </article>
  );
});

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
  const listRef = useRef<HTMLDivElement>(null);
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
  const entryKey = (entry: PartialClipEntry) => `${entry.primary.aId}|${entry.primary.bId}`;

  const openVideoMenu = useCallback<OpenVideoMenu>((event, videoId, scopeIds) => {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, videoId, scopeIds });
  }, []);

  // The title bar's stepper: the first entry whose card reaches below the top of the list.
  const updatePosition = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const top = list.getBoundingClientRect().top;
    const first = [...list.querySelectorAll<HTMLElement>('[data-entry-index]')]
      // Cards in the closed "different pictures" section have no boxes and are skipped.
      .find((card) => card.getClientRects().length > 0 && card.getBoundingClientRect().bottom > top + 1);
    useStore.getState().setDuplicatePosition({ group: Number(first?.dataset.entryIndex ?? 0), total: visibleCount });
  }, [visibleCount]);
  useEffect(updatePosition, [updatePosition, shownCards, differentPicture]);
  useEffect(() => () => useStore.getState().setDuplicatePosition(null), []);

  const jump = useStore((s) => s.duplicateGroupJump);
  const handledJumpRef = useRef(jump?.id ?? 0);
  useEffect(() => {
    if (!jump || handledJumpRef.current === jump.id) return;
    handledJumpRef.current = jump.id;
    const card = listRef.current?.querySelector<HTMLElement>(`[data-entry-index="${jump.index}"]`);
    const section = card?.closest('details');
    if (section) section.open = true;
    card?.scrollIntoView?.({ block: 'start' });
  }, [jump]);

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

  const card = (entry: PartialClipEntry, index: number) => (
    <ClipCard key={entryKey(entry)} entry={entry} index={index} videosById={videosById} onVideoContextMenu={openVideoMenu} />
  );

  // shortcut: every entry is rendered, upgrade to a virtual list when libraries report thousands.
  return (
    <div className="duplicate-groups-view partial-clips-view">
      <div className="duplicate-toolbar">
        <div>
          <h2>Partial clips</h2>
          <span>
            {partialCount.toLocaleString()} with matching picture
            {soundOnlyCount > 0 ? `, ${soundOnlyCount.toLocaleString()} with only the same sound` : ''}
            {visibleCount < allCount ? `. ${visibleCount.toLocaleString()} of ${allCount.toLocaleString()} match the filter` : ''}
          </span>
        </div>
      </div>
      <div className="partial-clips-list" ref={listRef} onScroll={updatePosition}>
        {visibleCount === 0 && (
          <p className="partial-clips-empty">
            {allCount === 0 ? 'No video contains part of another.' : 'No entries match the path filter.'}
          </p>
        )}
        {shownCards.map((item, index) => (item.kind === 'pair' ? card(item.entry, index) : (
          <FamilyCard
            key={entryKey(item.entries[0]!)}
            entries={item.entries}
            videoIds={item.videoIds}
            index={index}
            videosById={videosById}
            onVideoContextMenu={openVideoMenu}
          />
        )))}
        {differentPicture.length > 0 && (
          <details className="partial-clips-collapsed">
            <summary>
              {differentPicture.length.toLocaleString()} {differentPicture.length === 1 ? 'pair' : 'pairs'} with the same sound and a different picture
            </summary>
            {differentPicture.map((entry, index) => card(entry, shownCards.length + index))}
          </details>
        )}
      </div>
      {menu && menuVideo && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}

export default memo(PartialClipsView);
