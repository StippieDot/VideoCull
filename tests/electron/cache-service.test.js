const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { test: nodeTest } = require('node:test');
const test = globalThis.test || nodeTest;
const { createCacheService } = require('../../electron/cache-service');

class FakeWorker extends EventEmitter {
  static last = null;

  constructor(workerPath) {
    super();
    this.workerPath = workerPath;
    this.messages = [];
    FakeWorker.last = this;
  }

  unref() {}

  postMessage(message) {
    this.messages.push(message);
  }
}

test('cache service sends high-level prioritized worker requests', async () => {
  const service = createCacheService({ WorkerClass: FakeWorker, workerPath: 'cache-worker.js' });
  const pending = service.updateReviewState('D:\\Videos', { mode: 'centralised' }, [
    { id: 'a', changes: { status: 'keep' } },
  ]);
  const worker = FakeWorker.last;
  const request = worker.messages[0];

  assert.equal(worker.workerPath, 'cache-worker.js');
  assert.equal(request.operation, 'updateReviewState');
  assert.equal(request.priority, 'interactive');
  assert.equal(request.args.folderPath, 'D:\\Videos');

  worker.emit('message', { id: request.id, result: true });
  assert.equal(await pending, true);
});

test('cache service restores worker error details', async () => {
  const service = createCacheService({ WorkerClass: FakeWorker });
  const pending = service.loadVideos('D:\\Videos', {});
  const request = FakeWorker.last.messages[0];
  FakeWorker.last.emit('message', {
    id: request.id,
    error: { name: 'SqliteError', message: 'database failed', code: 'SQLITE_CORRUPT' },
  });

  await assert.rejects(pending, (error) => (
    error.name === 'SqliteError'
    && error.message === 'database failed'
    && error.code === 'SQLITE_CORRUPT'
  ));
});
