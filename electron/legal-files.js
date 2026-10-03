// @ts-check
const path = require('path');

/** @typedef {import('../src/types').LegalFileName} LegalFileName */

// Only these bundled files can be opened from the renderer. Packaging copies them into resources/.
/** @type {Record<LegalFileName, { packaged: string, dev: string | null }>} */
const LEGAL_FILES = {
  license: { packaged: 'LICENSE.txt', dev: 'LICENSE' },
  // Generated while packaging, so a development checkout has none.
  notices: { packaged: 'THIRD_PARTY_NOTICES.txt', dev: null },
};

/**
 * @param {unknown} name
 * @param {{ isPackaged: boolean, resourcesPath: string, appRoot: string }} location
 * @returns {string | null}
 */
function resolveLegalFilePath(name, location) {
  if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(LEGAL_FILES, name)) return null;
  const entry = LEGAL_FILES[/** @type {LegalFileName} */ (name)];
  if (location.isPackaged) return path.join(location.resourcesPath, entry.packaged);
  return entry.dev ? path.join(location.appRoot, entry.dev) : null;
}

/**
 * @param {unknown} name
 * @param {{ isPackaged: boolean, resourcesPath: string, appRoot: string }} location
 * @param {{ openPath: (filePath: string) => Promise<string>, exists: (filePath: string) => boolean }} io
 *   openPath follows Electron's shell.openPath: it resolves to an error message, or '' on success.
 * @returns {Promise<boolean>}
 */
async function openLegalFile(name, location, io) {
  const filePath = resolveLegalFilePath(name, location);
  if (!filePath || !io.exists(filePath)) return false;
  return (await io.openPath(filePath)) === '';
}

/** @param {string} repositoryUrl @param {string} version */
function sourceCodeUrlForVersion(repositoryUrl, version) {
  return `${repositoryUrl}/tree/v${version}`;
}

module.exports = { resolveLegalFilePath, openLegalFile, sourceCodeUrlForVersion };
