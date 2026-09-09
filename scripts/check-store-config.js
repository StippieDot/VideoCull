const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateStoreVersion } = require('./store-version');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const product = JSON.parse(fs.readFileSync(path.join(root, 'product.json'), 'utf8'));
const store = product.microsoftStore;
const appx = packageJson.build?.appx;

assert.ok(store, 'product.json must define microsoftStore metadata');
assert.ok(appx, 'package.json must define build.appx');
assert.equal(appx.identityName, store.identityName, 'AppX identity must match product metadata');
assert.equal(appx.publisher, store.publisher, 'AppX publisher must match product metadata');
assert.equal(appx.publisherDisplayName, store.publisherDisplayName, 'AppX publisher display name must match product metadata');
assert.equal(appx.displayName, product.displayName, 'AppX display name must match product identity');
assert.equal(appx.applicationId, 'VideoCull', 'AppX application ID must remain stable');
assert.deepEqual(appx.languages, ['en-US'], 'Store package must declare en-US');
assert.deepEqual(appx.capabilities, ['runFullTrust'], 'Store package must request only runFullTrust');
assert.equal(appx.minVersion, '10.0.19041.0', 'Store package must support Windows 10 2004 or newer');
assert.equal(appx.setBuildNumber, false, 'Store revision must remain zero');
assert.equal(appx.artifactName, 'VideoCull.Store.${version}.x64.${ext}', 'Store artifact name must identify x64 AppX');

const candidate = validateStoreVersion(packageJson.version, store.lastSubmittedVersion);
const expected = process.argv.includes('--expected')
  ? process.argv[process.argv.indexOf('--expected') + 1]
  : null;
if (expected) assert.equal(candidate, expected, 'Store tag/version does not match package.json');

function pngDimensions(filePath) {
  const data = fs.readFileSync(filePath);
  assert.equal(data.subarray(1, 4).toString('ascii'), 'PNG', `${filePath} must be a PNG file`);
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

for (const [asset, width, height] of [
  ['StoreLogo.png', 50, 50],
  ['Square44x44Logo.png', 44, 44],
  ['Square150x150Logo.png', 150, 150],
  ['Wide310x150Logo.png', 310, 150],
]) {
  const assetPath = path.join(root, 'build', 'appx', asset);
  assert.ok(fs.existsSync(assetPath), `Missing AppX asset: ${asset}`);
  assert.deepEqual(pngDimensions(assetPath), { width, height }, `${asset} dimensions must be ${width}x${height}`);
}

console.log(`Store configuration OK. Candidate version: ${candidate}; baseline: ${store.lastSubmittedVersion}.`);
