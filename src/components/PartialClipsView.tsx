import { memo, useMemo } from 'react';
import { Check, Play, Trash2 } from 'lucide-react';
import useStore from '../store';
import type { DuplicateGroup, PartialClip, PartialClipSegment, Video } from '../types';
import { formatDuration, formatSize } from '../utils';
import './DuplicateGroupsView.css';
import './PartialClipsView.css';

// An excerpt covering this much of the shorter video is described as an excerpt of the longer one.
const EXCERPT_COVERAGE = 0.9;
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

/** Segment positions in the longer video, where the time bar and the wording place them. */
function inLonger(clip: PartialClip, segment: PartialClipSegment): { start: number; end: number } {
  const longerIsA = clip.shorterId !== clip.aId;
  const start = longerIsA ? segment.startA : segment.startB;
  return { start, end: start + segment.lengthSecs };
}

/** What the pair shares, in the words of the result: never "less complete", never "corrupt". */
export function describePartialClip(clip: PartialClip, shorter: Video, longer: Video): string[] {
  if (clip.relation === 'partial') {
    if ((clip.coverage ?? 0) >= EXCERPT_COVERAGE && clip.segments.length === 1) {
      return [`${shorter.filename} is an excerpt of ${longer.filename} — sound and picture match`];
    }
    return clip.segments.map((segment) => {
      const { start, end } = inLonger(clip, segment);
      return `Contains ${formatDuration(segment.lengthSecs)} of ${longer.filename}, from ${formatDuration(start)} to ${formatDuration(end)}`
        + (segment.pictureState === 'confirmed' ? ' — sound and picture match' : ' — same sound only');
    });
  }
  const ending = clip.state === 'differentPicture' ? 'pictures differ' : 'picture could not be checked';
  return clip.segments.map((segment) => {
    const { start, end } = inLonger(clip, segment);
    return `Same sound as ${longer.filename} from ${formatDuration(start)} to ${formatDuration(end)}; ${ending}`;
  });
}

function evidenceLabel(clip: PartialClip): string {
  return clip.pictureSimilarity === null
    ? `Sound ${Math.round(clip.soundSimilarity)} %`
    : `Sound ${Math.round(clip.soundSimilarity)} % · picture ${Math.round(clip.pictureSimilarity)} %`;
}

function TimeBar({ clip, longer }: { clip: PartialClip; longer: Video }) {
  const duration = Number(longer.durationSecs) || 0;
  if (duration <= 0) return null;
  return (
    <div className="partial-clip-timebar" aria-hidden="true">
      {clip.segments.map((segment, index) => {
        const { start, end } = inLonger(clip, segment);
        return (
          <span
            key={index}
            className={`partial-clip-segment ${segment.pictureState}`}
            style={{ left: `${(start / duration) * 100}%`, width: `${Math.max(0.5, ((end - start) / duration) * 100)}%` }}
          />
        );
      })}
    </div>
  );
}

function ClipVideoRow({ video, role, scopeIds }: { video: Video; role: string; scopeIds: string[] }) {
  const setVideoStatus = useStore((s) => s.setVideoStatus);
  const enterReviewAndPlay = useStore((s) => s.enterReviewAndPlay);
  const thumbnail = thumbSrc(video);
  const toggle = (status: 'keep' | 'delete') => setVideoStatus(video.id, video.status === status ? 'pending' : status);
  return (
    <div className={`partial-clip-video ${video.status !== 'pending' ? `status-${video.status}` : ''}`}>
      {thumbnail ? <img src={thumbnail} alt="" /> : <span className="partial-clip-thumb-placeholder" />}
      <div className="duplicate-row-copy">
        <div className="duplicate-row-title">
          <strong title={video.path}>{video.filename}</strong>
          <span className="partial-clip-role">{role}</span>
        </div>
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

const ClipCard = memo(function ClipCard({ entry, videosById }: { entry: PartialClipEntry; videosById: Map<string, Video> }) {
  const dismissPartialClips = useStore((s) => s.dismissPartialClips);
  const { primary: clip, others } = entry;
  const shorter = videosById.get(clip.shorterId);
  const longer = videosById.get(clip.shorterId === clip.aId ? clip.bId : clip.aId);
  if (!shorter || !longer) return null;
  const scopeIds = [shorter.id, longer.id];
  return (
    <article className={`partial-clip-card ${clip.relation}`}>
      <header className="partial-clip-header">
        <div className="partial-clip-summary">
          {describePartialClip(clip, shorter, longer).map((line) => <p key={line}>{line}</p>)}
          <span className="partial-clip-evidence">{evidenceLabel(clip)}</span>
        </div>
        {/* Applies to the copies listed below too, so they do not come back through another copy. */}
        <button className="duplicate-action-btn secondary" onClick={() => dismissPartialClips([clip, ...others])}>
          Not a match
        </button>
      </header>
      <TimeBar clip={clip} longer={longer} />
      <ClipVideoRow video={shorter} role="Shorter" scopeIds={scopeIds} />
      <ClipVideoRow video={longer} role="Longer" scopeIds={scopeIds} />
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
                  <span>{describePartialClip(other, otherShorter, otherLonger).join('; ')}</span>
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
  const videosById = useMemo(() => new Map(videos.map((video) => [video.id, video])), [videos]);
  const { shown, differentPicture } = useMemo(() => {
    const entries = mergeClipsByDuplicateGroup(clips ?? [], groups);
    return {
      shown: entries.filter((entry) => entry.primary.state !== 'differentPicture'),
      differentPicture: entries.filter((entry) => entry.primary.state === 'differentPicture'),
    };
  }, [clips, groups]);
  const partialCount = shown.filter((entry) => entry.primary.relation === 'partial').length;
  const soundOnlyCount = shown.length - partialCount + differentPicture.length;
  const entryKey = (entry: PartialClipEntry) => `${entry.primary.aId}|${entry.primary.bId}`;

  // shortcut: every entry is rendered, upgrade to a virtual list when libraries report thousands.
  return (
    <div className="duplicate-groups-view partial-clips-view">
      <div className="duplicate-toolbar">
        <div>
          <h2>Partial clips</h2>
          <span>
            {partialCount} {partialCount === 1 ? 'video contains' : 'videos contain'} part of another
            {soundOnlyCount > 0 ? ` · ${soundOnlyCount} ${soundOnlyCount === 1 ? 'pair shares' : 'pairs share'} only sound` : ''}
          </span>
        </div>
      </div>
      <div className="partial-clips-list">
        {shown.length === 0 && differentPicture.length === 0 && (
          <p className="partial-clips-empty">No video contains part of another.</p>
        )}
        {shown.map((entry) => <ClipCard key={entryKey(entry)} entry={entry} videosById={videosById} />)}
        {differentPicture.length > 0 && (
          <details className="partial-clips-collapsed">
            <summary>
              {differentPicture.length} {differentPicture.length === 1 ? 'pair shares' : 'pairs share'} the same sound with different pictures
            </summary>
            {differentPicture.map((entry) => <ClipCard key={entryKey(entry)} entry={entry} videosById={videosById} />)}
          </details>
        )}
      </div>
    </div>
  );
}

export default memo(PartialClipsView);
