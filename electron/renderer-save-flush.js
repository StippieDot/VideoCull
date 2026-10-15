// @ts-check

/**
 * Asks the renderer to save the review decisions it is still retrying, so a quit does not drop them.
 * Must run before the cache producers are closed to new work, because the renderer's saves go through
 * the normal save handlers.
 * @param {{
 *   send: () => boolean,
 *   log: { warn: (message: string) => void },
 *   timeoutMs?: number,
 * }} options `send` delivers the request and returns false when the renderer cannot be reached.
 */
function createRendererSaveFlush({ send, log, timeoutMs = 2000 }) {
  /** @type {((unsaved: number) => void) | null} */
  let answer = null;

  async function request() {
    if (!send()) return;
    /** @type {Promise<number>} */
    const reply = new Promise((resolve) => { answer = resolve; });
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    /** @type {Promise<null>} */
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
    const unsaved = await Promise.race([reply, timeout]);
    clearTimeout(timer);
    answer = null;
    if (unsaved === null) {
      log.warn(`[shutdown] The renderer did not answer within ${timeoutMs} ms; pending review saves may be lost.`);
    } else if (unsaved > 0) {
      log.warn(`[shutdown] ${unsaved} review changes could not be saved before quitting.`);
    }
  }

  /** @param {number} unsaved */
  function report(unsaved) {
    answer?.(Number(unsaved) || 0);
  }

  return { request, report };
}

module.exports = { createRendererSaveFlush };
