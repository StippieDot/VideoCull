const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  compareStoreVersions,
  parseStoreVersion,
  storeVersionFromPackageVersion,
  validateStoreVersion,
} = require('../../scripts/store-version');

test('maps stable package versions to four-part Store versions', () => {
  assert.equal(storeVersionFromPackageVersion('2.2.1'), '2.2.1.0');
  assert.throws(() => storeVersionFromPackageVersion('2.2.1-beta.1'), /stable major\.minor\.patch/);
  assert.throws(() => storeVersionFromPackageVersion('0.2.1'), /major must be between 1 and 65535/);
});

test('enforces Store component ranges and zero revision', () => {
  assert.equal(storeVersionFromPackageVersion('65535.65535.65535'), '65535.65535.65535.0');
  assert.deepEqual(parseStoreVersion('1.0.65535.0'), [1, 0, 65535, 0]);
  assert.throws(() => parseStoreVersion('1.65536.0.0'), /minor/);
  assert.throws(() => parseStoreVersion('1.0.65536.0'), /patch/);
  assert.throws(() => parseStoreVersion('65536.0.0.0'), /major/);
  assert.throws(() => parseStoreVersion('1.0.0.1'), /revision must be exactly 0/);
});

test('compares every Store version component', () => {
  assert.equal(compareStoreVersions('3.0.0.0', '2.65535.65535.0'), 1);
  assert.equal(compareStoreVersions('2.3.0.0', '2.2.65535.0'), 1);
  assert.equal(compareStoreVersions('2.2.2.0', '2.2.1.0'), 1);
  assert.equal(compareStoreVersions('2.2.1.0', '2.2.1.0'), 0);
  assert.equal(compareStoreVersions('2.2.0.0', '2.2.1.0'), -1);
});

test('requires the candidate to exceed the explicit submitted baseline', () => {
  assert.equal(validateStoreVersion('2.2.1', '2.2.0.0'), '2.2.1.0');
  assert.throws(() => validateStoreVersion('2.2.1', '2.2.1.0'), /must be greater/);
  assert.throws(() => validateStoreVersion('2.2.1', '2.3.0.0'), /must be greater/);
  assert.throws(() => validateStoreVersion('2.2.1', undefined), /four numeric components/);
});
