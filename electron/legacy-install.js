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
  detectLegacyInstall,
  launchLegacyUninstaller,
  parseInteractiveUninstaller,
  parseRegistryOutput,
  queryRegistry,
};
