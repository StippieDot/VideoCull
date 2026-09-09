const assert = require('node:assert/strict');
const { test } = require('node:test');
const { getDistributionChannel, shouldEnableUpdates } = require('../../electron/distribution');

test('derives the distribution channel from the configured profile', () => {
  assert.equal(getDistributionChannel({ distributionChannel: 'microsoft-store' }), 'microsoft-store');
  assert.equal(getDistributionChannel({ distributionChannel: 'direct' }), 'direct');
  assert.equal(getDistributionChannel(null), 'direct');
});

test('disables GitHub updates for Store, development, E2E, and explicit opt-out builds', () => {
  assert.equal(shouldEnableUpdates({ isDev: false, isE2E: false, distributionChannel: 'direct', disableUpdates: false }), true);
  assert.equal(shouldEnableUpdates({ isDev: false, isE2E: false, distributionChannel: 'microsoft-store', disableUpdates: false }), false);
  assert.equal(shouldEnableUpdates({ isDev: true, isE2E: false, distributionChannel: 'direct', disableUpdates: false }), false);
  assert.equal(shouldEnableUpdates({ isDev: false, isE2E: true, distributionChannel: 'direct', disableUpdates: false }), false);
  assert.equal(shouldEnableUpdates({ isDev: false, isE2E: false, distributionChannel: 'direct', disableUpdates: true }), false);
});
