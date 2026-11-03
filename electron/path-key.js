const path = require('node:path');

/**
 * A path in a form where equal paths compare equal: Windows ignores letter case, macOS and Linux
 * keep it (a case-insensitive macOS volume still reports one spelling per file). Kept in step with
 * `folderKey` in src/sessions.ts.
 */
function pathKey(filePath, platform = process.platform) {
  const resolved = path.resolve(filePath);
  return platform === 'win32' ? resolved.toLowerCase() : resolved;
}

module.exports = { pathKey };
