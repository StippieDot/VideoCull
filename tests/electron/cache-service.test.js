const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { test: nodeTest } = require('node:test');
const test = globalThis.test || nodeTest;
const { createCacheService } = require('../../electron/cache-service');

const cacheOptions = { mode: 'centralised', defaultCentralRoot: 'D:\\Cache' };

class FakeWorker extends EventEmitter {
  static instances = [];

  constructor(workerPath) {
    super();
    this.workerPath = workerPath;
    this.messages = [];
    this.terminateCount = 0;
    FakeWorker.instances.push(this);
  }

  unref() {}

  postMessage(message) {
    this.messages.push(message);
  }

  async terminate() {
    this.terminateCount += 1;
  }
}

function createService(options = {}) {
  FakeWorker.instances = [];
  return createCacheService({ WorkerClass: FakeWorker, workerPath: 'cache-worker.js', ...options });
}

test('cache service sends high-level prioritized worker requests', async () => {
  const service = createService();
  const pending = service.updateReviewState('D:\\Videos', cacheOptions, [
    { id: 'a', changes: { status: 'keep' } },
  ]);
  const worker = FakeWorker.instances[0];
  const request = worker.messages[0];

  assert.equal(worker.workerPath, 'cache-worker.js');
  assert.equal(request.operation, 'updateReviewState');
  assert.equal(request.priority, 'interactive');
  assert.equal(request.args.folderPath, 'D:\\Videos');

  worker.emit('message', { id: request.id, result: true });
  assert.equal(await pending, true);
});

test('cache service restores worker error details', async () => {
  const service = createService();
  const pending = service.loadVideos('D:\\Videos', cacheOptions);
  const request = FakeWorker.instances[0].messages[0];
  FakeWorker.instances[0].emit('message', {
    id: request.id,
    error: { name: 'SqliteError', message: 'database failed', code: 'SQLITE_CORRUPT' },
  });

  await assert.rejects(pending, (error) => (
    error.name === 'SqliteError'
    && error.message === 'database failed'
    && error.code === 'SQLITE_CORRUPT'
  ));
});

test('worker errors reject every affected request and a later request uses a replacement', async () => {
  const service = createService();
  const first = service.loadVideos('D:\\One', cacheOptions);
  const second = service.loadVideos('D:\\Two', cacheOptions);
  const oldWorker = FakeWorker.instances[0];
  const firstRejected = assert.rejects(first, /worker crashed/);
  const secondRejected = assert.rejects(second, /worker crashed/);

  oldWorker.emit('error', new Error('worker crashed'));
  await Promise.all([firstRejected, secondRejected]);

  const replacementRequest = service.loadVideos('D:\\Three', cacheOptions);
  const replacement = FakeWorker.instances[1];
  const message = replacement.messages[0];
  replacement.emit('message', { id: message.id, result: ['ok'] });
  assert.deepEqual(await replacementRequest, ['ok']);
});

test('worker exits reject pending requests without rejecting replacement-worker requests', async () => {
  const service = createService();
  const pending = service.loadVideos('D:\\One', cacheOptions);
  const oldWorker = FakeWorker.instances[0];
  const rejected = assert.rejects(pending, /exited with code 9/);
  oldWorker.emit('exit', 9);
  await rejected;

  const replacementRequest = service.loadVideos('D:\\Two', cacheOptions);
  const replacement = FakeWorker.instances[1];
  const message = replacement.messages[0];
  oldWorker.emit('exit', 9);
  oldWorker.emit('message', { id: message.id, result: ['stale'] });
  replacement.emit('message', { id: message.id, result: ['fresh'] });
  assert.deepEqual(await replacementRequest, ['fresh']);
});

test('shutdown drains queued work, closes last, and rejects new requests', async () => {
  const service = createService();
  const background = service.saveMetadata('D:\\Videos', cacheOptions, [{ videoId: 'a' }], []);
  const worker = FakeWorker.instances[0];
  const shutdown = service.shutdown();

  assert.deepEqual(worker.messages.map((message) => [message.operation, message.priority]), [
    ['saveMetadata', 'background'],
    ['closeAll', 'background'],
  ]);
  worker.emit('message', { id: worker.messages[0].id, result: true });
  await background;
  worker.emit('message', { id: worker.messages[1].id, result: true });
  await shutdown;

  assert.equal(worker.terminateCount, 1);
  await assert.rejects(service.loadVideos('D:\\Videos', cacheOptions), /shutting down/);
});

