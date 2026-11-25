import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import useStore, { runWithUndoAction } from '../store';
import { selectShortVideosForDelete } from '../short-videos';
import { formatSize } from '../utils';
import './Dialog.css';
import './ShortVideosDialog.css';

const DEFAULT_THRESHOLD_SECS = '10';

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

export default function ShortVideosDialog({ onClose }: { onClose: () => void }) {
  const filteredVideos = useStore((s) => s.filteredVideos);
  const setVideoStatusesBatch = useStore((s) => s.setVideoStatusesBatch);
  const pushToast = useStore((s) => s.pushToast);
  const [text, setText] = useState(DEFAULT_THRESHOLD_SECS);
  const threshold = text.trim() === '' ? Number.NaN : Number(text);
  const thresholdValid = Number.isFinite(threshold) && threshold > 0;
  const selection = useMemo(() => selectShortVideosForDelete(filteredVideos, threshold), [filteredVideos, threshold]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.shiftKey) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const apply = () => {
    // The view can change while the dialog is open, so the choice is made again from what is shown now.
    const { eligible } = selectShortVideosForDelete(useStore.getState().filteredVideos, threshold);
    if (eligible.length === 0) return;
    const undo = runWithUndoAction(() => setVideoStatusesBatch(eligible.map((video) => video.id), 'delete'));
    pushToast({
      title: 'Short videos marked',
      detail: `${count(eligible.length, 'video')} shorter than ${threshold} seconds marked Delete.`,
      kind: 'success',
      dedupeKey: `short-videos:${threshold}:${eligible.length}`,
      ...undo,
    });
    onClose();
  };

  const { protectedCounts: left } = selection;
  const leftAlone = [
    [left.alreadyDelete, 'already marked Delete'],
    [left.keep, 'marked Keep'],
    [left.skipped, 'Skipped'],
    [left.rated, 'rated'],
    [left.favorite, 'favorited'],
    [left.bookmarked, 'with bookmarks'],
  ].filter(([n]) => (n as number) > 0) as Array<[number, string]>;

  return (
    <div className="dialog-overlay short-videos-overlay" onClick={onClose}>
      <div
        className="dialog-window short-videos-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="short-videos-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-header">
          <h2 id="short-videos-title">Mark short videos for deletion</h2>
          <button className="dialog-close-btn" onClick={onClose} title="Close (Esc)" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="short-videos-body">
          <label className="short-videos-field">
            <span>Videos in the current view shorter than</span>
            <input
              type="number"
              min="0"
              step="any"
              autoFocus
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') apply(); }}
              aria-invalid={!thresholdValid}
            />
            <span>seconds</span>
          </label>

          <p className="short-videos-preview" aria-live="polite">
            {!thresholdValid
              ? 'Enter a length above 0 seconds.'
              : selection.eligible.length === 0
                ? 'No videos to mark.'
                : `${count(selection.eligible.length, 'video')} (${formatSize(selection.eligibleBytes)}) will be marked Delete.`}
          </p>

          {thresholdValid && (leftAlone.length > 0 || selection.unknownDuration > 0) && (
            <ul className="short-videos-left help-text">
              {leftAlone.map(([n, label]) => <li key={label}>{n} {label}, left alone</li>)}
              {selection.unknownDuration > 0 && <li>{count(selection.unknownDuration, 'video')} with an unknown length, left alone</li>}
            </ul>
          )}

          <p className="short-videos-note help-text">
            This only marks videos. Delete Marked Videos later deletes every video marked Delete, not just these. You can undo this right after.
          </p>
        </div>

        <div className="short-videos-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-accent" disabled={selection.eligible.length === 0} onClick={apply}>
            {selection.eligible.length > 0 ? `Mark ${count(selection.eligible.length, 'video')}` : 'Mark videos'}
          </button>
        </div>
      </div>
    </div>
  );
}
