import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Moon, Pause, Play, Power, Search, Trash2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import useStore from '../store';
import usePowerState from '../hooks/usePowerState';
import useProcessingPauseState from '../hooks/useProcessingPauseState';
import type { PowerState, ProcessingPauseState, TaskbarProgress } from '../types';
import videoCullIcon from '../assets/videocull-icon.png';
import { openAppMenuAt, runAppCommand } from '../appCommands';
import { formatRecentPath, formatSize, plural } from '../utils';
import AppMenu, { type AppMenuItem } from './AppMenu';
import { formatTimeLeft, listProcessingJobs, TimeLeftEstimator, type ProcessingJob } from './processingStatus';
import LocationBar, { type LocationBarAppActions } from './LocationBar';
import './TitleBar.css';

// Must match the top-level menus in electron/app-menu.js; the main process opens them by label.
const MENUS = [
  { label: 'File', accessKey: 'f' },
  { label: 'Actions', accessKey: 'a' },
  { label: 'View', accessKey: 'v' },
  { label: 'Video', accessKey: 'd' },
  { label: 'Help', accessKey: 'h' },
] as const;

type MenuLabel = typeof MENUS[number]['label'];

// Labels match Actions › When Processing Finishes, whose items the choices run.
const FINISH_ACTIONS = [['none', 'Do Nothing'], ['sleep', 'Sleep'], ['shutdown', 'Shut Down']] as const;

const FINISH_ACTION_GLYPHS = { none: null, sleep: Moon, shutdown: Power } as const;

/** Time left per job, from the progress seen so far; nothing while paused. */
function useTimeLeft(jobs: ProcessingJob[], paused: boolean): Map<ProcessingJob['id'], string> {
  const estimators = useRef(new Map<ProcessingJob['id'], TimeLeftEstimator>());
  return useMemo(() => {
    const result = new Map<ProcessingJob['id'], string>();
    for (const job of jobs) {
      let estimator = estimators.current.get(job.id);
      if (!estimator) {
        estimator = new TimeLeftEstimator();
        estimators.current.set(job.id, estimator);
      }
      // A pause breaks the rate; it starts over on resume.
      if (paused) {
        estimator.reset();
        continue;
      }
      const seconds = estimator.update(`${job.id}:${job.label}`, job.fraction, Date.now());
      if (seconds !== null) result.set(job.id, formatTimeLeft(seconds));
    }
    return result;
  }, [jobs, paused]);
}

/** The taskbar button shows the most important measurable job, so progress shows while minimised. */
function useTaskbarProgress(jobs: ProcessingJob[], paused: boolean) {
  const lastSent = useRef('');
  useEffect(() => {
    const job = jobs.find((entry) => entry.fraction !== null) ?? jobs[0];
    const progress: TaskbarProgress = !job
      ? { mode: 'none' }
      : job.fraction === null
        ? { mode: 'indeterminate' }
        // Whole percents: the taskbar cannot show finer steps, so smaller changes are not sent.
        : { mode: paused ? 'paused' : 'normal', fraction: Math.floor(job.fraction * 100) / 100 };
    const key = JSON.stringify(progress);
    if (key === lastSent.current) return;
    lastSent.current = key;
    window.electronAPI?.setTaskbarProgress(progress);
  }, [jobs, paused]);
}

function JobRow({ job, timeLeft, paused }: { job: ProcessingJob; timeLeft?: string; paused: boolean }) {
  return (
    <div className="processing-job">
      <div className="processing-job-text">
        <span className="processing-job-label">{job.label}</span>
        <span className="processing-job-detail">{[job.detail, paused ? 'Paused' : timeLeft].filter(Boolean).join(' · ')}</span>
      </div>
      <div className="processing-job-track" aria-hidden="true">
        <div
          className={`processing-job-fill${job.fraction === null ? ' indeterminate' : ''}${paused ? ' paused' : ''}`}
          style={job.fraction === null ? undefined : { width: `${Math.min(100, job.fraction * 100)}%` }}
        />
      </div>
    </div>
  );
}

const RING_RADIUS = 6;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/** Stands in for the status text when the window is too narrow for it (TitleBar.css). */
function ProgressRing({ fraction, paused }: { fraction: number | null; paused: boolean }) {
  return (
    <svg className={`title-bar-status-ring${fraction === null ? ' indeterminate' : ''}${paused ? ' paused' : ''}`} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle className="title-bar-status-ring-track" cx="8" cy="8" r={RING_RADIUS} />
      <circle
        className="title-bar-status-ring-fill"
        cx="8"
        cy="8"
        r={RING_RADIUS}
        strokeDasharray={RING_LENGTH}
        strokeDashoffset={RING_LENGTH * (1 - (fraction ?? 0.25))}
      />
    </svg>
  );
}

