const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  compareVersions,
  createLegacyPromptKey,
  detectLegacyInstall,
  getVersionRelation,
  launchLegacyUninstaller,
  normalizeVersion,
  parseInteractiveUninstaller,
  parseRegistryOutput,
  versionFromEntry,
} = require('../../electron/legacy-install');

test('parses uninstall registry entries and only accepts interactive VideoCull uninstallers', () => {
  const entries = parseRegistryOutput(`HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\abc\n    DisplayName    REG_SZ    VideoCull 2.2.1\n    Publisher    REG_SZ    StippieDot\n    UninstallString    REG_SZ    "C:\\Apps\\VideoCull\\Uninstall VideoCull.exe"\n`);
  assert.equal(entries[0].DisplayName, 'VideoCull 2.2.1');
  assert.equal(parseInteractiveUninstaller(entries[0].UninstallString), 'C:\\Apps\\VideoCull\\Uninstall VideoCull.exe');
  assert.equal(parseInteractiveUninstaller('"C:\\Apps\\VideoCull\\Uninstall VideoCull.exe" /S'), null);
  assert.equal(parseInteractiveUninstaller('"C:\\Windows\\System32\\cmd.exe"'), null);
});

test('normalizes and compares registered direct-edition versions', () => {
  assert.equal(normalizeVersion('v2.3.0'), '2.3.0');
  assert.equal(normalizeVersion('2.3'), null);
  assert.equal(versionFromEntry({ DisplayVersion: '2.2.1', DisplayName: 'VideoCull' }), '2.2.1');
  assert.equal(versionFromEntry({ DisplayName: 'VideoCull 2.2.1' }), '2.2.1');
  assert.equal(compareVersions('2.2.1', '2.3.0'), -1);
  assert.equal(compareVersions('2.3.0.0', '2.3.0'), 0);
  assert.equal(compareVersions('2.3.1', '2.3.0'), 1);
  assert.equal(compareVersions('unknown', '2.3.0'), null);
  assert.equal(getVersionRelation('2.2.1', '2.3.0'), 'older');
  assert.equal(getVersionRelation('2.3.0.0', '2.3.0'), 'same');
  assert.equal(getVersionRelation('2.3.1', '2.3.0'), 'newer');
  assert.equal(getVersionRelation(null, '2.3.0'), 'unknown');
  assert.notEqual(
    createLegacyPromptKey('2.3.0', { version: '2.2.1' }),
    createLegacyPromptKey('2.3.1', { version: '2.2.1' }),
  );
  assert.notEqual(
    createLegacyPromptKey('2.3.0', { version: '2.2.1' }),
    createLegacyPromptKey('2.3.0', { version: '2.2.2' }),
  );
});

test('detects only validated StippieDot installations whose uninstaller exists', async () => {
  const status = await detectLegacyInstall({
    enabled: true,
    platform: 'win32',
    queryRegistry: async () => [{
      key: 'HKCU\\Software\\Uninstall\\VideoCull',
      DisplayName: 'VideoCull 2.2.1',
      DisplayVersion: '2.2.1',
      Publisher: 'StippieDot',
      InstallLocation: 'C:\\Apps\\VideoCull',
      UninstallString: '"C:\\Apps\\VideoCull\\Uninstall VideoCull.exe"',
    }],
    fsImpl: { lstat: async () => ({ isFile: () => true, isSymbolicLink: () => false }) },
  });
  assert.equal(status.installed, true);
  assert.equal(status.version, '2.2.1');
  assert.equal(status.uninstallerPath, 'C:\\Apps\\VideoCull\\Uninstall VideoCull.exe');
});

test('launches the validated uninstaller without silent arguments', () => {
  const calls = [];
  launchLegacyUninstaller({ installed: true, uninstallerPath: 'C:\\Apps\\VideoCull\\Uninstall VideoCull.exe' }, (file, args, options) => {
    calls.push({ file, args, options });
    return { unref: () => calls.push('unref') };
  });
  assert.deepEqual(calls[0].args, []);
  assert.equal(calls[0].options.detached, true);
  assert.equal(calls[1], 'unref');
});
