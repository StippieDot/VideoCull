const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Directory
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  validateDroppedPath: (droppedPath) => ipcRenderer.invoke('validate-dropped-path', droppedPath),
  openInExplorer: (filePath) => ipcRenderer.invoke('open-in-explorer', filePath),

  // Scanning
  scanDirectory: (dirPath, includeSubfolders) =>
    ipcRenderer.invoke('scan-directory', dirPath, includeSubfolders),
  resetLoadedDirectories: () => ipcRenderer.invoke('reset-loaded-directories'),
  onScanProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('scan-progress', handler);
    return () => ipcRenderer.removeListener('scan-progress', handler);
  },

  // Thumbnail generation
  generateThumbnails: (videos, dirPath) =>
    ipcRenderer.invoke('generate-thumbnails', videos, dirPath),
  cancelGeneration: () => ipcRenderer.invoke('cancel-generation'),
  getOSThumbnail: (filePath) => ipcRenderer.invoke('get-os-thumbnail', filePath),
  onThumbProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('thumb-progress', handler);
    return () => ipcRenderer.removeListener('thumb-progress', handler);
  },
  onThumbReadyBatch: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('thumb-ready-batch', handler);
    return () => ipcRenderer.removeListener('thumb-ready-batch', handler);
  },

  // Cache & Config
  saveCache: (dirPath, videos) => ipcRenderer.invoke('save-cache', dirPath, videos),
  saveCacheAtomic: (dirPath, videos) => ipcRenderer.invoke('save-cache-atomic', dirPath, videos),
  clearCache: (dirPath) => ipcRenderer.invoke('clear-cache', dirPath),
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  getAutoConcurrency: (config) => ipcRenderer.invoke('get-auto-concurrency', config),
  validateCacheLocation: (dirPath, expectedDriveKey) => ipcRenderer.invoke('validate-cache-location', dirPath, expectedDriveKey),
  confirmDistributedMode: () => ipcRenderer.invoke('confirm-distributed-mode'),
  migrateCacheSettings: (oldSettings, newSettings, loadedDirs) =>
    ipcRenderer.invoke('migrate-cache-settings', oldSettings, newSettings, loadedDirs),

  // Actions
  batchDelete: (filePaths) => ipcRenderer.invoke('batch-delete', filePaths),
  exportReport: (videos, dirPath) => ipcRenderer.invoke('export-report', videos, dirPath),
  chooseReportScope: () => ipcRenderer.invoke('choose-report-scope'),
  setExportReportAvailable: (enabled) => ipcRenderer.send('set-export-report-available', enabled),
  openVideo: (filePath) => ipcRenderer.invoke('open-video', filePath),
  setVideoFullscreen: (fullscreen) => ipcRenderer.invoke('set-video-fullscreen', fullscreen),

  // Menu events
  onMenuAction: (callback) => {
    const handler = (_event, action) => callback(action);
    ipcRenderer.on('menu-action', handler);
    return () => ipcRenderer.removeListener('menu-action', handler);
  },

  // Updates
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdateStatus: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('update-status', handler);
    return () => ipcRenderer.removeListener('update-status', handler);
  },

  // App notifications
  onAppNotification: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('app-notification', handler);
    return () => ipcRenderer.removeListener('app-notification', handler);
  },
});