function MenuLabelText({ label, accessKey, showAccessKey }: { label: string; accessKey: string; showAccessKey: boolean }) {
  const index = label.toLowerCase().indexOf(accessKey);
  if (!showAccessKey || index < 0) return <>{label}</>;
  return (
    <>
      {label.slice(0, index)}
      <span className="title-bar-access-key">{label[index]}</span>
      {label.slice(index + 1)}
    </>
  );
}

/** The File / Actions / View / Video / Help buttons; each opens the matching native menu below it. */
function AppMenuButtons() {
  const [openMenu, setOpenMenu] = useState<MenuLabel | null>(null);
  const [altHeld, setAltHeld] = useState(false);
  const buttonRefs = useRef(new Map<MenuLabel, HTMLButtonElement>());

  const open = async (label: MenuLabel) => {
    const button = buttonRefs.current.get(label);
    if (!button || !window.electronAPI) return;
    const rect = button.getBoundingClientRect();
    setOpenMenu(label);
    try {
      await openAppMenuAt(label, rect.left, rect.bottom);
    } finally {
      setOpenMenu(null);
    }
  };
  const openRef = useRef(open);
  openRef.current = open;

  // Alt+letter opens a menu, as with the native menu bar; holding Alt shows the access keys.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Alt') {
        setAltHeld(true);
        return;
      }
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const menu = MENUS.find((entry) => entry.accessKey === event.key.toLowerCase());
      if (!menu) return;
      event.preventDefault();
      setAltHeld(false);
      void openRef.current(menu.label);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Alt') setAltHeld(false);
    };
    const handleBlur = () => setAltHeld(false);
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  return (
    <nav className="title-bar-menus" aria-label="Application menu">
      {MENUS.map(({ label, accessKey }) => (
        <button
          key={label}
          ref={(element) => {
            if (element) buttonRefs.current.set(label, element);
            else buttonRefs.current.delete(label);
          }}
          type="button"
          className={`title-bar-menu-button${openMenu === label ? ' open' : ''}`}
          aria-haspopup="menu"
          aria-expanded={openMenu === label}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void open(label)}
        >
          <MenuLabelText label={label} accessKey={accessKey} showAccessKey={altHeld} />
        </button>
      ))}
    </nav>
  );
}

interface ProcessingStatusProps {
  status: ProcessingJob;
  jobs: ProcessingJob[];
  paused: boolean;
  pauseStatus: ProcessingPauseState['status'];
  canPause: boolean;
  power: PowerState;
  timeLeft: Map<ProcessingJob['id'], string>;
}

/** The status button with its pause button, and the panel listing every running job. */
function ProcessingStatus({ status, jobs, paused, pauseStatus, canPause, power, timeLeft }: ProcessingStatusProps) {
  const pillRef = useRef<HTMLButtonElement>(null);
  const [panelAt, setPanelAt] = useState<{ x: number; y: number } | null>(null);
  const togglePanel = () => {
    const rect = pillRef.current?.parentElement?.getBoundingClientRect();
    setPanelAt((open) => (open || !rect ? null : { x: rect.left, y: rect.bottom + 4 }));
  };
  const closePanel = useCallback((refocus: boolean) => {
    setPanelAt(null);
    if (refocus) pillRef.current?.focus();
  }, []);
  const FinishGlyph = FINISH_ACTION_GLYPHS[power.finishAction];
  const statusDetail = status.detail ?? '';
  const panelItems: AppMenuItem[] = [
    ...(canPause ? [{
      key: 'pause',
      label: paused ? 'Resume Processing' : 'Pause Processing',
      icon: paused ? Play : Pause,
      disabled: pauseStatus === 'pausing',
      onSelect: () => void window.electronAPI?.setProcessingPaused(!paused),
    }] : []),
    ...(power.processing ? [
      { type: 'separator' as const, key: 'sep-finish' },
      { type: 'heading' as const, key: 'finish', label: 'When processing finishes' },
      ...FINISH_ACTIONS.map(([action, label]): AppMenuItem => ({
        key: action,
        label,
        radio: true,
        checked: power.finishAction === action,
        onSelect: () => void runAppCommand(`Actions > When Processing Finishes > ${label}`),
      })),
    ] : []),
  ];

  return (
    <>
      <div className="title-bar-status-pill">
        <button
          ref={pillRef}
          type="button"
          className="title-bar-status-button"
          title={[status.label, statusDetail, paused ? 'Paused' : ''].filter(Boolean).join(' · ')}
          aria-haspopup="menu"
          aria-expanded={panelAt !== null}
          onMouseDown={(event) => event.preventDefault()}
          onClick={togglePanel}
        >
          <ProgressRing fraction={status.fraction} paused={paused} />
          <span className="title-bar-status" role="status">
            <span className="title-bar-status-label">{status.label}</span>
            {statusDetail && <span className="title-bar-status-detail">{statusDetail}</span>}
            {paused && <span className="title-bar-status-paused">Paused</span>}
          </span>
          {jobs.length > 1 && <span className="title-bar-status-more" aria-label={`and ${jobs.length - 1} more`}>+{jobs.length - 1}</span>}
          {FinishGlyph && (
            <FinishGlyph size={12} className="title-bar-status-finish" aria-label={power.finishAction === 'sleep' ? 'Then sleep' : 'Then shut down'} />
          )}
        </button>
        {canPause && <button
          type="button"
          className={`title-bar-icon-button${paused ? ' paused' : ''}`}
          title={pauseStatus === 'running' ? 'Pause processing' : pauseStatus === 'pausing' ? 'Pausing...' : 'Resume processing'}
          aria-label={pauseStatus === 'running' ? 'Pause processing' : 'Resume processing'}
          disabled={pauseStatus === 'pausing'}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void window.electronAPI?.setProcessingPaused(pauseStatus === 'running')}
        >
          {pauseStatus === 'running' ? <Pause size={14} /> : <Play size={14} />}
        </button>}
      </div>
      {panelAt && (
        <AppMenu
          label="Processing"
          content={jobs.map((job) => <JobRow key={job.id} job={job} timeLeft={timeLeft.get(job.id)} paused={paused} />)}
          items={panelItems}
          className="processing-panel"
          x={panelAt.x}
          y={panelAt.y}
          onClose={closePanel}
          keepOpenWithin=".title-bar-status-button"
        />
      )}
    </>
  );
}