test('shutdown after a worker failure is safe and replacement shutdown is clean', async () => {
  const service = createService();
  const failed = service.loadVideos('D:\\One', cacheOptions);
  const oldWorker = FakeWorker.instances[0];
  const rejected = assert.rejects(failed, /failed/);
  oldWorker.emit('error', new Error('failed'));
  await rejected;

  const later = service.loadVideos('D:\\Two', cacheOptions);
  const replacement = FakeWorker.instances[1];
  replacement.emit('message', { id: replacement.messages[0].id, result: [] });
  await later;
  const shutdown = service.shutdown();
  const close = replacement.messages[1];
  replacement.emit('message', { id: close.id, result: true });
  await shutdown;
  assert.equal(replacement.terminateCount, 1);
});

test('shutdown times out and terminates a failed or unresponsive worker', async () => {
  const service = createService({ shutdownTimeoutMs: 5 });
  service.loadVideos('D:\\Videos', cacheOptions).catch(() => {});
  const worker = FakeWorker.instances[0];
  await assert.rejects(service.shutdown(), /timed out/);
  assert.equal(worker.terminateCount, 1);
});

test('destructive folder operations drain older background work and block stale writes', async () => {
  const service = createService();
  const background = service.saveMetadata('D:\\Videos', cacheOptions, [{ videoId: 'a' }], []);
  const worker = FakeWorker.instances[0];
  const deletion = service.deleteDb('D:\\Videos', cacheOptions);

  assert.deepEqual(worker.messages.map((message) => [message.operation, message.priority]), [
    ['saveMetadata', 'background'],
    ['deleteDb', 'background'],
  ]);
  await assert.rejects(
    service.saveThumbnails('D:\\Videos', cacheOptions, [{ videoId: 'a' }]),
    /destructive transition/,
  );

  worker.emit('message', { id: worker.messages[0].id, result: true });
  await background;
  worker.emit('message', { id: worker.messages[1].id, result: true });
  await deletion;

  service.allowFolder('D:\\Videos', cacheOptions);
  const next = service.loadVideos('D:\\Videos', cacheOptions);
  worker.emit('message', { id: worker.messages[2].id, result: [] });
  assert.deepEqual(await next, []);
});

test('global transitions drain accepted work and reject new cache requests until complete', async () => {
  const service = createService();
  const background = service.saveMetadata('D:\\Videos', cacheOptions, [{ videoId: 'a' }], []);
  const worker = FakeWorker.instances[0];
  service.blockFolder('D:\\Videos', cacheOptions);
  const transition = service.beginTransition();

  assert.equal(worker.messages[1].operation, 'closeAll');
  assert.equal(worker.messages[1].priority, 'background');
  await assert.rejects(service.loadVideos('D:\\Videos', cacheOptions), /transition is in progress/);
  worker.emit('message', { id: worker.messages[0].id, result: true });
  await background;
  worker.emit('message', { id: worker.messages[1].id, result: true });
  await transition;
  service.allowFolder('D:\\Videos', cacheOptions);
  service.endTransition();

  await assert.rejects(service.loadVideos('D:\\Videos', cacheOptions), /destructive transition/);
  service.allowFolder('D:\\Videos', cacheOptions);

  const next = service.loadVideos('D:\\Videos', cacheOptions);
  worker.emit('message', { id: worker.messages[2].id, result: [] });
  assert.deepEqual(await next, []);
});

test('failed transition close restores normal cache requests', async () => {
  const service = createService();
  const initial = service.loadVideos('D:\\Videos', cacheOptions);
  const worker = FakeWorker.instances[0];
  worker.emit('message', { id: worker.messages[0].id, result: [] });
  await initial;

  const transition = service.beginTransition();
  const closeRequest = worker.messages[1];
  worker.emit('message', {
    id: closeRequest.id,
    error: { name: 'Error', message: 'close failed' },
  });
  await assert.rejects(transition, /close failed/);

  const next = service.loadVideos('D:\\Videos', cacheOptions);
  worker.emit('message', { id: worker.messages[2].id, result: ['ok'] });
  assert.deepEqual(await next, ['ok']);
});
