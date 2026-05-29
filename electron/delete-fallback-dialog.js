const MAX_PATH_PREVIEW = 5;

function buildPermanentDeleteFallbackDialogOptions(failedPaths) {
  const safePaths = Array.isArray(failedPaths)
    ? failedPaths.filter((filePath) => typeof filePath === 'string' && filePath.trim().length > 0)
    : [];
  const previewPaths = safePaths.slice(0, MAX_PATH_PREVIEW);
  const hiddenCount = Math.max(0, safePaths.length - previewPaths.length);
  const lines = [
    'This action cannot be undone.',
    '',
    safePaths.length === 1
      ? 'This file will be permanently deleted if you continue.'
      : 'These files will be permanently deleted if you continue.',
    'Affected paths:',
    ...previewPaths,
  ];

  if (hiddenCount > 0) {
    lines.push(`...and ${hiddenCount} more file${hiddenCount === 1 ? '' : 's'}.`);
  }

  return {
    type: 'warning',
    title: 'Recycle Bin not available',
    message: `Recycle Bin failed for ${safePaths.length} file(s). Do you want to permanently delete them instead?`,
    detail: lines.join('\n'),
    buttons: ['Cancel', 'Delete Permanently'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
}

module.exports = {
  buildPermanentDeleteFallbackDialogOptions,
};
