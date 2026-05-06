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
const VideoPlayer = memo(({ videoUrl, videoRef }: {
  videoUrl: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}) => (
  <Player.Provider>
    <MinimalVideoSkin>
      <Video
        ref={videoRef}
        className="video-player"
        src={videoUrl}
        autoPlay
        playsInline
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      />
    </MinimalVideoSkin>
  </Player.Provider>
));

export default function ReviewMode() {
  const filteredVideos = useStore((s) => s.filteredVideos);
  const reviewIndex = useStore((s) => s.reviewIndex);
  const setReviewIndex = useStore((s) => s.setReviewIndex);
  const setReviewMode = useStore((s) => s.setReviewMode);
  const setVideoStatus = useStore((s) => s.setVideoStatus);
  const undo = useStore((s) => s.undo);
  const undoStack = useStore((s) => s.undoStack);
  const settings = useStore((s) => s.settings);
  const addBookmark = useStore((s) => s.addBookmark);
  const removeBookmark = useStore((s) => s.removeBookmark);
  const setVideoRating = useStore((s) => s.setVideoRating);
  const toggleFavorite = useStore((s) => s.toggleFavorite);
  const features = useStore((s) => s.settings.features);

  const video = filteredVideos[reviewIndex] ?? null;
  const total = filteredVideos.length;
  const bookmarks = video?.bookmarks ?? [];
  const { decidedCount, remainingCount, progressPct } = useMemo(() => {
    const decided = filteredVideos.reduce((sum, item) => (
      item.status === 'pending' ? sum : sum + 1
    ), 0);
    const remaining = Math.max(0, filteredVideos.length - decided);
    const pct = filteredVideos.length > 0 ? (decided / filteredVideos.length) * 100 : 0;
    return { decidedCount: decided, remainingCount: remaining, progressPct: pct };
  }, [filteredVideos]);

  const lastVideoIdRef = useRef<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  const dynamicAspectRatio = useMemo(() => {
    const { cols, rows } = calcThumbGrid(video?.thumbnails?.length || 1);
    return (cols * 16) / (rows * 9);
  }, [video?.thumbnails?.length]);

  const isSupported = useMemo(() => {
    if (!video) return false;
    return isWebSupported(video.path);
  }, [video]);

  const videoUrl = useMemo(() => (
    video ? `video://local/${encodeURIComponent(video.path)}` : ''
  ), [video]);

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

  const advance = useCallback(() => {
    if (reviewIndex < total - 1) setReviewIndex(reviewIndex + 1);
  }, [reviewIndex, total, setReviewIndex]);

  const goBack = useCallback(() => {
    if (reviewIndex > 0) setReviewIndex(reviewIndex - 1);
  }, [reviewIndex, setReviewIndex]);

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
    if (isSupported) {
      setIsPlaying((prev) => !prev);
    } else if (window.electronAPI) {
      window.electronAPI.openVideo(video.path);
    }
  }, [video, isSupported]);

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
  }, [markKeep, markDelete, skip, resetStatus, handleUndo, close, goBack, advance, handlePlay, isPlaying, video, addBookmarkNow]);

  if (!video) {
    return (
      <div className="review-mode">
        <div className="review-finished">
          <h2>All done!</h2>
          <p>You've reviewed all videos in this filter.</p>
          <button className="btn btn-accent" onClick={close} style={{ marginTop: 16 }}>
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
                />
                {playbackSpeed !== 1 && (
                  <div className="review-speed-badge">{playbackSpeed}x</div>
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
          disabled={reviewIndex >= total - 1}
        >
          <ChevronRight size={28} />
        </button>
      </div>

      <div className="review-actions">
        <button className="review-action-btn review-btn-reset" onClick={resetStatus} title={`Reset (${formatKeybind(settings.keyReset)})`}>
          <RotateCcw size={18} />
          <span>Reset</span>
          <kbd>{formatKeybind(settings.keyReset)}</kbd>
        </button>

        <button
          className="review-action-btn review-undo"
          onClick={handleUndo}
          disabled={undoStack.length === 0}
          title={`Undo (${formatKeybind(settings.keyUndo)})`}
        >
          <Undo2 size={18} />
          <span>Undo</span>
          <kbd>{formatKeybind(settings.keyUndo)}</kbd>
        </button>

        <button className="review-action-btn review-btn-delete" onClick={markDelete} title={`Delete (${formatKeybind(settings.keyDelete)})`}>
          <Trash2 size={20} />
          <span>Delete</span>
          <kbd>{formatKeybind(settings.keyDelete)}</kbd>
        </button>

        <button className="review-action-btn review-btn-play" onClick={handlePlay} title={`Play (${formatKeybind(settings.keyPlay)})`}>
          <Play size={20} />
          <span>Play</span>
          <kbd>{formatKeybind(settings.keyPlay)}</kbd>
        </button>

        <button className="review-action-btn review-btn-skip" onClick={skip} title={`Skip (${formatKeybind(settings.keySkip)})`}>
          <SkipForward size={20} />
          <span>Skip</span>
          <kbd>{formatKeybind(settings.keySkip)}</kbd>
        </button>

        <button className="review-action-btn review-btn-keep" onClick={markKeep} title={`Keep (${formatKeybind(settings.keyKeep)})`}>
          <Check size={20} />
          <span>Keep</span>
          <kbd>{formatKeybind(settings.keyKeep)}</kbd>
        </button>
      </div>
    </div>
  );
}
