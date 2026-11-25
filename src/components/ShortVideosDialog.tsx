import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import useStore, { runWithUndoAction } from '../store';
import { selectShortVideosForDelete } from '../short-videos';
import { formatSize } from '../utils';
import { SettingRow } from './SettingRow';
import './Dialog.css';
import './SettingsModal.css';
import './ShortVideosDialog.css';

const DEFAULT_THRESHOLD_SECS = '10';

const PRESETS = [
  { label: '5 s', secs: 5 },
  { label: '10 s', secs: 10 },
  { label: '30 s', secs: 30 },
  { label: '1 min', secs: 60 },
  { label: '5 min', secs: 300 },
];

/** A maximum-duration filter is the length the person was already looking at, so start from it. */
function initialThreshold(): string {
  const max = useStore.getState().maxDurationFilter;
  return max !== null && Number.isFinite(max) && max > 0 ? String(Math.round(max * 10) / 10) : DEFAULT_THRESHOLD_SECS;
}

const videos = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'video' : 'videos'}`;

export default function ShortVideosDialog({ onClose }: { onClose: () => void }) {
  const filteredVideos = useStore((s) => s.filteredVideos);
  const setVideoStatusesBatch = useStore((s) => s.setVideoStatusesBatch);
  const pushToast = useStore((s) => s.pushToast);
  const [text, setText] = useState(initialThreshold);
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
      detail: `${videos(eligible.length)} shorter than ${threshold} seconds marked Delete.`,
      kind: 'success',
      dedupeKey: `short-videos:${threshold}:${eligible.length}`,
      ...undo,
    });
    onClose();
  };

  // Lets the person look at the videos first: the length becomes the Duration filter, and the sidebar
  // button reopens this dialog from that same length.
  const showFirst = () => {
    useStore.getState().setDurationFilterRange(0, threshold);
    onClose();
  };

  const { protectedCounts: left } = selection;
  const leftAlone = ([
    ['already marked Delete', left.alreadyDelete],
    ['marked Keep', left.keep],
    ['skipped', left.skipped],
    ['rated', left.rated],
    ['favorited', left.favorite],
    ['with bookmarks', left.bookmarked],
    ['with an unknown length', selection.unknownDuration],
  ] as Array<[string, number]>)
    .filter(([, n]) => n > 0)
    .map(([label, n]) => `${n.toLocaleString()} ${label}`);

  const hasVideos = thresholdValid && selection.eligible.length > 0;

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
          <div className="settings-card">
            <SettingRow
              label="Shorter than"
              help="Only videos in the current view are considered."
              details={
                <>
                  {!thresholdValid && <span className="help-text">Enter a length above 0 seconds.</span>}
                  <div className="short-videos-presets" role="group" aria-label="Common lengths">
                    {PRESETS.map(({ label, secs }) => (
                      <button
                        key={secs}
                        type="button"
                        className="short-videos-preset"
                        aria-pressed={threshold === secs}
                        onClick={() => setText(String(secs))}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </>
              }
            >
              {(id) => (
                <div className="flex-row">
                  <input
                    id={id}
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
                </div>
              )}
            </SettingRow>

            <SettingRow
              label="Will be marked Delete"
              help="Delete Marked Videos later deletes every video marked Delete, not just these."
              details={hasVideos && (
                <button type="button" className="short-videos-link" onClick={showFirst}>Show them in the grid first</button>
              )}
            >
              {() => (
                <span className="short-videos-value" aria-live="polite">
                  {hasVideos ? `${videos(selection.eligible.length)} (${formatSize(selection.eligibleBytes)})` : 'None'}
                </span>
              )}
            </SettingRow>

            {thresholdValid && leftAlone.length > 0 && (
              <SettingRow label="Left alone" help={leftAlone.join(', ')}>
                {() => null}
              </SettingRow>
            )}
          </div>
        </div>

        <div className="settings-footer">
          <button className="btn-cancel" onClick={onClose}>Cancel</button>
          <button className="btn-save" disabled={selection.eligible.length === 0} onClick={apply}>
            {selection.eligible.length > 0 ? `Mark ${videos(selection.eligible.length)}` : 'Mark videos'}
          </button>
        </div>
      </div>
    </div>
  );
}
