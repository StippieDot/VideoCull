import { useState, useRef, useEffect } from 'react';
import type { Video } from '../types';
import useStore from '../store';
import ThumbnailStrip from './ThumbnailStrip';
import { formatSize, formatDuration, formatCodecLabel, formatFps, formatResolutionLabel, isWebSupported } from '../utils';
import { Check, SkipForward, Square, CheckSquare, Trash2, Play, Heart, Star } from 'lucide-react';
import './VideoCard.css';

interface VideoCardProps {
  video: Video;
  style?: React.CSSProperties;
  isSelected?: boolean;
  showSelectionControls?: boolean;
  onClick?: (video: Video, event: React.MouseEvent) => void;
  onPlay?: (video: Video, event: React.MouseEvent) => void;
  onToggleSelect?: (video: Video, event: React.MouseEvent) => void;
}

export default function VideoCard({ video, style, isSelected = false, showSelectionControls = false, onClick, onPlay, onToggleSelect }: VideoCardProps) {
  const [isVisible, setIsVisible] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;

    // Hard-throttle IPC protocol overloading by deferring DOM parsing until approaching viewport
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '350px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const setVideoStatus = useStore((s) => s.setVideoStatus);
  const enterReviewAndPlay = useStore((s) => s.enterReviewAndPlay);
  const setVideoRating = useStore((s) => s.setVideoRating);
  const toggleFavorite = useStore((s) => s.toggleFavorite);
  const features = useStore((s) => s.settings.features);

  const statusClass =
    video.status === 'keep' ? 'card-keep' :
    video.status === 'delete' ? 'card-delete' :
    video.status === 'skipped' ? 'card-skipped' : '';

  const handleKeep = (e: React.MouseEvent) => {
    e.stopPropagation();
    setVideoStatus(video.id, video.status === 'keep' ? 'pending' : 'keep');
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setVideoStatus(video.id, video.status === 'delete' ? 'pending' : 'delete');
  };

  const isWeb = isWebSupported(video.path);
  const canPlayInReview = isWeb && (!features.compatibilityCheck || video.compatible !== false);
  const resolutionLabel = formatResolutionLabel(video.width, video.height);
  const codecLabel = formatCodecLabel(video.videoCodec);
  const fpsLabel = formatFps(video.fps);

  const handleFavorite = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleFavorite(video.id);
  };

  const handleRate = (e: React.MouseEvent, rating: 1 | 2 | 3 | 4 | 5) => {
    e.stopPropagation();
    setVideoRating(video.id, video.rating === rating ? 0 : rating);
  };

  const handlePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onPlay) {
      onPlay(video, e);
      return;
    }
    if (canPlayInReview && !e.ctrlKey) {
      enterReviewAndPlay(video.id);
    } else if (window.electronAPI) {
      window.electronAPI.openVideo(video.path);
    }
  };

  return (
    <div
      ref={cardRef}
      className={`video-card ${statusClass} ${isSelected ? 'card-selected' : ''} ${features.favorites ? 'has-favorite-control' : ''} ${showSelectionControls ? 'has-selection-control' : ''}`}
      style={style}
      onMouseDown={(e) => {
        if (e.shiftKey) e.preventDefault();
      }}
      onClick={(e) => onClick?.(video, e)}
    >
      <div className="card-thumb-area">
        {showSelectionControls && onToggleSelect && (
          <button
            className={`card-select-toggle ${isSelected ? 'active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect(video, e);
            }}
            title={isSelected ? 'Unselect' : 'Select'}
            aria-label={isSelected ? 'Unselect video' : 'Select video'}
          >
            {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
          </button>
        )}

        {isVisible ? (
          <ThumbnailStrip thumbnails={video.thumbnails} compact />
        ) : (
          <div className="thumb-strip thumb-strip-placeholder thumb-strip-compact" />
        )}

        {video.status !== 'pending' && (
          <div className={`card-status-badge badge-${video.status}`}>
            {video.status === 'keep' && <Check size={12} />}
            {video.status === 'delete' && <Trash2 size={12} />}
            {video.status === 'skipped' && <SkipForward size={12} />}
          </div>
        )}

        {features.favorites && (
          <button
            className={`card-favorite-btn ${video.favorite ? 'active' : ''}`}
            onClick={handleFavorite}
            title={video.favorite ? 'Remove from favorites' : 'Add to favorites'}
            aria-label={video.favorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            <Heart size={13} fill={video.favorite ? 'currentColor' : 'none'} />
          </button>
        )}

        <div className="card-hover-overlay">
          <button 
            className="card-action-btn card-play-btn" 
            onClick={handlePlay} 
            title={canPlayInReview ? "Play in review mode (Ctrl+Click for external player)" : "Open in external player"}
          >
            <Play size={20} />
          </button>
        </div>
      </div>

      <div className="card-info">
        <p className="card-filename" title={video.filename}>
          {video.filename}
        </p>
        <div className="card-meta">
          <span>{formatSize(video.sizeBytes)}</span>
          <span className="meta-sep">•</span>
          <span>{formatDuration(video.durationSecs)}</span>
        </div>
        {features.codecBadges && (resolutionLabel || codecLabel || fpsLabel) && (
          <div className="card-badges">
            {resolutionLabel && <span className="card-badge">{resolutionLabel}</span>}
            {codecLabel && <span className="card-badge">{codecLabel}</span>}
            {fpsLabel && <span className="card-badge">{fpsLabel}</span>}
            {video.duplicateGroupId && <span className="card-badge">Dup {video.duplicateSimilarity?.toFixed(0) ?? ''}%</span>}
          </div>
        )}
      </div>

      {features.ratings && (
        <div className={`card-stars ${(video.rating ?? 0) > 0 ? 'has-rating' : ''}`}>
          {([1, 2, 3, 4, 5] as const).map((rating) => (
            <button
              key={rating}
              className={`card-star-btn ${(video.rating ?? 0) >= rating ? 'active' : ''}`}
              onClick={(e) => handleRate(e, rating)}
              title={`Rate ${rating} star${rating > 1 ? 's' : ''}`}
              aria-label={`Rate ${rating} star${rating > 1 ? 's' : ''}`}
            >
              <Star size={12} fill={(video.rating ?? 0) >= rating ? 'currentColor' : 'none'} />
            </button>
          ))}
        </div>
      )}

      <div className="card-actions">
        <button
          className={`card-btn card-btn-keep ${video.status === 'keep' ? 'active' : ''}`}
          onClick={handleKeep}
          title="Keep (K)"
        >
          <Check size={14} />
        </button>
        <button
          className={`card-btn card-btn-delete ${video.status === 'delete' ? 'active' : ''}`}
          onClick={handleDelete}
          title="Delete (D)"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}
