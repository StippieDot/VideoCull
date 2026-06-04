const assert = require('node:assert/strict');

const { __test } = require('../../electron/processor');

test('videos under 10 seconds only expect one thumbnail', () => {
  assert.equal(__test.expectedThumbnailCount(9.99, 6, 3), 1);
  assert.equal(__test.expectedThumbnailCount(10, 6, 3), 6);
});

test('videos under 10 seconds still generate the normal thumbnail count when capture range is valid', () => {
  assert.equal(__test.calculateTimestamps(9, 6, 3).length, 6);
});

test('videos shorter than the intro skip still generate one midpoint timestamp', () => {
  assert.deepEqual(__test.calculateTimestamps(2, 6, 3), [1]);
});
