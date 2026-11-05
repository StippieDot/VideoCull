const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  scanDirectory,
  __test__,
} = require('../../electron/scanner');

test('skips source and dependency folders but keeps ordinary folders', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'videocull-scan-'));

  try {
    for (const folder of ['.git', 'node_modules', 'Trips']) {
      await fs.mkdir(path.join(tempRoot, folder));
      await fs.writeFile(path.join(tempRoot, folder, `${folder}.mp4`), '');
    }

    const videos = await scanDirectory(tempRoot, true);

    assert.deepEqual(videos.map((video) => video.filename), ['Trips.mp4']);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('skips .app bundles on macOS only, where they are applications rather than folders', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'videocull-scan-'));
  const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform');

  try {
    await fs.mkdir(path.join(tempRoot, 'Holiday.app'));
    await fs.writeFile(path.join(tempRoot, 'Holiday.app', 'clip.mp4'), '');

    Object.defineProperty(process, 'platform', { ...realPlatform, value: 'darwin' });
    assert.deepEqual(await scanDirectory(tempRoot, true), []);

    Object.defineProperty(process, 'platform', { ...realPlatform, value: 'win32' });
    assert.deepEqual((await scanDirectory(tempRoot, true)).map((video) => video.filename), ['clip.mp4']);
  } finally {
    Object.defineProperty(process, 'platform', realPlatform);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('skips ignored directories reached through followed links', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'videocull-scan-'));
  const targetDir = await fs.mkdtemp(path.join(os.tmpdir(), 'videocull-target-'));

  try {
    await fs.writeFile(path.join(targetDir, 'hidden.mp4'), '');
    const linkPath = path.join(tempRoot, 'node_modules');
    try {
      await fs.symlink(targetDir, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      t.skip(`directory links are unavailable: ${error.message}`);
      return;
    }

    const result = await scanDirectory(tempRoot, true, undefined, { followLinks: true, includeVisitedDirs: true });

    assert.deepEqual(result.videos, []);
    assert.deepEqual(result.followedLinks, []);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
    await fs.rm(targetDir, { recursive: true, force: true });
  }
});

test('leaves out TypeScript source files but keeps transport-stream video and empty files', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'videocull-scan-'));

  try {
    const packet = Buffer.alloc(188, 0xff);
    packet.set([0x47, 0x40, 0x00, 0x10]);
    await fs.writeFile(path.join(tempRoot, 'source.ts'), 'export const héllo = "wörld";\n'.repeat(400));
    await fs.writeFile(path.join(tempRoot, 'module.mts'), 'export {};\n');
    await fs.writeFile(path.join(tempRoot, 'recording.ts'), Buffer.concat([packet, packet, packet]));
    await fs.writeFile(path.join(tempRoot, 'camera.MTS'), Buffer.concat([Buffer.alloc(4), packet]));
    await fs.writeFile(path.join(tempRoot, 'empty.ts'), '');
    await fs.writeFile(path.join(tempRoot, 'notes.mp4'), 'not checked: only .ts and .mts share a source extension');

    const result = await scanDirectory(tempRoot, true, undefined, { includeVisitedDirs: true });

    assert.deepEqual(
      result.videos.map((video) => video.filename).sort(),
      ['camera.MTS', 'empty.ts', 'notes.mp4', 'recording.ts'],
    );
    assert.deepEqual(result.summary.skippedFileSamples, [], 'a source file is not reported as a read failure');
    assert.deepEqual(result.incompleteDirs, [], 'a source file does not stop missing videos being pruned');
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('a transport-stream file that cannot be opened stays in the list for the probe to report', async () => {
  assert.equal(await __test__.isTypeScriptSource(path.join(os.tmpdir(), 'videocull-missing-file.ts')), false);
});

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
    return { size, mtimeMs: size * 10, birthtimeMs: size * 5, dev: 1, ino: size + 1 };
  });

  assert.deepEqual(
    results.map((video) => video?.filename ?? null),
    ['a.mp4', null, 'c.mp4']
  );
  assert.equal(results[0]?.sizeBytes, 100);
  assert.equal(results[2]?.sizeBytes, 300);
  assert.deepEqual(results[0]?.fileIdentity, {
    sizeBytes: 100,
    mtimeMs: 1000,
    birthtimeMs: 500,
    dev: '1',
    ino: '101',
  });
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

test('scanDirectory can return visited directories for safe empty-folder pruning', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'videocull-scan-'));

  try {
    const nested = path.join(tempRoot, 'nested');
    const empty = path.join(tempRoot, 'empty');
    await fs.mkdir(nested, { recursive: true });
    await fs.mkdir(empty, { recursive: true });
    await fs.writeFile(path.join(nested, 'child.mp4'), '');

    const result = await scanDirectory(tempRoot, true, undefined, { includeVisitedDirs: true });

    assert.deepEqual(result.videos.map((video) => video.filename), ['child.mp4']);
    assert.deepEqual(
      result.visitedDirs.sort(),
      [tempRoot, empty, nested].sort()
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('scanDirectory summarizes inaccessible directories without failing the scan', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'videocull-scan-'));

  try {
    const blocked = path.join(tempRoot, 'blocked');
    await fs.mkdir(blocked, { recursive: true });
    await fs.writeFile(path.join(tempRoot, 'root.mp4'), '');

    const result = await scanDirectory(tempRoot, true, undefined, {
      includeVisitedDirs: true,
      readdir: async (dir, opts) => {
        if (dir === blocked) {
          const error = new Error('permission denied');
          error.code = 'EACCES';
          throw error;
        }
        return fs.readdir(dir, opts);
      },
    });

    assert.deepEqual(result.videos.map((video) => video.filename), ['root.mp4']);
    assert.equal(result.summary.skippedDirectoryCount, 1);
    assert.deepEqual(result.summary.skippedDirectorySamples, [{ path: blocked, reason: 'EACCES' }]);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('scanDirectory marks folders with unreadable files as incomplete', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'videocull-scan-'));

  try {
    await fs.writeFile(path.join(tempRoot, 'ok.mp4'), '');
    await fs.writeFile(path.join(tempRoot, 'flaky.mp4'), '');

    const result = await scanDirectory(tempRoot, false, undefined, {
      includeVisitedDirs: true,
      statPath: async (fullPath) => {
        if (fullPath.endsWith('flaky.mp4')) throw Object.assign(new Error('io'), { code: 'EIO' });
        return fs.stat(fullPath);
      },
    });

    assert.deepEqual(result.videos.map((video) => video.filename), ['ok.mp4']);
    assert.deepEqual(result.incompleteDirs, [tempRoot]);
    assert.equal(result.summary.skippedFileCount, 1);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('scanDirectory aborts when the cancellation guard throws', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'videocull-scan-'));

  try {
    await fs.writeFile(path.join(tempRoot, 'root.mp4'), '');
    await assert.rejects(
      scanDirectory(tempRoot, true, undefined, {
        assertNotCancelled() {
          throw new Error('scan superseded');
        },
      }),
      /scan superseded/
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
