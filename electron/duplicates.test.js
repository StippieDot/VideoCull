const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const cache = require('./cache');
const { DuplicateCancelledError, __test__ } = require('./duplicates');
const { normalizeDuplicateSettings } = require('./duplicate-utils');

function video(id) {
  return {
    id,
    filename: `${id}.mp4`,
    path: `P:\\${id}.mp4`,
    width: 1920,
    height: 1080,
    videoBitrate: 2000000,
    durationSecs: 100,
    fps: 30,
    sizeBytes: 1000,
  };
}

test('daisy-chain validation splits weak connected duplicate groups', () => {
  const videos = ['a', 'b', 'c', 'd', 'e'].map(video);
  const videosById = new Map(videos.map((item) => [item.id, item]));
  const settings = normalizeDuplicateSettings({ finalSimilarityThreshold: 95, comparisonMode: 'phash' });
  const chainPairs = [
    { aId: 'a', bId: 'b', similarity: 96, matchType: 'phash' },
    { aId: 'b', bId: 'c', similarity: 96, matchType: 'phash' },
    { aId: 'c', bId: 'd', similarity: 96, matchType: 'phash' },
    { aId: 'd', bId: 'e', similarity: 96, matchType: 'phash' },
    { aId: 'b', bId: 'd', similarity: 96, matchType: 'phash' },
  ];

  const groups = __test__.buildGroups([], chainPairs, videosById, settings);
  const groupedIds = groups.map((group) => group.videoIds.toSorted());

  assert.equal(groups.length, 2);
  assert.deepEqual(groupedIds, [['a', 'b'], ['c', 'd']]);
});

test('daisy-chain cleanup can drop weak members after similarity is recomputed', () => {
  const videos = ['a', 'b', 'c'].map(video);
  const videosById = new Map(videos.map((item) => [item.id, item]));
  const settings = normalizeDuplicateSettings({ finalSimilarityThreshold: 95, comparisonMode: 'phash' });
  const matchedPairs = [
    { aId: 'a', bId: 'b', similarity: 96, matchType: 'phash' },
    { aId: 'a', bId: 'c', similarity: 96, matchType: 'phash' },
    { aId: 'b', bId: 'c', similarity: 96, matchType: 'phash' },
  ];

  const groups = __test__.buildGroups([], matchedPairs, videosById, settings, {
    revalidateSimilarity(aId, bId) {
      const key = [aId, bId].toSorted().join('|');
      if (key === 'a|b') return 96;
      return 80;
    },
  });

  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].videoIds.toSorted(), ['a', 'b']);
});

test('daisy-chain cleanup uses recomputed similarity for retained group scores', () => {
  const videos = ['a', 'b', 'c'].map(video);
  const videosById = new Map(videos.map((item) => [item.id, item]));
  const settings = normalizeDuplicateSettings({ finalSimilarityThreshold: 95, comparisonMode: 'phash' });
  const matchedPairs = [
    { aId: 'a', bId: 'b', similarity: 96, matchType: 'phash' },
    { aId: 'a', bId: 'c', similarity: 96, matchType: 'phash' },
    { aId: 'b', bId: 'c', similarity: 96, matchType: 'phash' },
  ];
  const revalidateSimilarity = (aId, bId) => {
    const key = [aId, bId].toSorted().join('|');
    return key === 'b|c' ? null : 96;
  };
  revalidateSimilarity.score = (aId, bId) => {
    const key = [aId, bId].toSorted().join('|');
    return key === 'b|c' ? 94 : 96;
  };

  const groups = __test__.buildGroups([], matchedPairs, videosById, settings, { revalidateSimilarity });

  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].videoIds.toSorted(), ['a', 'b', 'c']);
  assert.equal(groups[0].similarity, 95.3);
});

test('multi-frame extraction args reuse one ffmpeg command for all timestamps', () => {
  const args = __test__.buildGrayFramesExtractionArgs('D:\\videos\\clip.mp4', [10, 25.5, 90]);

  assert.equal(args.filter((value) => value === '-i').length, 3);
  assert.equal(args.filter((value) => value === '-ss').length, 3);
  assert.ok(args.includes('-threads'));
  assert.ok(args.includes('1'));
  assert.ok(args.includes('-filter_complex'));
  assert.ok(args.includes('pipe:1'));
  assert.ok(args.some((value) => typeof value === 'string' && value.includes('concat=n=3:v=1:a=0[out]')));
});

test('multi-frame extraction args can disable ffmpeg thread limiting', () => {
  const args = __test__.buildGrayFramesExtractionArgs('D:\\videos\\clip.mp4', [10, 25.5, 90], {
    cpuThreadsLimited: false,
  });

  assert.equal(args.includes('-threads'), false);
});

test('fingerprint building skips flipped hashes unless compareFlipped is enabled', () => {
  const grayFrame = Buffer.alloc(32 * 32, 128);
  const timestamps = [12.5];

  const withoutFlipped = __test__.buildFingerprintsFromGrayFrames([grayFrame], timestamps, {
    compareFlipped: false,
  });
  assert.equal(withoutFlipped[0].flippedPHashHex, null);

  const withFlipped = __test__.buildFingerprintsFromGrayFrames([grayFrame], timestamps, {
    compareFlipped: true,
  });
  assert.equal(typeof withFlipped[0].flippedPHashHex, 'string');
  assert.ok(withFlipped[0].flippedPHashHex.length > 0);
});

test('exact duplicate pass stops before cache writes after cancellation', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'videocull-duplicates-'));
  const folder = path.join(tempRoot, 'videos');
  const fileBytes = Buffer.alloc(4096, 7);
  await fs.mkdir(folder, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(folder, 'a.mp4'), fileBytes),
    fs.writeFile(path.join(folder, 'b.mp4'), fileBytes),
  ]);

  const videos = [
    {
      id: 'a',
      filename: 'a.mp4',
      path: path.join(folder, 'a.mp4'),
      sizeBytes: fileBytes.length,
      durationSecs: 10,
    },
    {
      id: 'b',
      filename: 'b.mp4',
      path: path.join(folder, 'b.mp4'),
      sizeBytes: fileBytes.length,
      durationSecs: 10,
    },
  ];

  const originalLoadSignatureRows = cache.loadSignatureRows;
  const originalUpdateVideoSignatures = cache.updateVideoSignatures;
  let writeAttempts = 0;
  cache.loadSignatureRows = () => [];
  cache.updateVideoSignatures = () => {
    writeAttempts++;
  };

  const run = { cancelled: false };
  setImmediate(() => {
    run.cancelled = true;
  });

  try {
    await assert.rejects(
      __test__.findExactGroups(videos, new Map([[folder, {}]]), run, () => {}),
      (err) => err instanceof DuplicateCancelledError,
    );
    assert.equal(writeAttempts, 0);
  } finally {
    cache.loadSignatureRows = originalLoadSignatureRows;
    cache.updateVideoSignatures = originalUpdateVideoSignatures;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
