const fs = require('node:fs');
const path = require('node:path');
const product = require('../product.json');

const STORAGE_FORMAT_FILE = 'storage-format.json';

class StorageCompatibilityError extends Error {
  constructor(code, message, userMessage) {
    super(message);
    this.name = 'StorageCompatibilityError';
    this.code = code;
    this.userMessage = userMessage;
  }
}

function validateFormatVersion(value, label) {
  if (!Number.isInteger(value) || value < 1) {
    throw new StorageCompatibilityError(
      'VIDEOCULL_STORAGE_FORMAT_INVALID',
      `${label} must be a positive integer.`,
      'VideoCull could not verify the shared data format. The profile was not opened to avoid changing it.',
    );
  }
  return value;
}

function readMarker(markerPath, fsImpl = fs) {
  let marker;
  try {
    marker = JSON.parse(fsImpl.readFileSync(markerPath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw new StorageCompatibilityError(
      'VIDEOCULL_STORAGE_FORMAT_INVALID',
      `Storage format marker could not be read: ${error.message}`,
      'VideoCull could not verify the shared data format. The profile was not opened to avoid changing it.',
    );
  }
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) {
    throw new StorageCompatibilityError(
      'VIDEOCULL_STORAGE_FORMAT_INVALID',
      'Storage format marker must contain a JSON object.',
      'VideoCull could not verify the shared data format. The profile was not opened to avoid changing it.',
    );
  }
  return { formatVersion: validateFormatVersion(marker.formatVersion, 'Storage format version') };
}

function createMarker(markerPath, formatVersion, fsImpl = fs) {
  const content = `${JSON.stringify({ formatVersion }, null, 2)}\n`;
  let descriptor = null;
  let created = false;
  try {
    descriptor = fsImpl.openSync(markerPath, 'wx');
    created = true;
    fsImpl.writeFileSync(descriptor, content, 'utf8');
    fsImpl.fsyncSync?.(descriptor);
    fsImpl.closeSync(descriptor);
    descriptor = null;
  } catch (error) {
    if (error?.code === 'EEXIST') return readMarker(markerPath, fsImpl);
    if (descriptor !== null) try { fsImpl.closeSync(descriptor); } catch { /* Preserve the original error. */ }
    if (created) try { fsImpl.unlinkSync(markerPath); } catch { /* Preserve the original error. */ }
    throw error;
  }
  return { formatVersion };
}

function ensureProfileStorageCompatibility(profilePath, options = {}) {
  const fsImpl = options.fsImpl ?? fs;
  const pathImpl = options.pathImpl ?? path;
  const supportedFormatVersion = validateFormatVersion(
    options.supportedFormatVersion ?? product.storageFormatVersion,
    'Supported storage format version',
  );
  const markerPath = pathImpl.join(profilePath, STORAGE_FORMAT_FILE);
  const existingMarker = readMarker(markerPath, fsImpl);
  const marker = existingMarker ?? createMarker(markerPath, supportedFormatVersion, fsImpl);

  if (marker.formatVersion > supportedFormatVersion) {
    throw new StorageCompatibilityError(
      'VIDEOCULL_STORAGE_FORMAT_NEWER',
      `Profile storage format ${marker.formatVersion} is newer than supported format ${supportedFormatVersion}.`,
      'This VideoCull data was last used by a newer incompatible version. Update VideoCull before continuing to avoid changing the shared library with an older version.',
    );
  }
  if (marker.formatVersion < supportedFormatVersion) {
    throw new StorageCompatibilityError(
      'VIDEOCULL_STORAGE_FORMAT_OLDER',
      `Profile storage format ${marker.formatVersion} is older than supported format ${supportedFormatVersion}.`,
      'This VideoCull version cannot safely open the existing data format. Update VideoCull before continuing.',
    );
  }

  return {
    formatVersion: marker.formatVersion,
    markerPath,
    initialized: existingMarker === null,
  };
}

module.exports = {
  STORAGE_FORMAT_FILE,
  StorageCompatibilityError,
  ensureProfileStorageCompatibility,
  readMarker,
};
