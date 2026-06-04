const assert = require('node:assert/strict');
const path = require('path');
const {
  collectUnloadedOwnerFolders,
  createFolderKey,
  rememberFolder,
} = require('../../electron/cache-folder-tracker');

test('collectUnloadedOwnerFolders returns unique subfolders not loaded yet', () => {
  const root = path.join('F:\\', 'Library');
  const childA = path.join(root, 'ChildA');
  const childB = path.join(root, 'ChildB');
  const loadedFolderKeys = new Set([createFolderKey(childA)]);
  const videos = [
    { path: path.join(root, 'root-video.mp4') },
    { path: path.join(childA, 'a1.mp4') },
    { path: path.join(childA, 'a2.mp4') },
    { path: path.join(childB, 'b1.mp4') },
  ];

  const ownerFolders = collectUnloadedOwnerFolders(videos, root, loadedFolderKeys);

  assert.deepEqual(ownerFolders, [childB]);
});

test('rememberFolder normalizes paths so the same folder is only tracked once', () => {
  const loadedFolderKeys = new Set();
  const folderPath = path.join('F:\\', 'Library', 'ChildA');

  assert.equal(rememberFolder(loadedFolderKeys, folderPath), true);
  assert.equal(rememberFolder(loadedFolderKeys, path.join('f:\\', 'library', 'ChildA')), false);
  assert.equal(loadedFolderKeys.size, 1);
});
