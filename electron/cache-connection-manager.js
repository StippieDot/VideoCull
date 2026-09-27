const os = require('node:os');

const PRIORITY = {
  background: 0,
  foreground: 1,
  interactive: 2,
};

function connectionLimitsForMemory(totalBytes = os.totalmem()) {
  const gib = totalBytes / (1024 ** 3);
  if (gib <= 8) return { warmTarget: 128, hardIdleCap: 256, globalCap: 512 };
  if (gib <= 16) return { warmTarget: 256, hardIdleCap: 512, globalCap: 1024 };
  return { warmTarget: 512, hardIdleCap: 1024, globalCap: 2048 };
}

function createCacheConnectionManager({
  limits = connectionLimitsForMemory(),
  inactivityMs = 5 * 60 * 1000,
  trimIntervalMs = 10 * 1000,
  trimBatchSize = 32,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onOpen = () => {},
  onReuse = () => {},
  onClose = () => {},
} = {}) {
  const entries = new Map();
  const idle = new Map();
  const waiters = [];
  let waiterSequence = 0;
  let trimTimer = null;
  let lastActivityAt = now();
  const counters = { opened: 0, reused: 0, evicted: 0, trimmed: 0 };

  function clearScheduledTrim() {
    if (trimTimer === null) return;
    clearTimer(trimTimer);
    trimTimer = null;
  }

  function scheduleTrim(delay = inactivityMs) {
    clearScheduledTrim();
    if (idle.size <= limits.warmTarget) return;
    trimTimer = setTimer(runScheduledTrim, delay);
    trimTimer?.unref?.();
  }

  function recordActivity() {
    lastActivityAt = now();
    scheduleTrim();
  }

  function closeEntry(key, reason) {
    const entry = entries.get(key);
    if (!entry) return false;
    idle.delete(key);
    entries.delete(key);
    try { entry.db.close(); } catch { /* best effort during cleanup */ }
    if (reason === 'hard-cap' || reason === 'global-cap') counters.evicted += 1;
    if (reason === 'idle-trim') counters.trimmed += 1;
    onClose(key, reason);
    return true;
  }

  function closeOldestIdle(reason) {
    const oldest = idle.keys().next();
    if (oldest.done) return false;
    return closeEntry(oldest.value, reason);
  }

  function enforceHardIdleCap() {
    while (idle.size > limits.hardIdleCap) closeOldestIdle('hard-cap');
  }

  function runScheduledTrim() {
    trimTimer = null;
    const quietFor = now() - lastActivityAt;
    if (quietFor < inactivityMs) {
      scheduleTrim(inactivityMs - quietFor);
      return;
    }
    for (let i = 0; i < trimBatchSize && idle.size > limits.warmTarget; i++) {
      closeOldestIdle('idle-trim');
    }
    if (idle.size > limits.warmTarget) scheduleTrim(trimIntervalMs);
  }

  function takeNextWaiter() {
    if (waiters.length === 0) return null;
    let bestIndex = 0;
    for (let i = 1; i < waiters.length; i++) {
      const best = waiters[bestIndex];
      const candidate = waiters[i];
      if (candidate.priority > best.priority || (
        candidate.priority === best.priority && candidate.sequence < best.sequence
      )) bestIndex = i;
    }
    return waiters.splice(bestIndex, 1)[0];
  }

  function acquireNow(key, opener) {
    const existing = entries.get(key);
    if (existing) {
      idle.delete(key);
      existing.leases += 1;
      counters.reused += 1;
      onReuse(key);
      return existing.db;
    }

    while (entries.size >= limits.globalCap && idle.size > 0) {
      closeOldestIdle('global-cap');
    }
    if (entries.size >= limits.globalCap) return null;

    const db = opener();
    entries.set(key, { db, leases: 1 });
    counters.opened += 1;
    onOpen(key);
    return db;
  }

  function drainWaiters() {
    while (waiters.length > 0) {
      const waiter = takeNextWaiter();
      try {
        const db = acquireNow(waiter.key, waiter.opener);
        if (!db) {
          waiters.push(waiter);
          return;
        }
        waiter.resolve(db);
      } catch (error) {
        waiter.reject(error);
      }
    }
  }

  function acquire(key, opener, priority = 'foreground') {
    recordActivity();
    try {
      const db = acquireNow(key, opener);
      if (db) return Promise.resolve(db);
    } catch (error) {
      return Promise.reject(error);
    }
    return new Promise((resolve, reject) => {
      waiters.push({
        key,
        opener,
        priority: PRIORITY[priority] ?? PRIORITY.foreground,
        sequence: waiterSequence++,
        resolve,
        reject,
      });
    });
  }

  function openUnleased(key, opener) {
    recordActivity();
    const existing = entries.get(key);
    if (existing) return existing.db;
    while (entries.size >= limits.globalCap && idle.size > 0) closeOldestIdle('global-cap');
    if (entries.size >= limits.globalCap) throw new Error('Cache database connection limit reached');
    const db = opener();
    entries.set(key, { db, leases: 0 });
    idle.set(key, true);
    counters.opened += 1;
    onOpen(key);
    enforceHardIdleCap();
    scheduleTrim();
    return db;
  }

  function release(key) {
    recordActivity();
    const entry = entries.get(key);
    if (!entry || entry.leases === 0) return false;
    entry.leases -= 1;
    if (entry.leases === 0) {
      idle.delete(key);
      idle.set(key, true);
      enforceHardIdleCap();
      scheduleTrim();
    }
    drainWaiters();
    return entry.leases === 0;
  }

  function close(key, { force = false } = {}) {
    const entry = entries.get(key);
    if (!entry || (!force && entry.leases > 0)) return false;
    const closed = closeEntry(key, force ? 'forced' : 'explicit');
    drainWaiters();
    return closed;
  }

  function closeAll(reason = 'Cache database manager closed') {
    clearScheduledTrim();
    while (waiters.length > 0) takeNextWaiter().reject(new Error(reason));
    for (const key of Array.from(entries.keys())) closeEntry(key, 'shutdown');
  }

  function getStats() {
    let activeConnections = 0;
    let activeLeases = 0;
    for (const entry of entries.values()) {
      activeLeases += entry.leases;
      if (entry.leases > 0) activeConnections += 1;
    }
    return {
      ...counters,
      limits: { ...limits },
      totalConnections: entries.size,
      activeConnections,
      activeLeases,
      idleConnections: idle.size,
      waitingAcquisitions: waiters.length,
    };
  }

  return {
    acquire,
    release,
    openUnleased,
    close,
    closeAll,
    getStats,
    runScheduledTrim,
  };
}

module.exports = { connectionLimitsForMemory, createCacheConnectionManager };
