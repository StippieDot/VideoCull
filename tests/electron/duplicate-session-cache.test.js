const assert = require('node:assert/strict');
const { test: nodeTest } = require('node:test');
const test = globalThis.test || nodeTest;
const { createDuplicateSessionCache, grayCacheLimitForMemory } = require('../../electron/duplicate-session-cache');

test('uses RAM-tiered gray sample limits', () => {
  const gib = 1024 ** 3;
  assert.equal(grayCacheLimitForMemory(8 * gib), 64 * 1024 * 1024);
  assert.equal(grayCacheLimitForMemory(16 * gib), 128 * 1024 * 1024);
  assert.equal(grayCacheLimitForMemory(32 * gib), 256 * 1024 * 1024);
});

test('reuses complete folder snapshots for the same fingerprint settings', () => {
  const session = createDuplicateSessionCache();
  session.beginFingerprintSettings('settings-a');
  session.rememberFolder({
    videoIds: ['a'],
    signatureRows: [{ id: 'a', file_signature_quick: 'quick' }],
    completeById: new Map([['a', true]]),
    failedIds: new Set(),
    mode: 'phash',
    comparisonRows: [{ video_id: 'a', sample_index: 0, phash_hex: 'abc' }],
  });

  assert.equal(session.hasFolder(['a'], 'phash'), true);
  assert.equal(session.folderSnapshot(['a'], 'phash').comparisonRows.length, 1);
  session.beginFingerprintSettings('settings-b');
  assert.equal(session.hasFolder(['a'], 'phash'), false);
});

test('evicts least-recently-used gray samples at the byte limit', () => {
  const session = createDuplicateSessionCache({ grayByteLimit: 4 });
  session.beginFingerprintSettings('settings-a');
  for (const videoId of ['a', 'b']) {
    session.rememberFolder({
      videoIds: [videoId],
      signatureRows: [{ id: videoId }],
      completeById: new Map([[videoId, true]]),
      failedIds: new Set(),
      mode: 'visual',
      comparisonRows: [{ video_id: videoId, sample_index: 0, gray_bytes: Buffer.alloc(3) }],
    });
  }

  assert.equal(session.hasFolder(['a'], 'visual'), false);
  assert.equal(session.hasFolder(['b'], 'visual'), true);
  assert.equal(session.getStats().grayBytes, 3);
});

test('invalidates derived duplicate data when a video file changes', () => {
  const session = createDuplicateSessionCache();
  session.beginFingerprintSettings('settings-a');
  session.rememberFolder({
    videoIds: ['a'],
    signatureRows: [{ id: 'a', size_bytes: 10, file_date: 100 }],
    completeById: new Map([['a', true]]),
    failedIds: new Set(),
    mode: 'phash',
    comparisonRows: [{ video_id: 'a', sample_index: 0, phash_hex: 'abc' }],
  });

  session.rememberSignatures([{ id: 'a', size_bytes: 10, file_date: 101 }]);

  assert.equal(session.hasFolder(['a'], 'phash'), false);
  assert.deepEqual(session.getStats(), {
    signatures: 1,
    fingerprintStates: 0,
    pHashVideos: 0,
    grayVideos: 0,
    grayBytes: 0,
    grayByteLimit: session.getStats().grayByteLimit,
  });
});