/**
 * Replaces the Windows title bar and menu bar. The menus themselves stay native: each button opens
 * the matching application menu, so enabled states and shortcuts come from one place. Windows draws
 * the window buttons on the right (titleBarOverlay).
 */
export default function TitleBar({ isPrivate, onOpenCommandPalette, locationActions }: {
  isPrivate: boolean;
  onOpenCommandPalette: () => void;
  locationActions: LocationBarAppActions;
}) {
  const directories = useStore((s) => s.directories);
  // Compared field by field, so the bar only re-renders when processing progress changes.
  const processingInputs = useStore(useShallow((s) => ({
    isGenerating: s.isGenerating,
    genProgress: s.genProgress,
    isFindingDuplicates: s.isFindingDuplicates,
    duplicateProgress: s.duplicateProgress,
    isScanning: s.isScanning,
    scanProgress: s.scanProgress,
  })));
  const jobs = useMemo(() => listProcessingJobs(processingInputs), [processingInputs]);
  const power = usePowerState();
  const pauseStatus = useProcessingPauseState().status;
  const canPause = processingInputs.isGenerating || processingInputs.isFindingDuplicates;
  const paused = canPause && pauseStatus !== 'running';
  const timeLeft = useTimeLeft(jobs, paused);
  useTaskbarProgress(jobs, paused);
  const status = jobs[0] ?? null;
  const marked = useStore(useShallow((s) => ({ count: s.stats.delete, size: s.stats.deleteSize })));

  const sessionTitle = isPrivate || directories.length === 0
    ? 'VideoCull'
    : directories.length === 1
      ? formatRecentPath(directories[0])
      : `${formatRecentPath(directories[0])} + ${directories.length - 1} more`;

  return (
    <header className="title-bar">
      <div className="title-bar-start">
        <img className="title-bar-icon" src={videoCullIcon} alt="" draggable={false} />
        <AppMenuButtons />
      </div>
      <div className="title-bar-center">
        {isPrivate ? (
          <div className="title-bar-title">{sessionTitle}</div>
        ) : (
          <LocationBar sessionTitle={sessionTitle} appActions={locationActions} />
        )}
      </div>
      {status && (
        <div className="title-bar-progress" aria-hidden="true">
          <div
            className={`title-bar-progress-fill${status.fraction === null ? ' indeterminate' : ''}${paused ? ' paused' : ''}`}
            style={status.fraction === null ? undefined : { width: `${Math.min(100, status.fraction * 100)}%` }}
          />
        </div>
      )}
      <div className="title-bar-actions">
        {status && !isPrivate && (
          <ProcessingStatus status={status} jobs={jobs} paused={paused} pauseStatus={pauseStatus} canPause={canPause} power={power} timeLeft={timeLeft} />
        )}
        {marked.count > 0 && !isPrivate && (
          <button
            type="button"
            className="title-bar-marked"
            title={`Delete ${plural(marked.count, 'marked video')} (${formatSize(marked.size)})… (Ctrl+Backspace)`}
            aria-label={`Delete ${plural(marked.count, 'marked video')}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void runAppCommand('Actions > Delete Marked Videos')}
          >
            <Trash2 size={13} aria-hidden="true" />
            {marked.count.toLocaleString()}
            <span className="title-bar-marked-detail"> marked · {formatSize(marked.size)}</span>
          </button>
        )}
        {!isPrivate && (
          <button
            type="button"
            className="title-bar-icon-button"
            title="Find a command, folder or video (Ctrl+K)"
            aria-label="Quick open"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onOpenCommandPalette}
          >
            <Search size={14} />
          </button>
        )}
      </div>
    </header>
  );
}
