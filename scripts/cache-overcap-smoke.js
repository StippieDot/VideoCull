const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

if (!process.versions.electron) {
  const result = spawnSync(require('electron'), [__filename], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

const log = require('../electron/logger');
log.transports.console.level = false;
log.transports.file.level = false;
const { createCacheService } = require('../electron/cache-service');

async function main() {
  const databaseCount = 2000;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'videocull-overcap-'));
  const libraryRoot = path.join(tempRoot, 'library');
  const cacheRoot = path.join(tempRoot, 'cache');
  const cacheOptions = { mode: 'centralised', centralCachePath: cacheRoot };
  const service = createCacheService();
  let maxEventLoopDelayMs = 0;
  let lastTick = performance.now();
  const heartbeat = setInterval(() => {
    const now = performance.now();
    maxEventLoopDelayMs = Math.max(maxEventLoopDelayMs, now - lastTick - 10);
    lastTick = now;
  }, 10);
  let stats;

  try {
    for (let index = 0; index < databaseCount; index += 1) {
      const folderPath = path.join(libraryRoot, `folder-${String(index).padStart(4, '0')}`);
      await service.saveVideos(folderPath, cacheOptions, [{
        id: `stress-${String(index).padStart(4, '0')}`,
        filename: 'video.mp4',
        path: path.join(folderPath, 'video.mp4'),
        sizeBytes: index + 1,
        date: index + 1,
        status: 'pending',
        rating: 0,
        favorite: false,
        compatible: true,
        bookmarks: [],
        thumbnails: [],
      }], { atomic: true, atomicLimit: 1 });
    }

    stats = await service.getStats();
    assert.equal(fs.readdirSync(cacheRoot).filter((name) => name.endsWith('.db')).length, databaseCount);
    assert.ok(stats.totalConnections <= stats.limits.hardIdleCap, JSON.stringify(stats));
    assert.ok(stats.totalConnections <= stats.limits.globalCap, JSON.stringify(stats));
    assert.ok(stats.evicted > 0, JSON.stringify(stats));

    const firstFolder = path.join(libraryRoot, 'folder-0000');
    const [reopened] = await service.loadVideos(firstFolder, cacheOptions);
    assert.equal(reopened.id, 'stress-0000');
    assert.equal(reopened.sizeBytes, 1);
    assert.ok((await service.getStats()).opened > databaseCount, 'Evicted database was not reopened.');
    assert.ok(maxEventLoopDelayMs < 250, `Main event loop stalled for ${maxEventLoopDelayMs.toFixed(1)}ms.`);
  } finally {
    clearInterval(heartbeat);
    await service.shutdown();
    fs.rmSync(tempRoot, { recursive: true, force: true });
    assert.equal(fs.existsSync(tempRoot), false, 'Stress fixture remained locked after shutdown.');
  }

  console.log(JSON.stringify({ databaseCount, maxEventLoopDelayMs, stats }, null, 2));
}

main().catch((error) => {
  console.error('[cache-overcap-smoke] FAILED', error);
  process.exitCode = 1;
});
