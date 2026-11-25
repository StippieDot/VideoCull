import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Play, Trash2 } from 'lucide-react';
import useStore from '../store';
import type { DuplicateGroup, PartialClip, PartialClipSegment, PartialClipSortField, SortOrder, Video } from '../types';
import { formatDuration, formatSize } from '../utils';
import { openVideoExternally, revealInExplorer } from '../appCommands';
import ContextMenu, { copyTextToClipboard } from './ContextMenu';
import { buildCopyPathSuccessDetail, buildDuplicateVideoMenu } from './contextMenuBuilders';
import { parentPath, statusBadgeContent } from './DuplicateGroupsView';
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

const sharedSeconds = (clip: PartialClip) => clip.segments.reduce((sum, segment) => sum + segment.lengthSecs, 0);

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
    return sharedSeconds(primary);
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
  return `from ${formatPosition(start)} to ${formatPosition(end)}`;
};

/**
 * What the pair shares, in the words of the result: never "less complete", never "corrupt". The
 * headline sums it up; with more than one stretch each is listed, by its place in the longer video.
 */
export function describePartialClip(clip: PartialClip, shorter: Video, longer: Video): { headline: string; stretches: string[] } {
  const stretches = clip.segments.length < 2 ? [] : [...clip.segments]
    .sort((x, y) => inLonger(clip, x).start - inLonger(clip, y).start)
    .map((segment) => `${formatDuration(segment.lengthSecs)} ${span(clip, segment)} — ${segment.pictureState === 'confirmed' ? 'sound and picture match' : 'same sound only'}`);
  if (clip.relation === 'partial') {
    const confirmed = clip.segments.filter((segment) => segment.pictureState === 'confirmed');
    const confirmedSecs = shorterSeconds(clip, confirmed);
    const shorterSecs = Number(shorter.durationSecs) || 0;
    if (shorterSecs > 0 && confirmedSecs >= EXCERPT_COVERAGE * shorterSecs) {
      // Pairs of duplicate groups are not searched, so this is a copy the duplicate search did not group.
      const headline = shorterSecs >= SAME_LENGTH_SHARE * (Number(longer.durationSecs) || Infinity)
        ? `${shorter.filename} and ${longer.filename} are the same video — sound and picture match`
        : `${shorter.filename} is an excerpt of ${longer.filename} — sound and picture match`;
      return { headline, stretches };
    }
    const where = confirmed.length === 1 ? `, ${span(clip, confirmed[0]!)}` : ` in ${confirmed.length} stretches`;
    return { headline: `Contains ${formatDuration(confirmedSecs)} of ${longer.filename}${where} — sound and picture match`, stretches };
  }
  const ending = clip.state === 'differentPicture' ? 'pictures differ' : 'picture could not be checked';
  const where = clip.segments.length === 1
    ? span(clip, clip.segments[0]!)
    : `for ${formatDuration(shorterSeconds(clip, clip.segments))} in ${clip.segments.length} stretches`;
  return { headline: `Same sound as ${longer.filename} ${where}; ${ending}`, stretches };
}

function evidenceLabel(clip: PartialClip): string {
  return clip.pictureSimilarity === null
    ? `Sound ${Math.round(clip.soundSimilarity)}%`
    : `Sound ${Math.round(clip.soundSimilarity)}% · picture ${Math.round(clip.pictureSimilarity)}%`;
}

