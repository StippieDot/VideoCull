const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { scanDirectory } = require('./scanner');

test('scanDirectory throttles progress events but reports the final count', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'videocull-scan-'));

  try {
    for (let i = 0; i < 30; i++) {
      await fs.writeFile(path.join(tempRoot, `clip-${i}.mp4`), '');
    }
    await fs.writeFile(path.join(tempRoot, 'ignore.txt'), '');

    const progressEvents = [];
    const videos = await scanDirectory(tempRoot, false, (progress) => {
      progressEvents.push(progress);
    });

    assert.equal(videos.length, 30);
    assert.ok(progressEvents.length > 0);
    assert.ok(progressEvents.length < 30, 'progress should be chunked instead of emitted once per file');
    assert.equal(progressEvents.at(-1)?.found, 30);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

