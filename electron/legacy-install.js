const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const UNINSTALL_ROOTS = [
  ['HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', null],
  ['HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', '64'],
  ['HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', '32'],
];

function parseRegistryOutput(output) {
  const entries = [];
  let current = null;
  for (const line of String(output || '').split(/\r?\n/)) {
    if (/^HKEY_/i.test(line.trim())) {
      if (current) entries.push(current);
      current = { key: line.trim() };
      continue;
    }
    const match = line.match(/^\s{2,}([^\s]+)\s+REG_\w+\s+(.*)$/i);
    if (current && match) current[match[1]] = match[2].trim();
  }
  if (current) entries.push(current);
  return entries;
}

async function queryRegistry(execImpl = execFileAsync) {
  const entries = [];
  for (const [root, registryView] of UNINSTALL_ROOTS) {
    const args = ['query', root, '/s'];
    if (registryView) args.push(`/reg:${registryView}`);
    try {
      const { stdout } = await execImpl('reg.exe', args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
      entries.push(...parseRegistryOutput(stdout));
    } catch (error) {
      if (error?.code !== 1) throw error;
    }
  }
  return entries;
}

function parseInteractiveUninstaller(value) {
  if (typeof value !== 'string') return null;
  const quoted = value.match(/^\s*"([^"]+\.exe)"\s*$/i);
  const unquoted = value.match(/^\s*([^"\r\n]+\.exe)\s*$/i);
  const executable = quoted?.[1] || unquoted?.[1]?.trim();
  if (!executable || !path.win32.isAbsolute(executable)) return null;
  if (!/^uninstall video ?cull\.exe$/i.test(path.win32.basename(executable))) return null;
  return executable;
}

function normalizeVersion(value) {
  const match = String(value || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?$/i);
  if (!match) return null;
  const parts = match.slice(1, 4).map(Number);
  if (match[4] !== undefined) parts.push(Number(match[4]));
  return parts.join('.');
}

function versionFromEntry(entry) {
  const registered = normalizeVersion(entry.DisplayVersion);
  if (registered) return registered;
  const nameMatch = String(entry.DisplayName || '').match(/\bv?(\d+\.\d+\.\d+(?:\.\d+)?)\b/i);
  return normalizeVersion(nameMatch?.[1]);
}

function compareVersions(left, right) {
  const normalizedLeft = normalizeVersion(left);
  const normalizedRight = normalizeVersion(right);
  if (!normalizedLeft || !normalizedRight) return null;
  const leftParts = normalizedLeft.split('.').map(Number);
  const rightParts = normalizedRight.split('.').map(Number);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

function getVersionRelation(left, right) {
  const comparison = compareVersions(left, right);
  if (comparison === null) return 'unknown';
  if (comparison < 0) return 'older';
  if (comparison > 0) return 'newer';
  return 'same';
}

function createLegacyPromptKey(appVersion, install) {
  const directIdentity = install?.version || install?.displayName || install?.uninstallerPath || 'unknown';
  return `${appVersion}|${directIdentity}`;
}

async function detectLegacyInstall(options = {}) {
  if (!options.enabled || options.platform !== 'win32') return { installed: false };
  const entries = await (options.queryRegistry ?? queryRegistry)();
  const fsImpl = options.fsImpl ?? fs;
  for (const entry of entries) {
    if (!/^Video ?Cull(?:\s|$)/i.test(entry.DisplayName || '')) continue;
    if (entry.Publisher && !/^StippieDot$/i.test(entry.Publisher)) continue;
    const uninstallerPath = parseInteractiveUninstaller(entry.UninstallString);
    if (!uninstallerPath) continue;
    try {
      const stats = await fsImpl.lstat(uninstallerPath);
      if (!stats.isFile() || stats.isSymbolicLink()) continue;
    } catch {
      continue;
    }
    return {
      installed: true,
      displayName: entry.DisplayName,
      version: versionFromEntry(entry),
      installLocation: entry.InstallLocation || path.dirname(uninstallerPath),
      uninstallerPath,
      registryKey: entry.key,
    };
  }
  return { installed: false };
}

function launchLegacyUninstaller(status, spawnImpl = spawn) {
  if (!status?.installed || !parseInteractiveUninstaller(`"${status.uninstallerPath}"`)) {
    throw new Error('The previous VideoCull uninstaller is no longer valid.');
  }
  const child = spawnImpl(status.uninstallerPath, [], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();
}

module.exports = {
  compareVersions,
  createLegacyPromptKey,
  detectLegacyInstall,
  getVersionRelation,
  launchLegacyUninstaller,
  normalizeVersion,
  parseInteractiveUninstaller,
  parseRegistryOutput,
  queryRegistry,
  versionFromEntry,
};