function TimeBar({ clip, longer }: { clip: PartialClip; longer: Video }) {
  const duration = Number(longer.durationSecs) || 0;
  if (duration <= 0) return null;
  // The sentence above says the same, so screen readers skip the bar.
  return (
    <div className="partial-clip-timeline" aria-hidden="true">
      <span>0:00</span>
      <div className="partial-clip-timebar">
        {clip.segments.map((segment, index) => {
          const { start, end } = inLonger(clip, segment);
          return (
            <span
              key={index}
              className={`partial-clip-segment ${segment.pictureState}`}
              title={`${formatPosition(start)} – ${formatPosition(end)}`}
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

function ClipVideoRow({ video, role, scopeIds, onContextMenu }: { video: Video; role: string; scopeIds: string[]; onContextMenu: OpenVideoMenu }) {
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
          <span className="partial-clip-role">{role}</span>
          {badge && (
            <span className={`duplicate-inline-flag ${badge.className}`}>
              {badge.icon}
              {badge.label}
            </span>
          )}
        </div>
        <span className="duplicate-row-path" title={video.path}>{parentPath(video.path)}</span>
        <span className="duplicate-meta-chips">
          <span className="meta-chip equal">{formatDuration(video.durationSecs)}</span>
          <span className="meta-chip equal">{formatSize(video.sizeBytes)}</span>
        </span>
      </div>
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
  const dismissPartialClips = useStore((s) => s.dismissPartialClips);
  const { primary: clip, others } = entry;
  const shorter = videosById.get(clip.shorterId);
  const longer = videosById.get(clip.shorterId === clip.aId ? clip.bId : clip.aId);
  if (!shorter || !longer) return null;
  const scopeIds = [shorter.id, longer.id];
  const { headline, stretches } = describePartialClip(clip, shorter, longer);
  const notAMatch = () => {
    // Applies to the copies listed below too, so they do not come back through another copy.
    const pairs = [clip, ...others];
    const before = useStore.getState().partialClips ?? [];
    dismissPartialClips(pairs);
    useStore.getState().pushToast({
      title: 'Marked as not a match',
      detail: `${shorter.filename} and ${longer.filename} stay out of later searches.`,
      kind: 'info',
      durationMs: 8000,
      actionLabel: 'Undo',
      action: () => {
        useStore.getState().removeIgnoredDuplicatePairs(pairs.map((pair) => (pair.aId < pair.bId ? `${pair.aId}|${pair.bId}` : `${pair.bId}|${pair.aId}`)));
        // The entries return at their old place; anything dismissed since stays out.
        useStore.setState((state) => ({ partialClips: before.filter((entry) => pairs.includes(entry) || state.partialClips?.includes(entry)) }));
      },
    });
  };
  return (
    <article className={`partial-clip-card ${clip.relation}`} data-entry-index={index}>
      <header className="partial-clip-header">
        <div className="partial-clip-summary">
          <p>{headline}</p>
          <span className="partial-clip-evidence">{evidenceLabel(clip)}</span>
          {stretches.length > 0 && (
            <details className="partial-clip-stretches">
              <summary>{stretches.length} stretches in {longer.filename}</summary>
              <ul>
                {/* Two stretches of the shorter video can sit at the same place in the longer one. */}
                {stretches.map((line, i) => <li key={i}>{line}</li>)}
              </ul>
            </details>
          )}
        </div>
        <button className="duplicate-action-btn secondary" onClick={notAMatch} title="Hide this entry and keep it out of later searches">
          Not a match
        </button>
      </header>
      <TimeBar clip={clip} longer={longer} />
      <ClipVideoRow video={shorter} role="Shorter" scopeIds={scopeIds} onContextMenu={onVideoContextMenu} />
      <ClipVideoRow video={longer} role="Longer" scopeIds={scopeIds} onContextMenu={onVideoContextMenu} />
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
                  <span>{describePartialClip(other, otherShorter, otherLonger).headline}</span>
                  <span className="partial-clip-evidence">{evidenceLabel(other)}</span>
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
  const { allCount, shown, differentPicture } = useMemo(() => {
    const entries = mergeClipsByDuplicateGroup(clips ?? [], groups);
    const visible = filterAndSortPartialClips(entries, { pathFilter, sortBy, sortOrder }, videosById);
    return {
      allCount: entries.length,
      shown: visible.filter((entry) => entry.primary.state !== 'differentPicture'),
      differentPicture: visible.filter((entry) => entry.primary.state === 'differentPicture'),
    };
  }, [clips, groups, pathFilter, sortBy, sortOrder, videosById]);
  const visibleCount = shown.length + differentPicture.length;
  const partialCount = shown.filter((entry) => entry.primary.relation === 'partial').length;
  const soundOnlyCount = visibleCount - partialCount;
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
  useEffect(updatePosition, [updatePosition, shown, differentPicture]);
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
            {partialCount} {partialCount === 1 ? 'video contains' : 'videos contain'} part of another
            {soundOnlyCount > 0 ? ` · ${soundOnlyCount} other ${soundOnlyCount === 1 ? 'pair shares' : 'pairs share'} sound` : ''}
            {visibleCount < allCount ? ` · ${visibleCount} of ${allCount} entries match the filter` : ''}
          </span>
        </div>
      </div>
      <div className="partial-clips-list" ref={listRef} onScroll={updatePosition}>
        {visibleCount === 0 && (
          <p className="partial-clips-empty">
            {allCount === 0 ? 'No video contains part of another.' : 'No entries match the path filter.'}
          </p>
        )}
        {shown.map((entry, index) => card(entry, index))}
        {differentPicture.length > 0 && (
          <details className="partial-clips-collapsed">
            <summary>
              {differentPicture.length} {differentPicture.length === 1 ? 'pair shares' : 'pairs share'} the same sound with different pictures
            </summary>
            {differentPicture.map((entry, index) => card(entry, shown.length + index))}
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
