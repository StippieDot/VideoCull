const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const preloadPath = path.join(root, 'electron', 'preload.js');
const mainPath = path.join(root, 'electron', 'main.js');
const typesPath = path.join(root, 'src', 'types.ts');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function sorted(values) {
  return Array.from(values).sort((a, b) => a.localeCompare(b));
}

function extractElectronApiMethods(typesSource) {
  const match = /export interface ElectronAPI\s*\{([\s\S]*?)\n\}/m.exec(typesSource);
  if (!match) throw new Error('Could not find ElectronAPI interface in src/types.ts');
  return new Set(Array.from(match[1].matchAll(/^  ([A-Za-z0-9_]+):/gm), (item) => item[1]));
}

function extractPreloadMethods(preloadSource) {
  const match = /contextBridge\.exposeInMainWorld\('electronAPI',\s*\{([\s\S]*?)\n\}\);/m.exec(preloadSource);
  if (!match) throw new Error('Could not find electronAPI preload bridge');
  return new Set(Array.from(match[1].matchAll(/^\s{2}([A-Za-z0-9_]+):/gm), (item) => item[1]));
}

function extractChannels(source, pattern) {
  return new Set(Array.from(source.matchAll(pattern), (item) => item[1]));
}

function diff(left, right) {
  return sorted(left).filter((value) => !right.has(value));
}

const preloadSource = read(preloadPath);
const mainSource = read(mainPath);
const typesSource = read(typesPath);

const preloadMethods = extractPreloadMethods(preloadSource);
const typedMethods = extractElectronApiMethods(typesSource);
const invokeChannels = extractChannels(preloadSource, /ipcRenderer\.invoke\('([^']+)'/g);
const sendChannels = extractChannels(preloadSource, /ipcRenderer\.send\('([^']+)'/g);
const handledChannels = extractChannels(mainSource, /ipcMain\.handle\('([^']+)'/g);
const listenedChannels = extractChannels(mainSource, /ipcMain\.on\('([^']+)'/g);

const errors = [];
const missingTypes = diff(preloadMethods, typedMethods);
const missingPreload = diff(typedMethods, preloadMethods);
const missingHandlers = diff(invokeChannels, handledChannels);
const missingListeners = diff(sendChannels, listenedChannels);

if (missingTypes.length) errors.push(`Preload methods missing from ElectronAPI: ${missingTypes.join(', ')}`);
if (missingPreload.length) errors.push(`ElectronAPI methods missing from preload: ${missingPreload.join(', ')}`);
if (missingHandlers.length) errors.push(`ipcRenderer.invoke channels missing ipcMain.handle: ${missingHandlers.join(', ')}`);
if (missingListeners.length) errors.push(`ipcRenderer.send channels missing ipcMain.on: ${missingListeners.join(', ')}`);

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(`IPC contract OK: ${preloadMethods.size} methods, ${invokeChannels.size + sendChannels.size} channels.`);
