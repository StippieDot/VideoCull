const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const identity = JSON.parse(fs.readFileSync(path.join(root, 'product.json'), 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

for (const [field, value] of [
  ['displayName', identity.displayName],
  ['technicalName', identity.technicalName],
  ['legacyDisplayName', identity.legacyDisplayName],
  ['legacyTechnicalName', identity.legacyTechnicalName],
  ['appId', identity.appId],
  ['publisher', identity.publisher],
  ['repository.owner', identity.repository?.owner],
  ['repository.name', identity.repository?.name],
]) {
  assert.equal(typeof value, 'string', `product.json ${field} must be a string`);
  assert.ok(value.length > 0, `product.json ${field} must not be empty`);
}
assert.equal(packageJson.name, identity.technicalName);
assert.equal(packageJson.build?.productName, identity.displayName);
assert.equal(packageJson.build?.appId, identity.appId);
assert.equal(packageJson.build?.publish?.owner, identity.publisher);
assert.equal(packageJson.build?.publish?.repo, identity.repository.name);

const historicalPrefixes = [
  'docs/superpowers/',
];
const historicalFiles = new Set([
  'CHANGELOG.md',
  'ROADMAP.md',
  'CODEBASE_AUDIT_REPORT.md',
]);
const compatibilityFiles = new Set([
  'product.json',
  'build/installer.nsh',
  'scripts/check-installer-config.js',
]);
const textExtensions = new Set([
  '.css', '.html', '.js', '.json', '.md', '.mdx', '.mjs', '.nsh', '.ps1', '.ts', '.tsx', '.yml', '.yaml',
]);
const escapedLegacyName = identity.legacyDisplayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const legacyDisplayPattern = new RegExp(`${escapedLegacyName}(?!ing)`);

const tracked = childProcess.execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root })
  .toString('utf8')
  .split('\0')
  .filter(Boolean)
  .map((file) => file.replaceAll('\\', '/'));

const failures = [];
for (const file of tracked) {
  if (historicalFiles.has(file) || historicalPrefixes.some((prefix) => file.startsWith(prefix))) continue;
  if (file === 'scripts/check-brand.js') continue;
  if (!textExtensions.has(path.extname(file).toLowerCase())) continue;
  const source = fs.readFileSync(path.join(root, file), 'utf8');

  if (!compatibilityFiles.has(file) && legacyDisplayPattern.test(source)) {
    failures.push(`${file}: contains the legacy spaced product name`);
  }
  if (source.includes('stippie-dot')) {
    failures.push(`${file}: contains the legacy GitHub owner`);
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Brand identity OK across ${tracked.length} tracked files.`);
