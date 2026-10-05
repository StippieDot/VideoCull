// @ts-check

/** @typedef {'none' | 'sleep' | 'shutdown'} FinishAction */
/**
 * @typedef {{
 *   processing: boolean,
 *   finishAction: FinishAction,
 *   countdown: { action: 'sleep' | 'shutdown', endsAt: number } | null,
 * }} PowerState
 */

const FINISH_ACTIONS = new Set(['none', 'sleep', 'shutdown']);
// The renderer starts the next stage (metadata, thumbnails, duplicates) a moment after the
// previous one ends; idle must last this long before processing counts as finished.
const IDLE_GRACE_MS = 15_000;
const COUNTDOWN_MS = 60_000;

/**
 * Keeps Windows from sleeping while VideoCull processes videos, and optionally puts the PC to sleep
 * or shuts it down once processing has finished.
 *
 * Windows does not count background work as activity, so a long overnight run would otherwise stop
 * when the idle sleep timer expires. The blocker only prevents automatic idle sleep: choosing Sleep,
 * pressing the power button or closing a laptop lid still work.
 *
 * The finish action can only be chosen while processing runs, applies to that run only, and resets
 * to 'none' when it fires or is cancelled. It is never stored, so a later small rescan can never
 * trigger it.
 *
 * @param {{
 *   startBlocker: () => number,
 *   stopBlocker: (id: number) => void,
 *   isPaused: () => boolean,
 *   performFinishAction?: (action: 'sleep' | 'shutdown') => void,
 *   onStateChange?: (state: PowerState) => void,
 *   setTimer?: (callback: () => void, ms: number) => unknown,
 *   clearTimer?: (timer: any) => void,
 *   now?: () => number,
 *   idleGraceMs?: number,
 *   countdownMs?: number,
 * }} deps
 */
function createPowerManager({
  startBlocker,
  stopBlocker,
  isPaused,
  performFinishAction = () => {},
  onStateChange = () => {},
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  now = Date.now,
  idleGraceMs = IDLE_GRACE_MS,
  countdownMs = COUNTDOWN_MS,
}) {
  let activeWork = 0;
  let keepAwake = true;
  /** @type {number | null} */
  let blockerId = null;
  /** @type {FinishAction} */
  let finishAction = 'none';
  /** @type {unknown} */
  let graceTimer = null;
  /** @type {{ action: 'sleep' | 'shutdown', endsAt: number, timer: unknown } | null} */
  let countdown = null;

  /** @returns {PowerState} */
  function getState() {
    return {
      processing: activeWork > 0,
      finishAction,
      countdown: countdown ? { action: countdown.action, endsAt: countdown.endsAt } : null,
    };
  }

  function emit() {
    onStateChange(getState());
  }

  function updateBlocker() {
    const wanted = keepAwake && activeWork > 0 && !isPaused();
    if (wanted && blockerId === null) {
      blockerId = startBlocker();
    } else if (!wanted && blockerId !== null) {
      stopBlocker(blockerId);
      blockerId = null;
    }
  }

  /** Stops a pending finish without disarming it. */
  function clearPendingFinish() {
    if (graceTimer !== null) {
      clearTimer(graceTimer);
      graceTimer = null;
    }
    if (countdown) {
      clearTimer(countdown.timer);
      countdown = null;
    }
  }

  function fire() {
    if (!countdown) return;
    const { action } = countdown;
    countdown = null;
    finishAction = 'none';
    emit();
    performFinishAction(action);
  }

  function startCountdown() {
    graceTimer = null;
    if (activeWork > 0 || finishAction === 'none') return;
    countdown = { action: finishAction, endsAt: now() + countdownMs, timer: setTimer(fire, countdownMs) };
    emit();
  }

  /** @returns {() => void} ends this piece of work; calling it again does nothing */
  function beginWork() {
    activeWork += 1;
    const hadCountdown = countdown !== null;
    // Work that starts during the grace period or the countdown postpones the finish action.
    clearPendingFinish();
    updateBlocker();
    if (activeWork === 1 || hadCountdown) emit();
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      activeWork -= 1;
      updateBlocker();
      if (activeWork > 0) return;
      if (finishAction !== 'none') graceTimer = setTimer(startCountdown, idleGraceMs);
      emit();
    };
  }

  /**
   * @template T
   * @param {() => T | Promise<T>} operation
   * @returns {Promise<T>}
   */
  function trackWork(operation) {
    const end = beginWork();
    return Promise.resolve().then(operation).finally(end);
  }

  /** @param {boolean} enabled */
  function setKeepAwake(enabled) {
    keepAwake = enabled;
    updateBlocker();
  }

  /**
   * @param {unknown} action
   * @returns {PowerState}
   */
  function setFinishAction(action) {
    if (typeof action !== 'string' || !FINISH_ACTIONS.has(action)) return getState();
    if (action === 'none') return cancelFinishAction();
    // Arming outside a run would make the next, possibly tiny, run trigger it.
    if (activeWork === 0) return getState();
    finishAction = /** @type {FinishAction} */ (action);
    emit();
    return getState();
  }

  /** Disarms the finish action, including a running countdown. */
  function cancelFinishAction() {
    clearPendingFinish();
    finishAction = 'none';
    emit();
    return getState();
  }

  return {
    beginWork,
    trackWork,
    setKeepAwake,
    setFinishAction,
    cancelFinishAction,
    getState,
    /** Re-evaluates the blocker after processing is paused or resumed. */
    pauseChanged: updateBlocker,
    isKeepingAwake: () => blockerId !== null,
  };
}

module.exports = { createPowerManager };
