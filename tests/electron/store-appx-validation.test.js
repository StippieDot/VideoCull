const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test: nodeTest } = require('node:test');

const test = globalThis.test || nodeTest;
const root = path.resolve(__dirname, '..', '..');
const validator = path.join(root, 'scripts', 'validate-store-appx.ps1');

function createFixture(manifest) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'videocull-appx-validation-'));
  const stage = path.join(fixtureRoot, 'stage');
  const assets = path.join(stage, 'Assets');
  const packagePath = path.join(fixtureRoot, 'fixture.appx');
  const archiveScript = path.join(fixtureRoot, 'archive.ps1');
  fs.mkdirSync(assets, { recursive: true });
  fs.writeFileSync(path.join(stage, 'AppxManifest.xml'), manifest);

  for (const asset of ['StoreLogo.png', 'Square44x44Logo.png', 'Square150x150Logo.png', 'Wide310x150Logo.png']) {
    fs.writeFileSync(path.join(assets, asset), 'fixture');
  }
  for (const targetSize of [16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 256]) {
    for (const altForm of ['unplated', 'lightunplated']) {
      fs.writeFileSync(path.join(assets, `Square44x44Logo.targetsize-${targetSize}_altform-${altForm}.png`), 'fixture');
    }
  }

  fs.writeFileSync(archiveScript, [
    'param([string]$Source, [string]$Destination)',
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    '[IO.Compression.ZipFile]::CreateFromDirectory($Source, $Destination)',
  ].join('\n'));
  const archive = spawnSync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    archiveScript,
    '-Source', stage,
    '-Destination', packagePath,
  ], { encoding: 'utf8', shell: false });
  assert.equal(archive.status, 0, archive.stderr || archive.stdout);

  return {
    packagePath,
    cleanup: () => fs.rmSync(fixtureRoot, { recursive: true, force: true }),
  };
}

function validManifest(properties = '') {
  return `<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:desktop6="http://schemas.microsoft.com/appx/manifest/desktop/windows10/6"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities">
  <Identity Name="StippieDot.VideoCull" ProcessorArchitecture="x64"
    Publisher="CN=6A4B6EC8-38EB-4378-A661-8B04B8C7A5A3" Version="2.2.1.0" />
  <Properties>
    <PublisherDisplayName>StippieDot</PublisherDisplayName>
    <desktop6:FileSystemWriteVirtualization>disabled</desktop6:FileSystemWriteVirtualization>
    ${properties}
  </Properties>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.19041.0" MaxVersionTested="10.0.26100.0" />
  </Dependencies>
  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
    <rescap:Capability Name="unvirtualizedResources" />
  </Capabilities>
</Package>`;
}

function validateFixture(manifest) {
  const fixture = createFixture(manifest);
  try {
    return spawnSync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      validator,
      '-PackagePath',
      fixture.packagePath,
      '-ExpectedVersion',
      '2.2.1.0',
    ], { encoding: 'utf8', shell: false });
  } finally {
    fixture.cleanup();
  }
}

test('final APPX validation accepts filesystem devirtualization while registry virtualization remains enabled', {
  skip: process.platform !== 'win32',
}, () => {
  const result = validateFixture(validManifest());
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('final APPX validation requires unvirtualizedResources', {
  skip: process.platform !== 'win32',
}, () => {
  const manifest = validManifest().replace('    <rescap:Capability Name="unvirtualizedResources" />\n', '');
  const result = validateFixture(manifest);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}\n${result.stdout}`, /Unexpected AppX capabilities/);
});

test('final APPX validation requires filesystem write virtualization to be disabled', {
  skip: process.platform !== 'win32',
}, () => {
  const manifest = validManifest().replace(
    '<desktop6:FileSystemWriteVirtualization>disabled</desktop6:FileSystemWriteVirtualization>',
    '<desktop6:FileSystemWriteVirtualization>enabled</desktop6:FileSystemWriteVirtualization>',
  );
  const result = validateFixture(manifest);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}\n${result.stdout}`, /must disable desktop6 filesystem write virtualization/);
});

test('final APPX validation rejects disabled registry write virtualization', {
  skip: process.platform !== 'win32',
}, () => {
  const result = validateFixture(validManifest(
    '<desktop6:RegistryWriteVirtualization>disabled</desktop6:RegistryWriteVirtualization>',
  ));
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}\n${result.stdout}`, /must leave registry write virtualization enabled/);
});
