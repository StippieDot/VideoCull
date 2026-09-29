const assert = require('node:assert/strict');
const { test: nodeTest } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = globalThis.test || nodeTest;

const { migrateCacheMoves, __test__ } = require('../../electron/cache-migration');

async function createTempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'videocull-cache-settings-migration-'));
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function migrationArtifacts(root) {
  const entries = await fs.readdir(root, { recursive: true }).catch(() => []);
  return entries.filter((entry) => entry.includes('.videocull-migration-'));
}

test('stage failure removes staging and preserves every source', async () => {
  const root = await createTempRoot();
  try {
    const firstSource = path.join(root, 'source', 'first.db');
    const secondSource = path.join(root, 'source', 'second.db');
    const firstTarget = path.join(root, 'target-a', 'first.db');
    const secondTarget = path.join(root, 'target-b', 'second.db');
    await fs.mkdir(path.dirname(firstSource), { recursive: true });
    await fs.writeFile(firstSource, 'first');
    await fs.writeFile(secondSource, 'second');
    let copies = 0;

    await assert.rejects(migrateCacheMoves([
      { source: firstSource, target: firstTarget, folderPath: 'A', kind: 'db' },
      { source: secondSource, target: secondTarget, folderPath: 'B', kind: 'db' },
    ], {
      transactionId: 'stage-failure',
      copySource: async (source, staging) => {
        copies += 1;
        if (copies === 2) throw new Error('copy failed');
        await __test__.copySourceToStage(source, staging);
      },
    }), /copy failed/);

    assert.equal(await fs.readFile(firstSource, 'utf8'), 'first');
    assert.equal(await fs.readFile(secondSource, 'utf8'), 'second');
    assert.equal(await exists(firstTarget), false);
    assert.equal(await exists(secondTarget), false);
    assert.deepEqual(await migrationArtifacts(root), []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('promotion failure rolls back promoted targets and preserves every source', async () => {
  const root = await createTempRoot();
  try {
    const firstSource = path.join(root, 'source', 'first.db');
    const secondSource = path.join(root, 'source', 'second.db');
    const firstTarget = path.join(root, 'target-a', 'first.db');
    const secondTarget = path.join(root, 'target-b', 'second.db');
    await fs.mkdir(path.dirname(firstSource), { recursive: true });
    await fs.writeFile(firstSource, 'first');
    await fs.writeFile(secondSource, 'second');
    let promotions = 0;

    await assert.rejects(migrateCacheMoves([
      { source: firstSource, target: firstTarget, folderPath: 'A', kind: 'db' },
      { source: secondSource, target: secondTarget, folderPath: 'B', kind: 'db' },
    ], {
      transactionId: 'promotion-failure',
      rename: async (source, target) => {
        promotions += 1;
        if (promotions === 2) throw new Error('rename failed');
        await fs.rename(source, target);
      },
    }), /rename failed/);

    assert.equal(await fs.readFile(firstSource, 'utf8'), 'first');
    assert.equal(await fs.readFile(secondSource, 'utf8'), 'second');
    assert.equal(await exists(firstTarget), false);
    assert.equal(await exists(secondTarget), false);
    assert.deepEqual(await migrationArtifacts(root), []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('commit hook failure after promotion rolls back targets and preserves every source', async () => {
  const root = await createTempRoot();
  try {
    const firstSource = path.join(root, 'source', 'first.db');
    const secondSource = path.join(root, 'source', 'second.db');
    const firstTarget = path.join(root, 'target-a', 'first.db');
    const secondTarget = path.join(root, 'target-b', 'second.db');
    await fs.mkdir(path.dirname(firstSource), { recursive: true });
    await fs.writeFile(firstSource, 'first');
    await fs.writeFile(secondSource, 'second');
    let promotedAtCommit = null;

    await assert.rejects(migrateCacheMoves([
      { source: firstSource, target: firstTarget, folderPath: 'A', kind: 'db' },
      { source: secondSource, target: secondTarget, folderPath: 'B', kind: 'db' },
    ], {
      transactionId: 'commit-failure',
      beforeSourceCleanup: async (promoted) => {
        promotedAtCommit = promoted.length;
        assert.equal(await exists(firstSource), true);
        throw new Error('index write failed');
      },
    }), /index write failed/);

    assert.equal(promotedAtCommit, 2);
    assert.equal(await fs.readFile(firstSource, 'utf8'), 'first');
    assert.equal(await fs.readFile(secondSource, 'utf8'), 'second');
    assert.equal(await exists(firstTarget), false);
    assert.equal(await exists(secondTarget), false);
    assert.deepEqual(await migrationArtifacts(root), []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('successful migration promotes every item before removing sources', async () => {
  const root = await createTempRoot();
  try {
    const fileSource = path.join(root, 'source', 'cache.db');
    const directorySource = path.join(root, 'source', 'thumbs');
    const fileTarget = path.join(root, 'target-a', 'cache.db');
    const directoryTarget = path.join(root, 'target-b', 'thumbs');
    await fs.mkdir(directorySource, { recursive: true });
    await fs.writeFile(fileSource, 'database');
    await fs.writeFile(path.join(directorySource, 'thumb.jpg'), 'thumbnail');
    const events = [];

    const result = await migrateCacheMoves([
      { source: fileSource, target: fileTarget, folderPath: 'A', kind: 'db' },
      { source: directorySource, target: directoryTarget, folderPath: 'B', kind: 'thumbs' },
    ], {
      transactionId: 'success',
      rename: async (source, target) => {
        events.push(`promote:${path.basename(target)}`);
        await fs.rename(source, target);
      },
      removeSource: async (source, options) => {
        assert.equal(await exists(fileTarget), true);
        assert.equal(await exists(directoryTarget), true);
        events.push(`cleanup:${path.basename(source)}`);
        await fs.rm(source, options);
      },
    });

    assert.equal(result.promoted.length, 2);
    assert.deepEqual(events, [
      'promote:cache.db',
      'promote:thumbs',
      'cleanup:cache.db',
      'cleanup:thumbs',
    ]);
    assert.equal(await fs.readFile(fileTarget, 'utf8'), 'database');
    assert.equal(await fs.readFile(path.join(directoryTarget, 'thumb.jpg'), 'utf8'), 'thumbnail');
    assert.equal(await exists(fileSource), false);
    assert.equal(await exists(directorySource), false);
    assert.deepEqual(await migrationArtifacts(root), []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('target conflicts and duplicate target plans fail before staging', async () => {
  const root = await createTempRoot();
  try {
    const firstSource = path.join(root, 'source', 'first.db');
    const secondSource = path.join(root, 'source', 'second.db');
    const target = path.join(root, 'target', 'cache.db');
    await fs.mkdir(path.dirname(firstSource), { recursive: true });
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(firstSource, 'first');
    await fs.writeFile(secondSource, 'second');
    await fs.writeFile(target, 'existing');

    await assert.rejects(migrateCacheMoves([
      { source: firstSource, target, folderPath: 'A', kind: 'db' },
    ]), /Target cache already exists/);
    assert.equal(await fs.readFile(firstSource, 'utf8'), 'first');
    assert.equal(await fs.readFile(target, 'utf8'), 'existing');

    await fs.rm(target);
    await assert.rejects(migrateCacheMoves([
      { source: firstSource, target, folderPath: 'A', kind: 'db' },
      { source: secondSource, target, folderPath: 'B', kind: 'db' },
    ]), /Duplicate migration target/);
    assert.equal(await fs.readFile(firstSource, 'utf8'), 'first');
    assert.equal(await fs.readFile(secondSource, 'utf8'), 'second');
    assert.deepEqual(await migrationArtifacts(root), []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('source cleanup failures warn without invalidating promoted caches', async () => {
  const root = await createTempRoot();
  try {
    const source = path.join(root, 'source', 'cache.db');
    const target = path.join(root, 'target', 'cache.db');
    const warnings = [];
    await fs.mkdir(path.dirname(source), { recursive: true });
    await fs.writeFile(source, 'database');

    const result = await migrateCacheMoves([
      { source, target, folderPath: 'A', kind: 'db' },
    ], {
      transactionId: 'cleanup-failure',
      removeSource: async () => { throw new Error('source locked'); },
      onCleanupError: (error, move) => warnings.push([error.message, move.source]),
    });

    assert.equal(result.promoted.length, 1);
    assert.equal(result.cleanupErrors.length, 1);
    assert.equal(await fs.readFile(target, 'utf8'), 'database');
    assert.equal(await fs.readFile(source, 'utf8'), 'database');
    assert.deepEqual(warnings, [['source locked', source]]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
