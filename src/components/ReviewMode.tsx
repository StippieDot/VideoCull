import { useEffect, useCallback, useState, useRef, useMemo, memo, type CSSProperties } from 'react';
import useStore from '../store';
import ThumbnailStrip from './ThumbnailStrip';
import { formatSize, formatDuration, formatDate, calcThumbGrid, formatCodecLabel, formatFps, formatResolutionLabel } from '../utils';
import {
  Check, Trash2, SkipForward, Undo2, X, Play,
  ChevronLeft, ChevronRight, HardDrive, Clock, Calendar, Bookmark, RotateCcw, Heart, Star
} from 'lucide-react';
import '@videojs/react/video/minimal-skin.css';
import { createPlayer, videoFeatures } from '@videojs/react';
import { MinimalVideoSkin, Video } from '@videojs/react/video';
import { isWebSupported } from '../utils';
import { matchesKeybind, formatKeybind } from '../keybinds';
import './ReviewMode.css';

const Player = createPlayer({ features: videoFeatures });

// Memoized so it never re-renders due to currentTime/bookmark state updates in the parent.
// Frequent re-renders of the @videojs/react Player stack while the native decoder is active
// can trigger a 0xC0000005 access violation in Chromium's media pipeline.
const VideoPlayer = memo(({ videoUrl, videoRef, muted }: {
  videoUrl: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  muted: boolean;
}) => (
  <Player.Provider>
    <MinimalVideoSkin>
      <Video
        ref={videoRef}
        className="video-player"
        src={videoUrl}
        autoPlay
        muted={muted}
        playsInline
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      />
    </MinimalVideoSkin>
  </Player.Provider>
), (prev, next) => prev.videoUrl === next.videoUrl && prev.videoRef === next.videoRef);

function isFocusableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement) || target === document.body) return false;
  return Boolean(target.closest('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'));
}

