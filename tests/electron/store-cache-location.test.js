const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const { getCacheLocationInfo } = require('../../electron/cache-location-info');

const roots = [];
async function tempRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'videocull-cache-info-'));
  roots.push(root);
  return root;
}
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

test('classifies Store LocalCache separately from external central cache', async () => {
  const root = await tempRoot();
  const packageRoot = path.join(root, 'Packages', 'PFN');
  const profileRoot = path.join(packageRoot, 'LocalState', 'profile');
  const defaultCentralRoot = path.join(packageRoot, 'LocalCache', 'video-cache');
  await fs.mkdir(defaultCentralRoot, { recursive: true });
  const packageInfo = await getCacheLocationInfo({ settings: {}, packageRoot, profileRoot, defaultCentralRoot });
  assert.equal(packageInfo.locations[0].ownership, 'package');
  assert.equal(packageInfo.locations[0].disposableOnReset, true);

  const external = path.join(root, 'external-cache');
  await fs.mkdir(external);
  const externalInfo = await getCacheLocationInfo({
    settings: { cacheLocation: 'centralised', centralCachePath: external },
    packageRoot,
    profileRoot,
    defaultCentralRoot,
  });
  assert.equal(externalInfo.locations[0].ownership, 'external');
  assert.equal(externalInfo.locations[0].disposableOnReset, false);
});

test('reports configured per-drive caches without deleting or rewriting them', async () => {
  const root = await tempRoot();
  const external = path.join(root, 'drive-cache');
  await fs.mkdir(external);
  const info = await getCacheLocationInfo({
    settings: { cacheLocation: 'per-drive', perDriveCachePaths: { 'D:': external } },
    profileRoot: path.join(root, 'profile'),
    defaultCentralRoot: path.join(root, 'default'),
    knownFolders: [],
  });
  assert.deepEqual(info.locations.map((item) => item.path), [external]);
  assert.equal(info.locations[0].ownership, 'external');
});
