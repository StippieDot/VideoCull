const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { scanDirectory } = require('../../electron/scanner');

test('scanDirectory skips cache directories and only recurses when requested', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'videocull-scan-recursive-'));

  try {
    const nested = path.join(tempRoot, 'nested');
    const thumbs = path.join(tempRoot, '.video-cull-thumbs');
    const distributed = path.join(tempRoot, '.videocull');
    await fs.mkdir(nested, { recursive: true });
    await fs.mkdir(thumbs, { recursive: true });
    await fs.mkdir(distributed, { recursive: true });

    await fs.writeFile(path.join(tempRoot, 'root.mp4'), '');
    await fs.writeFile(path.join(nested, 'child.mp4'), '');
    await fs.writeFile(path.join(thumbs, 'skip.mp4'), '');
    await fs.writeFile(path.join(distributed, 'skip-too.mp4'), '');

    const shallow = await scanDirectory(tempRoot, false);
    const deep = await scanDirectory(tempRoot, true);

    assert.deepEqual(shallow.map((video) => video.filename), ['root.mp4']);
    assert.deepEqual(
      deep.map((video) => video.filename).sort(),
      ['child.mp4', 'root.mp4']
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('scanDirectory skips unreadable or non-video entries without failing the scan', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'videocull-scan-errors-'));
  const statPath = path.join(tempRoot, 'bad.mp4');
  const realStat = fs.stat.bind(fs);

  try {
    await fs.writeFile(path.join(tempRoot, 'good.mp4'), '');
    await fs.writeFile(path.join(tempRoot, 'ignore.txt'), '');
    await fs.writeFile(statPath, '');

    vi.spyOn(fs, 'stat').mockImplementation(async (targetPath) => {
      if (targetPath === statPath) {
        throw new Error('stat failed');
      }
      return realStat(targetPath);
    });

    const videos = await scanDirectory(tempRoot, false);
    assert.deepEqual(videos.map((video) => video.filename), ['good.mp4']);
  } finally {
    vi.restoreAllMocks();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('scanDirectory picks up supported legacy and container video formats', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'videocull-scan-mpeg-'));

  try {
    await fs.writeFile(path.join(tempRoot, 'legacy.mpg'), '');
    await fs.writeFile(path.join(tempRoot, 'archive.mpeg'), '');
    await fs.writeFile(path.join(tempRoot, 'broadcast.asf'), '');
    await fs.writeFile(path.join(tempRoot, 'blu-ray.m2ts'), '');
    await fs.writeFile(path.join(tempRoot, 'phone.3gp'), '');
    await fs.writeFile(path.join(tempRoot, 'carrier.3g2'), '');
    await fs.writeFile(path.join(tempRoot, 'camera.dv'), '');
    await fs.writeFile(path.join(tempRoot, 'legacy.divx'), '');
    await fs.writeFile(path.join(tempRoot, 'master.mxf'), '');
    await fs.writeFile(path.join(tempRoot, 'stream.ogv'), '');
    await fs.writeFile(path.join(tempRoot, 'modern.mp4'), '');
    await fs.writeFile(path.join(tempRoot, 'ignore.txt'), '');

    const videos = await scanDirectory(tempRoot, false);

    assert.deepEqual(
      videos.map((video) => video.filename).sort(),
      [
        'archive.mpeg',
        'blu-ray.m2ts',
        'broadcast.asf',
        'camera.dv',
        'carrier.3g2',
        'legacy.divx',
        'legacy.mpg',
        'master.mxf',
        'modern.mp4',
        'phone.3gp',
        'stream.ogv',
      ]
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
