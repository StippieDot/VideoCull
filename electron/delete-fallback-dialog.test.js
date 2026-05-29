const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPermanentDeleteFallbackDialogOptions } = require('./delete-fallback-dialog');

test('shows failed paths in permanent delete fallback dialog detail', () => {
  const options = buildPermanentDeleteFallbackDialogOptions([
    'D:\\Videos\\A.mp4',
    'D:\\Videos\\B.mp4',
  ]);

  assert.match(options.message, /Recycle Bin failed for 2 file\(s\)/);
  assert.match(options.detail, /These files will be permanently deleted if you continue\./);
  assert.match(options.detail, /D:\\Videos\\A\.mp4/);
  assert.match(options.detail, /D:\\Videos\\B\.mp4/);
});

test('truncates long permanent delete fallback file lists', () => {
  const options = buildPermanentDeleteFallbackDialogOptions([
    'D:\\Videos\\1.mp4',
    'D:\\Videos\\2.mp4',
    'D:\\Videos\\3.mp4',
    'D:\\Videos\\4.mp4',
    'D:\\Videos\\5.mp4',
    'D:\\Videos\\6.mp4',
  ]);

  assert.doesNotMatch(options.detail, /D:\\Videos\\6\.mp4/);
  assert.match(options.detail, /\.\.\.and 1 more file\./);
});
