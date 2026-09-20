class ProcessingPauseController {
  constructor() {
    this.pauseRequested = false;
    this.activeOperations = 0;
    this.waiters = new Set();
    this.listeners = new Set();
    this.workerHandles = new Set();
    this.lastStatus = 'running';
  }

  getState() {
    const workersPaused = Array.from(this.workerHandles).every((handle) => handle.quiescent);
    const status = !this.pauseRequested
      ? 'running'
      : this.activeOperations === 0 && workersPaused
        ? 'paused'
        : 'pausing';
    return { status };
  }

  emitIfChanged() {
    const state = this.getState();
    if (state.status === this.lastStatus) return;
    this.lastStatus = state.status;
    for (const listener of this.listeners) listener(state);
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  pause() {
    this.pauseRequested = true;
    for (const handle of this.workerHandles) {
      handle.quiescent = false;
      Atomics.store(handle.view, 0, 1);
    }
    this.emitIfChanged();
    return this.getState();
  }

  resume() {
    this.pauseRequested = false;
    for (const handle of this.workerHandles) {
      handle.quiescent = false;
      Atomics.store(handle.view, 0, 0);
      Atomics.notify(handle.view, 0);
    }
    this.wake();
    this.emitIfChanged();
    return this.getState();
  }

  wake() {
    const waiters = Array.from(this.waiters);
    this.waiters.clear();
    for (const resolve of waiters) resolve();
  }

  async checkpoint(isCancelled = () => false, createCancelledError = () => new Error('Cancelled')) {
    while (this.pauseRequested) {
      if (isCancelled()) throw createCancelledError();
      await new Promise((resolve) => this.waiters.add(resolve));
    }
    if (isCancelled()) throw createCancelledError();
  }

  beginActivity() {
    this.activeOperations += 1;
    this.emitIfChanged();
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      this.activeOperations = Math.max(0, this.activeOperations - 1);
      this.emitIfChanged();
    };
  }

  createWorkerPauseHandle() {
    const buffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
    let released = false;
    const handle = {
      buffer,
      view: new Int32Array(buffer),
      quiescent: false,
      markPaused: () => {
        handle.quiescent = true;
        this.emitIfChanged();
      },
      release: () => {
        if (released) return;
        released = true;
        Atomics.store(handle.view, 0, 0);
        Atomics.notify(handle.view, 0);
        this.workerHandles.delete(handle);
        this.emitIfChanged();
      },
    };
    if (this.pauseRequested) Atomics.store(handle.view, 0, 1);
    this.workerHandles.add(handle);
    this.emitIfChanged();
    return handle;
  }
}

const processingPause = new ProcessingPauseController();

module.exports = {
  ProcessingPauseController,
  processingPause,
};