export default function ReviewMode() {
  const allVideos = useStore((s) => s.videos);
  const filteredVideos = useStore((s) => s.filteredVideos);
  const reviewIndex = useStore((s) => s.reviewIndex);
  const reviewScopeIds = useStore((s) => s.reviewScopeIds);
  const setReviewIndex = useStore((s) => s.setReviewIndex);
  const setReviewMode = useStore((s) => s.setReviewMode);
  const setActiveReviewVideoPath = useStore((s) => s.setActiveReviewVideoPath);
  const folderFilterPath = useStore((s) => s.folderFilterPath);
  const setVideoStatus = useStore((s) => s.setVideoStatus);
  const undo = useStore((s) => s.undo);
  const undoStack = useStore((s) => s.undoStack);
  const globalMute = useStore((s) => s.settings.globalMute);
  const keyReset = useStore((s) => s.settings.keyReset);
  const keyUndo = useStore((s) => s.settings.keyUndo);
  const keyDelete = useStore((s) => s.settings.keyDelete);
  const keyPlay = useStore((s) => s.settings.keyPlay);
  const keySkip = useStore((s) => s.settings.keySkip);
  const keyKeep = useStore((s) => s.settings.keyKeep);
  const addBookmark = useStore((s) => s.addBookmark);
  const removeBookmark = useStore((s) => s.removeBookmark);
  const setVideoRating = useStore((s) => s.setVideoRating);
  const toggleFavorite = useStore((s) => s.toggleFavorite);
  const features = useStore((s) => s.settings.features);
  const pushToast = useStore((s) => s.pushToast);
  const effectiveGlobalMute = features.globalMute && globalMute;

  const scopeIdsRef = useRef<string[] | null>(null);
  if (scopeIdsRef.current === null) {
    scopeIdsRef.current = reviewScopeIds ?? filteredVideos.map((item) => item.id);
  }

  const reviewVideos = useMemo(() => {
    const byId = new Map(allVideos.map((item) => [item.id, item]));
    return (scopeIdsRef.current ?? []).map((id) => byId.get(id)).filter((item): item is typeof allVideos[number] => Boolean(item));
  }, [allVideos]);

  const video = reviewVideos[reviewIndex] ?? null;
  const total = reviewVideos.length;
  const bookmarks = video?.bookmarks ?? [];
  const { decidedCount, remainingCount, progressPct } = useMemo(() => {
    const decided = reviewVideos.reduce((sum, item) => (
      item.status === 'pending' ? sum : sum + 1
    ), 0);
    const remaining = Math.max(0, reviewVideos.length - decided);
    const pct = reviewVideos.length > 0 ? (decided / reviewVideos.length) * 100 : 0;
    return { decidedCount: decided, remainingCount: remaining, progressPct: pct };
  }, [reviewVideos]);
  const summary = useMemo(() => ({
    keep: reviewVideos.filter((item) => item.status === 'keep').length,
    delete: reviewVideos.filter((item) => item.status === 'delete').length,
    skipped: reviewVideos.filter((item) => item.status === 'skipped').length,
    pending: reviewVideos.filter((item) => item.status === 'pending').length,
    deleteSize: reviewVideos
      .filter((item) => item.status === 'delete')
      .reduce((sum, item) => sum + item.sizeBytes, 0),
  }), [reviewVideos]);
  const scopeLabel = useMemo(() => {
    if (folderFilterPath) {
      return folderFilterPath.split(/[/\\]/).filter(Boolean).slice(-1)[0] || folderFilterPath;
    }
    return total === allVideos.length ? 'session' : 'filtered selection';
  }, [allVideos.length, folderFilterPath, total]);

  const lastVideoIdRef = useRef<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDecodeError, setAudioDecodeError] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const dynamicAspectRatio = useMemo(() => {
    const { cols, rows } = calcThumbGrid(video?.thumbnails?.length || 1);
    return (cols * 16) / (rows * 9);
  }, [video?.thumbnails?.length]);

  const isSupported = useMemo(() => {
    if (!video) return false;
    return isWebSupported(video.path);
  }, [video]);
  const canPlayInReview = isSupported && (!features.compatibilityCheck || video?.compatible !== false);

  const videoUrl = useMemo(() => (
    video ? `video://local/${encodeURIComponent(video.path)}` : ''
  ), [video]);

  useEffect(() => {
    return () => setActiveReviewVideoPath(null);
  }, [setActiveReviewVideoPath]);

  useEffect(() => {
    if (!isPlaying || !window.electronAPI?.setVideoFullscreen) return;

    const syncMenuBar = () => {
      const fullscreenElement = document.fullscreenElement;
      const isVideoFullscreen = Boolean(
        fullscreenElement &&
        videoRef.current &&
        fullscreenElement.contains(videoRef.current)
      );
      void window.electronAPI.setVideoFullscreen(isVideoFullscreen);
    };

    document.addEventListener('fullscreenchange', syncMenuBar);
    syncMenuBar();
    return () => {
      document.removeEventListener('fullscreenchange', syncMenuBar);
      void window.electronAPI?.setVideoFullscreen(false);
    };
  }, [isPlaying, video?.id]);

  // One-shot autoplay: only the initially play-clicked video should auto-play.
  useEffect(() => {
    const currentVideoId = video?.id ?? null;
    if (lastVideoIdRef.current === currentVideoId) return;
    lastVideoIdRef.current = currentVideoId;

    const shouldPlay = useStore.getState().reviewAutoPlay;
    if (shouldPlay) {
      useStore.getState().setReviewAutoPlay(false);
      setIsPlaying(true);
    } else {
      setIsPlaying(false);
    }
    setCurrentTime(0);
    setAudioDecodeError(false);
  }, [video?.id]);

  // When playback starts: apply persisted speed, then sync speed changes back from the player
  useEffect(() => {
    if (!isPlaying) return;
    const el = videoRef.current;
    if (!el) return;

    el.playbackRate = playbackSpeed;

    const onRateChange = () => setPlaybackSpeed(el.playbackRate);
    const onTimeUpdate = () => setCurrentTime(el.currentTime);

    el.addEventListener('ratechange', onRateChange);
    el.addEventListener('timeupdate', onTimeUpdate);
    return () => {
      el.removeEventListener('ratechange', onRateChange);
      el.removeEventListener('timeupdate', onTimeUpdate);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]); // intentionally excludes playbackSpeed — only apply once on start

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = effectiveGlobalMute;
    }
  }, [effectiveGlobalMute]);

  // Show an overlay when Chromium can't decode the audio stream (AC3/EAC3/DTS etc.)
  // Muting doesn't prevent decoding — only an external player can handle these codecs.
  useEffect(() => {
    if (!isPlaying) return;
    const el = videoRef.current;
    if (!el) return;
    const onError = () => {
      if (el.error?.code === MediaError.MEDIA_ERR_DECODE) setAudioDecodeError(true);
    };
    el.addEventListener('error', onError);
    return () => el.removeEventListener('error', onError);
  }, [isPlaying]);

  const advance = useCallback(() => {
    if (reviewIndex < total) setReviewIndex(reviewIndex + 1);
  }, [reviewIndex, total, setReviewIndex]);

  const goBack = useCallback(() => {
    if (reviewIndex > 0) setReviewIndex(reviewIndex - 1);
  }, [reviewIndex, setReviewIndex]);

  const jumpToNextUndecided = useCallback(() => {
    if (total === 0) return;
    const start = reviewIndex + 1;
    const nextIndex = reviewVideos.findIndex((item, index) => index >= start && item.status === 'pending');
    const wrappedIndex = nextIndex >= 0
      ? nextIndex
      : reviewVideos.findIndex((item, index) => index < start && index !== reviewIndex && item.status === 'pending');

    if (wrappedIndex >= 0) {
      setIsPlaying(false);
      setReviewIndex(wrappedIndex);
      return;
    }

    pushToast({
      title: 'No undecided videos',
      detail: 'Every other video in this review scope already has a decision.',
      kind: 'info',
      dedupeKey: 'review-next-undecided-empty',
    });
  }, [pushToast, reviewIndex, reviewVideos, setReviewIndex, total]);

  const markKeep = useCallback(() => {
    if (!video) return;
    setVideoStatus(video.id, 'keep');
    advance();
  }, [video, advance, setVideoStatus]);

  const markDelete = useCallback(() => {
    if (!video) return;
    setVideoStatus(video.id, 'delete');
    advance();
  }, [video, advance, setVideoStatus]);

  const skip = useCallback(() => {
    if (!video) return;
    setVideoStatus(video.id, 'skipped');
    advance();
  }, [video, advance, setVideoStatus]);

  const resetStatus = useCallback(() => {
    if (!video) return;
    setVideoStatus(video.id, 'pending');
  }, [video, setVideoStatus]);

  const handleUndo = useCallback(() => undo(), [undo]);

  const handlePlay = useCallback(() => {
    if (!video) return;
    if (canPlayInReview) {
      setIsPlaying((prev) => !prev);
    } else if (window.electronAPI) {
      window.electronAPI.openVideo(video.path);
    }
  }, [video, canPlayInReview]);

  const close = useCallback(() => setReviewMode(false), [setReviewMode]);

  const addBookmarkNow = useCallback(() => {
    if (!video || !videoRef.current) return;
    addBookmark(video.id, videoRef.current.currentTime);
  }, [video, addBookmark]);

  const seekTo = useCallback((time: number) => {
    if (videoRef.current) videoRef.current.currentTime = time;
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (document.querySelector('.settings-overlay, .shortcuts-overlay')) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      // Stand down while the keybind recorder is capturing
      if (document.body.hasAttribute('data-capturing-keybind')) return;

      const s = useStore.getState().settings;

      // Escape is always hardcoded — not configurable
      // Skip if Shift is held (reserved for privacy screen toggle in App.tsx)
      if (e.key === 'Escape' && !e.shiftKey) {
        e.preventDefault();
        if (isPlaying) setIsPlaying(false);
        else close();
        return;
      }
      if (isFocusableKeyboardTarget(e.target)) return;

      // Playing-context shortcuts
      if (isPlaying) {
        if (matchesKeybind(e, s.keySeekBack)) {
          e.preventDefault();
          if (videoRef.current) videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 5);
          return;
        }
        if (matchesKeybind(e, s.keySeekForward)) {
          e.preventDefault();
          if (videoRef.current) videoRef.current.currentTime += 5;
          return;
        }
        if (matchesKeybind(e, s.keySpeedDown)) {
          e.preventDefault();
          if (videoRef.current) {
            const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
            const idx = speeds.indexOf(videoRef.current.playbackRate);
            if (idx > 0) videoRef.current.playbackRate = speeds[idx - 1];
          }
          return;
        }
        if (matchesKeybind(e, s.keySpeedUp)) {
          e.preventDefault();
          if (videoRef.current) {
            const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
            const idx = speeds.indexOf(videoRef.current.playbackRate);
            if (idx < speeds.length - 1) videoRef.current.playbackRate = speeds[idx + 1];
          }
          return;
        }
        if (matchesKeybind(e, s.keyBookmark)) {
          e.preventDefault();
          addBookmarkNow();
          return;
        }
      } else {
        // Not-playing navigation
        if (matchesKeybind(e, s.keyPrevVideo)) { e.preventDefault(); goBack(); return; }
        if (matchesKeybind(e, s.keyNextVideo)) { e.preventDefault(); advance(); return; }
      }

      // Context-independent shortcuts
      if (matchesKeybind(e, s.keyExternalPlayer)) {
        e.preventDefault();
        if (window.electronAPI && video?.path) window.electronAPI.openVideo(video.path);
        return;
      }
      if (s.features.nextUndecided && matchesKeybind(e, s.keyNextUndecided)) {
        if (isFocusableKeyboardTarget(e.target)) return;
        e.preventDefault();
        jumpToNextUndecided();
        return;
      }
      if (matchesKeybind(e, s.keyEnterPlay)) { e.preventDefault(); handlePlay(); return; }
      if (matchesKeybind(e, s.keyKeep))      { e.preventDefault(); markKeep(); return; }
      if (matchesKeybind(e, s.keyDelete))    { e.preventDefault(); markDelete(); return; }
      if (matchesKeybind(e, s.keySkip))      { e.preventDefault(); skip(); return; }
      if (matchesKeybind(e, s.keyReset))     { e.preventDefault(); resetStatus(); return; }
      if (matchesKeybind(e, s.keyUndo))      { e.preventDefault(); handleUndo(); return; }
      if (matchesKeybind(e, s.keyPlay))      { e.preventDefault(); handlePlay(); return; }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [markKeep, markDelete, skip, resetStatus, handleUndo, close, goBack, advance, handlePlay, isPlaying, video, addBookmarkNow, jumpToNextUndecided]);

  if (!video) {
    return (
      <div className="review-mode">
        <div className="review-finished">
          <div className="review-finished-kicker">Review complete</div>
          <h2>{scopeLabel}</h2>
          <p>{total} {total === 1 ? 'video' : 'videos'} in this review scope.</p>
          <div className="review-summary-grid">
            <div className="review-summary-item summary-keep">
              <span>{summary.keep}</span>
              <label>Keep</label>
            </div>
            <div className="review-summary-item summary-delete">
              <span>{summary.delete}</span>
              <label>Delete</label>
            </div>
            <div className="review-summary-item summary-skip">
              <span>{summary.skipped}</span>
              <label>Skipped</label>
            </div>
            <div className="review-summary-item">
              <span>{summary.pending}</span>
              <label>Pending</label>
            </div>
          </div>
          {summary.deleteSize > 0 && (
            <div className="review-summary-delete-size">
              {formatSize(summary.deleteSize)} marked for deletion
            </div>
          )}
          <button className="btn btn-accent" onClick={close} style={{ marginTop: 18 }}>
            Back to Grid
          </button>
        </div>
      </div>
    );
  }

  const statusClass =
    video.status === 'keep' ? 'review-keep' :
    video.status === 'delete' ? 'review-delete' : '';

  return (
    <div className={`review-mode ${statusClass}`}>
      <button className="review-close" onClick={close} title="Close (Esc)">
        <X size={20} />
      </button>

      <div
        className="review-counter review-counter-progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progressPct)}
        style={{ '--review-progress': `${progressPct}%` } as CSSProperties}
      >
        <span className="review-counter-text">{reviewIndex + 1} / {total} - {decidedCount} decided, {remainingCount} remaining</span>
      </div>

      <div className={`review-content ${isPlaying ? 'playing' : ''}`}>
        <button
          className="review-nav review-nav-left"
          onClick={(e) => { e.currentTarget.blur(); goBack(); }}
          disabled={reviewIndex === 0}
        >
          <ChevronLeft size={28} />
        </button>

        <div className="review-center">
          <div
            className={`review-thumbs ${isPlaying ? 'playing' : ''}`}
            style={!isPlaying ? { aspectRatio: `${dynamicAspectRatio}` } : undefined}
          >
            {isPlaying ? (
              <>
                <VideoPlayer
                  videoUrl={videoUrl}
                  videoRef={videoRef}
                  muted={effectiveGlobalMute}
                />
                {playbackSpeed !== 1 && (
                  <div className="review-speed-badge">{playbackSpeed}x</div>
                )}
                {audioDecodeError && (
                  <div className="review-decode-error-overlay">
                    <p>Audio codec not supported by the built-in player</p>
                    <div className="review-decode-error-actions">
                      <button onClick={() => { void window.electronAPI.openVideo(video.path); }}>
                        Open in external player
                      </button>
                      <button onClick={() => setAudioDecodeError(false)}>Dismiss</button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <ThumbnailStrip thumbnails={video.thumbnails} osThumbnail={video.osThumbnail} compact={true} />
                {bookmarks.length > 0 && (
                  <div className="review-bookmark-count">
                    <Bookmark size={11} />
                    {bookmarks.length}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Bookmark controls — only shown while playing */}
          {isPlaying && (
            <div className="review-bookmark-bar">
              <button
                className="review-bookmark-btn"
                onClick={addBookmarkNow}
                title="Bookmark current position (B)"
              >
                <Bookmark size={13} />
                <span>{formatDuration(currentTime)}</span>
              </button>

              {bookmarks.length > 0 && (
                <div className="review-bookmark-chips">
                  {bookmarks.map((t) => (
                    <span key={t} className="review-bookmark-chip">
                      <button className="chip-seek" onClick={() => seekTo(t)} title="Seek here">
                        {formatDuration(t)}
                      </button>
                      <button
                        className="chip-remove"
                        onClick={() => removeBookmark(video.id, t)}
                        title="Remove bookmark"
                      >
                        <X size={12} strokeWidth={3} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="review-title-row">
            <div className="review-filename">{video.filename}</div>
            {features.favorites && (
              <button
                className={`review-favorite-btn ${video.favorite ? 'active' : ''}`}
                onClick={() => toggleFavorite(video.id)}
                title={video.favorite ? 'Remove from favorites' : 'Add to favorites'}
                aria-label={video.favorite ? 'Remove from favorites' : 'Add to favorites'}
              >
                <Heart size={15} fill={video.favorite ? 'currentColor' : 'none'} />
              </button>
            )}
          </div>

          <div className="review-meta-row">
            <span className="review-meta-item"><HardDrive size={13} />{formatSize(video.sizeBytes)}</span>
            <span className="review-meta-item"><Clock size={13} />{formatDuration(video.durationSecs)}</span>
            <span className="review-meta-item"><Calendar size={13} />{formatDate(video.metadataDate || video.date)}</span>
            {features.codecBadges && formatResolutionLabel(video.width, video.height) && (
              <span className="review-meta-item review-meta-badge">{formatResolutionLabel(video.width, video.height)}</span>
            )}
            {features.codecBadges && formatCodecLabel(video.videoCodec) && (
              <span className="review-meta-item review-meta-badge">{formatCodecLabel(video.videoCodec)}</span>
            )}
            {features.codecBadges && formatFps(video.fps) && (
              <span className="review-meta-item review-meta-badge">{formatFps(video.fps)}</span>
            )}
          </div>

          {features.ratings && (
            <div className={`review-stars ${(video.rating ?? 0) > 0 ? 'has-rating' : ''}`}>
              {([1, 2, 3, 4, 5] as const).map((rating) => (
                <button
                  key={rating}
                  className={`review-star-btn ${(video.rating ?? 0) >= rating ? 'active' : ''}`}
                  onClick={() => setVideoRating(video.id, video.rating === rating ? 0 : rating)}
                  title={`Rate ${rating} star${rating > 1 ? 's' : ''}`}
                  aria-label={`Rate ${rating} star${rating > 1 ? 's' : ''}`}
                >
                  <Star size={15} fill={(video.rating ?? 0) >= rating ? 'currentColor' : 'none'} />
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          className="review-nav review-nav-right"
          onClick={(e) => { e.currentTarget.blur(); advance(); }}
          disabled={reviewIndex >= total}
        >
          <ChevronRight size={28} />
        </button>
      </div>

      <div className="review-actions">
        <button className="review-action-btn review-btn-reset" onClick={resetStatus} title={`Reset (${formatKeybind(keyReset)})`}>
          <RotateCcw size={18} />
          <span>Reset</span>
          <kbd>{formatKeybind(keyReset)}</kbd>
        </button>

        <button
          className="review-action-btn review-undo"
          onClick={handleUndo}
          disabled={undoStack.length === 0}
          title={`Undo (${formatKeybind(keyUndo)})`}
        >
          <Undo2 size={18} />
          <span>Undo</span>
          <kbd>{formatKeybind(keyUndo)}</kbd>
        </button>

        <button className="review-action-btn review-btn-delete" onClick={markDelete} title={`Delete (${formatKeybind(keyDelete)})`}>
          <Trash2 size={20} />
          <span>Delete</span>
          <kbd>{formatKeybind(keyDelete)}</kbd>
        </button>

        <button
          className="review-action-btn review-btn-play"
          onClick={handlePlay}
          title={`${canPlayInReview ? 'Play' : 'Open in external player'} (${formatKeybind(keyPlay)})`}
        >
          <Play size={20} />
          <span>{canPlayInReview ? 'Play' : 'Open External'}</span>
          <kbd>{formatKeybind(keyPlay)}</kbd>
        </button>

        <button className="review-action-btn review-btn-skip" onClick={skip} title={`Skip (${formatKeybind(keySkip)})`}>
          <SkipForward size={20} />
          <span>Skip</span>
          <kbd>{formatKeybind(keySkip)}</kbd>
        </button>

        <button className="review-action-btn review-btn-keep" onClick={markKeep} title={`Keep (${formatKeybind(keyKeep)})`}>
          <Check size={20} />
          <span>Keep</span>
          <kbd>{formatKeybind(keyKeep)}</kbd>
        </button>
      </div>
    </div>
  );
}
