const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const {
  scanDirectory,
  __test__,
} = require('../../electron/scanner');

test('statVideoEntries preserves input order and skips stat failures', async () => {
  const entries = [
    { entryName: 'a.mp4', fullPath: 'D:\\Media\\a.mp4' },
    { entryName: 'b.mp4', fullPath: 'D:\\Media\\b.mp4' },
    { entryName: 'c.mp4', fullPath: 'D:\\Media\\c.mp4' },
  ];

  const delaysByPath = new Map([
    ['D:\\Media\\a.mp4', 20],
    ['D:\\Media\\b.mp4', 5],
    ['D:\\Media\\c.mp4', 1],
  ]);
  const sizesByPath = new Map([
    ['D:\\Media\\a.mp4', 100],
    ['D:\\Media\\c.mp4', 300],
  ]);

  const results = await __test__.statVideoEntries(entries, async (fullPath) => {
    await new Promise((resolve) => setTimeout(resolve, delaysByPath.get(fullPath) ?? 0));
    const size = sizesByPath.get(fullPath);
    if (!size) throw new Error('missing');
    return { size, mtimeMs: size * 10 };
  });

  assert.deepEqual(
    results.map((video) => video?.filename ?? null),
    ['a.mp4', null, 'c.mp4']
  );
  assert.equal(results[0]?.sizeBytes, 100);
  assert.equal(results[2]?.sizeBytes, 300);
});

test('scanDirectory skips internal cache directories', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'videocull-scan-'));

  try {
    await fs.writeFile(path.join(tempRoot, 'visible.mp4'), '');
    await fs.mkdir(path.join(tempRoot, '.videocull'), { recursive: true });
    await fs.mkdir(path.join(tempRoot, '.video-cull-thumbs'), { recursive: true });
    await fs.writeFile(path.join(tempRoot, '.videocull', 'hidden.mp4'), '');
    await fs.writeFile(path.join(tempRoot, '.video-cull-thumbs', 'thumb-hidden.mp4'), '');

    const videos = await scanDirectory(tempRoot, true);

    assert.deepEqual(videos.map((video) => video.filename), ['visible.mp4']);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('scanDirectory respects includeSubfolders=false', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'videocull-scan-'));

  try {
    await fs.writeFile(path.join(tempRoot, 'root.mp4'), '');
    await fs.mkdir(path.join(tempRoot, 'nested'), { recursive: true });
    await fs.writeFile(path.join(tempRoot, 'nested', 'child.mp4'), '');

    const videos = await scanDirectory(tempRoot, false);

    assert.deepEqual(videos.map((video) => video.filename), ['root.mp4']);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
