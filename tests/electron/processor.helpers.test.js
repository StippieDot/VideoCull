const assert = require('node:assert/strict');

const { __test } = require('../../electron/processor');

test('parseFpsRational handles valid and invalid ffprobe values', () => {
  assert.equal(__test.parseFpsRational('30000/1001'), 29.97);
  assert.equal(__test.parseFpsRational('25/1'), 25);
  assert.equal(__test.parseFpsRational('0/0'), null);
  assert.equal(__test.parseFpsRational('broken'), null);
  assert.equal(__test.parseFpsRational(null), null);
});

test('parseBitrate only returns positive finite integer values', () => {
  assert.equal(__test.parseBitrate('1234.8'), 1235);
  assert.equal(__test.parseBitrate(0), null);
  assert.equal(__test.parseBitrate(-50), null);
  assert.equal(__test.parseBitrate('abc'), null);
});

test('toFfmpegInputPath preserves short paths and prefixes long windows paths', () => {
  const shortPath = 'D:\\videos\\clip.mp4';
  assert.equal(__test.toFfmpegInputPath(shortPath), shortPath);

  const longLeaf = 'a'.repeat(260);
  const longPath = `D:\\videos\\${longLeaf}.mp4`;
  assert.ok(__test.toFfmpegInputPath(longPath).startsWith('\\\\?\\'));

  const alreadyPrefixed = '\\\\?\\D:\\videos\\clip.mp4';
  assert.equal(__test.toFfmpegInputPath(alreadyPrefixed), alreadyPrefixed);
});

test('gpu cooldown helpers honor hardware acceleration and bounds', () => {
  assert.equal(__test.getGpuCooldownMs({ hardwareAccel: false }), 0);
  assert.equal(__test.getGpuCooldownMs({ hardwareAccel: true }), 1250);
  assert.equal(__test.getGpuCooldownMs({ hardwareAccel: true, gpuCooldownMs: 20000 }), 10000);
  assert.equal(__test.getGpuCooldownMs({ hardwareAccel: true, gpuCooldownMs: 500 }), 500);

  assert.equal(__test.getGpuCooldownBatchSize({ hardwareAccel: false }, 4), 0);
  assert.equal(__test.getGpuCooldownBatchSize({ hardwareAccel: true, gpuCooldownBatchSize: 2 }, 4), 4);
  assert.equal(__test.getGpuCooldownBatchSize({ hardwareAccel: true, gpuCooldownBatchSize: 9999 }, 4), 2000);
  assert.equal(__test.getGpuCooldownBatchSize({ hardwareAccel: true, thumbsPerVideo: 12 }, 8), 100);
});

test('createQueueCursor returns items sequentially and then null', () => {
  const next = __test.createQueueCursor(['a', 'b']);
  assert.equal(next(), 'a');
  assert.equal(next(), 'b');
  assert.equal(next(), null);
  assert.equal(next(), null);
});
