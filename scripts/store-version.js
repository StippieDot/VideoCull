const STORE_VERSION_PART_MAX = 65535;

function parseStoreVersion(value, label = 'Store version') {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+\.\d+$/.test(value)) {
    throw new Error(`${label} must contain four numeric components.`);
  }

  const parts = value.split('.').map(Number);
  const [major, minor, patch, revision] = parts;
  if (!Number.isSafeInteger(major) || major < 0 || major > STORE_VERSION_PART_MAX) {
    throw new Error(`${label} major must be between 0 and ${STORE_VERSION_PART_MAX}.`);
  }
  for (const [name, part] of [['minor', minor], ['patch', patch]]) {
    if (!Number.isSafeInteger(part) || part < 0 || part > STORE_VERSION_PART_MAX) {
      throw new Error(`${label} ${name} must be between 0 and ${STORE_VERSION_PART_MAX}.`);
    }
  }
  if (revision !== 0) {
    throw new Error(`${label} revision must be exactly 0.`);
  }
  return parts;
}

function storeVersionFromPackageVersion(packageVersion) {
  if (typeof packageVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(packageVersion)) {
    throw new Error('package.json version must be a stable major.minor.patch version for Store packaging.');
  }
  const candidate = `${packageVersion}.0`;
  const [major] = parseStoreVersion(candidate, 'Candidate Store version');
  if (major < 1) {
    throw new Error('Candidate Store version major must be between 1 and 65535.');
  }
  return candidate;
}

function compareStoreVersions(left, right) {
  const a = parseStoreVersion(left, 'Candidate Store version');
  const b = parseStoreVersion(right, 'Last submitted Store version');
  for (let index = 0; index < 4; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function validateStoreVersion(packageVersion, lastSubmittedVersion) {
  const candidate = storeVersionFromPackageVersion(packageVersion);
  parseStoreVersion(lastSubmittedVersion, 'Last submitted Store version');
  if (compareStoreVersions(candidate, lastSubmittedVersion) <= 0) {
    throw new Error(`Candidate Store version ${candidate} must be greater than last submitted version ${lastSubmittedVersion}.`);
  }
  return candidate;
}

module.exports = {
  STORE_VERSION_PART_MAX,
  compareStoreVersions,
  parseStoreVersion,
  storeVersionFromPackageVersion,
  validateStoreVersion,
};
