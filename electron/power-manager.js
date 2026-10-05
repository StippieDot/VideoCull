// @ts-check

/**
 * Keeps Windows from sleeping while VideoCull processes videos.
 *
 * Windows does not count background work as activity, so a long overnight run would otherwise stop
 * when the idle sleep timer expires. The blocker only prevents automatic idle sleep: choosing Sleep,
 * pressing the power button or closing a laptop lid still work.
 *
 * @param {{
 *   startBlocker: () => number,
 *   stopBlocker: (id: number) => void,
 *   isPaused: () => boolean,
 * }} deps
 */
function createPowerManager({ startBlocker, stopBlocker, isPaused }) {
  let activeWork = 0;
  let keepAwake = true;
  /** @type {number | null} */
  let blockerId = null;

  function updateBlocker() {
    const wanted = keepAwake && activeWork > 0 && !isPaused();
    if (wanted && blockerId === null) {
      blockerId = startBlocker();
    } else if (!wanted && blockerId !== null) {
      stopBlocker(blockerId);
      blockerId = null;
    }
  }

  /** @returns {() => void} ends this piece of work; calling it again does nothing */
  function beginWork() {
    activeWork += 1;
    updateBlocker();
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      activeWork -= 1;
      updateBlocker();
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

  return {
    beginWork,
    trackWork,
    setKeepAwake,
    /** Re-evaluates the blocker after processing is paused or resumed. */
    pauseChanged: updateBlocker,
    isKeepingAwake: () => blockerId !== null,
  };
}

module.exports = { createPowerManager };
