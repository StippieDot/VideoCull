const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createDuplicateResultsStore, sanitizeResults, sessionFileName } = require('../../electron/duplicate-results-store');

const A = '0123456789abcdef';
const B = 'fedcba9876543210';
const C = '00112233445566ff';

function results(overrides = {}) {
  return {
    version: 1,
    createdAt: 1_700_000_000_000,
    settingsKey: 'key',
    scope: 'all',
    videos: [A, B, C].map((id) => ({ id, sizeBytes: 100, date: 5 })),
    groups: [{
      id: 'dup-0123456789abcdef',
      videoIds: [A, B],
      pairs: [{ aId: A, bId: B, similarity: 98.5, matchType: 'phash', comparedSamples: 3, confidence: 'normal' }],
      manualSuggestedKeeperId: B,
      sampleCount: 3,
      matchType: 'phash',
      unreadableSamples: { [A]: [{ index: 2, percent: 75 }] },
    }],
    ...overrides,
  };
}

async function tempStore() {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'videocull-results-'));
  const writeJsonFile = async (fileName, data, rootPath) => fs.writeFile(path.join(rootPath, fileName), JSON.stringify(data));
  return { rootDir, store: createDuplicateResultsStore({ rootDir, writeJsonFile }) };
}

const session = { folders: ['D:\\Videos'], includeSubfolders: true, scope: 'all' };

test('results round-trip, and the file holds no paths', async () => {
  const { rootDir, store } = await tempStore();
  try {
    assert.equal(await store.save(session, results()), true);
    const loaded = await store.load(session);
    assert.deepEqual(loaded.groups[0].pairs[0], {
      aId: A, bId: B, similarity: 98.5, matchType: 'phash', comparedSamples: 3, confidence: 'normal',
      static: false, borderAdjusted: false, flipped: false, partialFingerprint: false, timingAdjusted: false,
    });
    assert.equal(loaded.groups[0].manualSuggestedKeeperId, B);
    const text = await fs.readFile(path.join(rootDir, 'duplicate-results', sessionFileName(session)), 'utf8');
    assert.ok(!text.includes('Videos') && !text.includes('\\\\'), 'no folder or path in the file');
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test('the session name ignores path case on Windows and depends on subfolders and scope', () => {
  const lower = { ...session, folders: ['d:\\videos'] };
  if (process.platform === 'win32') assert.equal(sessionFileName(lower), sessionFileName(session));
  assert.equal(sessionFileName({ ...session, folders: ['E:\\b', 'D:\\a'] }), sessionFileName({ ...session, folders: ['D:\\a', 'E:\\b'] }));
  assert.notEqual(sessionFileName({ ...session, includeSubfolders: false }), sessionFileName(session));
  assert.notEqual(sessionFileName({ ...session, scope: 'filtered' }), sessionFileName(session));
});

test('unknown fields and wrong values are dropped, a wrong shape is refused', () => {
  const cleaned = sanitizeResults(results({
    extra: 'x',
    groups: [
      { ...results().groups[0], path: 'D:\\a.mp4', pairs: [...results().groups[0].pairs, { aId: A, bId: C, similarity: 99, matchType: 'phash' }] },
      { id: 'not-a-group', videoIds: [A, B], pairs: [] },
    ],
  }));
  assert.equal('extra' in cleaned, false);
  assert.equal(cleaned.groups.length, 1);
  assert.equal('path' in cleaned.groups[0], false);
  assert.equal(cleaned.groups[0].pairs.length, 1, 'a pair with a non-member is dropped');
  assert.equal(sanitizeResults(results({ version: 2 })), null);
  assert.equal(sanitizeResults(results({ videos: [{ id: 'D:\\a.mp4', sizeBytes: 1, date: 1 }] })), null);
});

test('a corrupt file is ignored and removed', async () => {
  const { rootDir, store } = await tempStore();
  try {
    const folder = path.join(rootDir, 'duplicate-results');
    await fs.mkdir(folder, { recursive: true });
    const filePath = path.join(folder, sessionFileName(session));
    await fs.writeFile(filePath, '{ not json');
    assert.equal(await store.load(session), null);
    await assert.rejects(fs.stat(filePath));
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test('only the ten most recent sessions are kept', async () => {
  const { rootDir, store } = await tempStore();
  try {
    const nth = (index) => ({ ...session, folders: [`D:\\Videos${index}`] });
    for (let index = 0; index < 11; index++) {
      await store.save(nth(index), results());
      // Distinct modification times, oldest first.
      const file = path.join(rootDir, 'duplicate-results', sessionFileName(nth(index)));
      const time = new Date(1_700_000_000_000 + index * 1000);
      await fs.utimes(file, time, time);
    }
    await store.save(nth(11), results());
    const names = await fs.readdir(path.join(rootDir, 'duplicate-results'));
    assert.equal(names.length, 10);
    assert.equal(await store.load(nth(0)), null);
    assert.equal(await store.load(nth(1)), null);
    assert.ok(await store.load(nth(11)));
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});
