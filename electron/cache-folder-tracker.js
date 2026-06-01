const path = require('path');

function createFolderKey(folderPath) {
  return path.resolve(folderPath).toLowerCase();
}

function rememberFolder(loadedFolderKeys, folderPath) {
  const key = createFolderKey(folderPath);
  if (loadedFolderKeys.has(key)) return false;
  loadedFolderKeys.add(key);
  return true;
}

function isSameFolder(a, b) {
  return createFolderKey(a) === createFolderKey(b);
}

function getVideoFolderPath(video) {
  return path.dirname(video.path);
}

function collectUnloadedOwnerFolders(videos, rootDirPath, loadedFolderKeys = new Set()) {
  const ownerFolders = [];
  for (const video of videos) {
    if (!video?.path) continue;
    const ownerFolder = getVideoFolderPath(video);
    if (isSameFolder(ownerFolder, rootDirPath)) continue;
    if (!rememberFolder(loadedFolderKeys, ownerFolder)) continue;
    ownerFolders.push(ownerFolder);
  }
  return ownerFolders;
}

module.exports = {
  collectUnloadedOwnerFolders,
  createFolderKey,
  rememberFolder,
};
