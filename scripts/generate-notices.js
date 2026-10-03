// @ts-check
// Builds resources/THIRD_PARTY_NOTICES.txt from the packages that actually ship inside the packaged
// app (app.asar + app.asar.unpacked), not from npm metadata, so transitive runtime packages are
// covered and dev-only packages are not.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const NOTICES_FILE = 'THIRD_PARTY_NOTICES.txt';

// Licenses that need no review. Anything else (e.g. GPL for FFmpeg) is accepted only through an
// explicit entry in license-overrides.json that states the license.
const PERMISSIVE_LICENSES = new Set([
  'MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'BlueOak-1.0.0', 'Python-2.0', '0BSD', 'CC0-1.0',
]);
const LICENSE_FILE_PATTERN = /^(licen[cs]e|copying)([.-].*)?$/i;
const NOTICE_FILE_PATTERN = /^notice([.-].*)?$/i;
const PACKAGE_JSON_PATTERN = /(?:^|[\\/])node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)[\\/]package\.json$/;

/**
 * @typedef {{ name: string, version: string, license: string | null, licenseTexts: string[], noticeTexts: string[] }} ShippedPackage
 * @typedef {{ license?: string, licenseFile?: string, reason: string }} LicenseOverride
 */

/** @param {any} packageJson @returns {string | null} */
function declaredLicense(packageJson) {
  const value = packageJson.license ?? packageJson.licenses?.[0];
  if (typeof value === 'string') return value;
  if (value && typeof value.type === 'string') return value.type;
  return null;
}

/** Drops surrounding blank lines but keeps the indentation of license headings. @param {string} text */
const tidy = (text) => text.replace(/^\s*\n/, '').trimEnd();

/** @param {string} license */
function isPermissive(license) {
  const alternatives = license.replace(/^\(|\)$/g, '').split(/\s+OR\s+/);
  return alternatives.some((alternative) => PERMISSIVE_LICENSES.has(alternative.trim()));
}

/**
 * @param {ShippedPackage[]} packages
 * @param {Record<string, LicenseOverride>} overrides
 * @param {(relativePath: string) => string} readRepoFile
 * @returns {string}
 */
function buildNotices(packages, overrides, readRepoFile) {
  /** @type {string[]} */
  const errors = [];
  const unique = new Map(packages.map((pkg) => [`${pkg.name}@${pkg.version}`, pkg]));
  const sorted = [...unique.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  const shippedNames = new Set(sorted.map((pkg) => pkg.name));

  for (const name of Object.keys(overrides)) {
    if (!shippedNames.has(name)) errors.push(`${name}: license override no longer matches a shipped package; remove it`);
  }

  const sections = sorted.map((pkg) => {
    const override = Object.prototype.hasOwnProperty.call(overrides, pkg.name) ? overrides[pkg.name] : undefined;
    const license = override?.license ?? pkg.license;
    if (!license) {
      errors.push(`${pkg.name}@${pkg.version}: no license declared`);
    } else if (!override?.license && !isPermissive(license)) {
      errors.push(`${pkg.name}@${pkg.version}: license "${license}" is not on the allow-list and has no reviewed override`);
    }
    const licenseTexts = override?.licenseFile ? [readRepoFile(override.licenseFile)] : pkg.licenseTexts;
    if (licenseTexts.every((text) => !text.trim())) errors.push(`${pkg.name}@${pkg.version}: no license text found`);

    return [
      '-'.repeat(79),
      `${pkg.name} ${pkg.version}`,
      `License: ${license ?? 'unknown'}`,
      '',
      ...pkg.noticeTexts.map((text) => `${tidy(text)}\n`),
      ...licenseTexts.map(tidy),
      '',
    ].join('\n');
  });

  if (errors.length) throw new Error(`Third-party notices check failed:\n- ${errors.join('\n- ')}`);

  return [
    'VideoCull third-party notices',
    '=============================',
    '',
    'VideoCull is free software under the GNU Affero General Public License v3.0 (see LICENSE.txt).',
    'It includes the third-party components listed below, each under its own license.',
    '',
    'Electron and Chromium are covered by LICENSE.electron.txt and LICENSES.chromium.html in the',
    'installation folder.',
    '',
    ...sections,
  ].join('\n');
}

/**
 * Lists every npm package inside the packaged app, with its license metadata and texts.
 * @param {string} resourcesPath
 * @returns {ShippedPackage[]}
 */
function readShippedPackages(resourcesPath) {
  const asar = require('@electron/asar');
  const archive = path.join(resourcesPath, 'app.asar');
  const files = asar.listPackage(archive, { isPack: false }).map((file) => file.replace(/^[\\/]/, ''));
  /** @type {Map<string, string[]>} */
  const filesByDir = new Map();
  for (const file of files) {
    const dir = path.dirname(file);
    if (!filesByDir.has(dir)) filesByDir.set(dir, []);
    filesByDir.get(dir)?.push(path.basename(file));
  }
  /** @param {string} file */
  const read = (file) => asar.extractFile(archive, file).toString('utf8');

  return files.filter((file) => PACKAGE_JSON_PATTERN.test(file)).map((file) => {
    const dir = path.dirname(file);
    const packageJson = JSON.parse(read(file));
    const siblings = filesByDir.get(dir) ?? [];
    return {
      name: packageJson.name,
      version: packageJson.version,
      license: declaredLicense(packageJson),
      licenseTexts: siblings.filter((name) => LICENSE_FILE_PATTERN.test(name)).map((name) => read(path.join(dir, name))),
      noticeTexts: siblings.filter((name) => NOTICE_FILE_PATTERN.test(name)).map((name) => read(path.join(dir, name))),
    };
  });
}

/** @param {string} resourcesPath @returns {string} the written file */
function writeThirdPartyNotices(resourcesPath) {
  const overrides = JSON.parse(fs.readFileSync(path.join(__dirname, 'license-overrides.json'), 'utf8'));
  const notices = buildNotices(
    readShippedPackages(resourcesPath),
    overrides,
    (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8'),
  );
  const target = path.join(resourcesPath, NOTICES_FILE);
  fs.writeFileSync(target, notices, 'utf8');
  return target;
}

module.exports = {
  NOTICES_FILE,
  buildNotices,
  declaredLicense,
  readShippedPackages,
  writeThirdPartyNotices,
};
