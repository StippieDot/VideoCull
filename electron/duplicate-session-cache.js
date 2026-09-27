const os = require('node:os');

function grayCacheLimitForMemory(totalBytes = os.totalmem()) {
  const gib = totalBytes / (1024 ** 3);
  if (gib <= 8) return 64 * 1024 * 1024;
  if (gib <= 16) return 128 * 1024 * 1024;
  return 256 * 1024 * 1024;
}

function createDuplicateSessionCache({ grayByteLimit = grayCacheLimitForMemory() } = {}) {
  const signatures = new Map();
  const fingerprintState = new Map();
  const pHashRowsByVideo = new Map();
  const grayRowsByVideo = new Map();
  let activeFingerprintKey = null;
  let grayBytes = 0;

  function beginFingerprintSettings(fingerprintKey) {
    if (activeFingerprintKey === fingerprintKey) return;
    activeFingerprintKey = fingerprintKey;
    fingerprintState.clear();
    pHashRowsByVideo.clear();
    grayRowsByVideo.clear();
    grayBytes = 0;
  }

  function rememberSignatures(rows) {
    for (const row of rows) {
      if (!row?.id) continue;
      signatures.set(row.id, {
        id: row.id,
        file_signature_quick: row.file_signature_quick ?? row.fileSignatureQuick ?? null,
        file_signature_full: row.file_signature_full ?? row.fileSignatureFull ?? null,
        signature_updated_at: row.signature_updated_at ?? row.signatureUpdatedAt ?? null,
      });
    }
  }

  function updateSignature(videoId, update) {
    const previous = signatures.get(videoId) ?? { id: videoId };
    signatures.set(videoId, {
      ...previous,
      file_signature_quick: update.quick ?? previous.file_signature_quick ?? null,
      file_signature_full: update.full ?? previous.file_signature_full ?? null,
      signature_updated_at: Date.now(),
    });
  }

  function rowsByVideo(videoIds, rows) {
    const grouped = new Map(videoIds.map((videoId) => [videoId, []]));
    for (const row of rows) grouped.get(row.video_id)?.push(row);
    return grouped;
  }

  function rowBytes(rows) {
    return rows.reduce((sum, row) => sum + (row.gray_bytes?.byteLength ?? 0), 0);
  }

  function storeComparisonRows(videoIds, mode, rows) {
    const grouped = rowsByVideo(videoIds, rows);
    if (mode === 'phash') {
      for (const [videoId, videoRows] of grouped) pHashRowsByVideo.set(videoId, videoRows);
      return;
    }

    for (const [videoId, videoRows] of grouped) {
      const previous = grayRowsByVideo.get(videoId);
      if (previous) grayBytes -= previous.bytes;
      const entry = { rows: videoRows, bytes: rowBytes(videoRows) };
      grayRowsByVideo.delete(videoId);
      grayRowsByVideo.set(videoId, entry);
      grayBytes += entry.bytes;
    }
    while (grayBytes > grayByteLimit && grayRowsByVideo.size > 0) {
      const oldestId = grayRowsByVideo.keys().next().value;
      const oldest = grayRowsByVideo.get(oldestId);
      grayRowsByVideo.delete(oldestId);
      grayBytes -= oldest.bytes;
    }
  }

  function rememberFolder({ videoIds, signatureRows, completeById, failedIds, mode, comparisonRows }) {
    rememberSignatures(signatureRows);
    for (const videoId of videoIds) {
      fingerprintState.set(videoId, {
        complete: Boolean(completeById.get(videoId)),
        failed: failedIds.has(videoId),
      });
    }
    storeComparisonRows(videoIds, mode, comparisonRows);
  }

  function hasFolder(videoIds, mode) {
    const comparison = mode === 'phash' ? pHashRowsByVideo : grayRowsByVideo;
    return videoIds.every((videoId) => (
      signatures.has(videoId) && fingerprintState.has(videoId) && comparison.has(videoId)
    ));
  }

  function folderSnapshot(videoIds, mode) {
    const comparison = mode === 'phash' ? pHashRowsByVideo : grayRowsByVideo;
    const signatureRows = [];
    const completeById = new Map();
    const failedIds = new Set();
    const comparisonRows = [];
    for (const videoId of videoIds) {
      const signature = signatures.get(videoId);
      if (signature) signatureRows.push(signature);
      const state = fingerprintState.get(videoId);
      if (state?.complete) completeById.set(videoId, true);
      if (state?.failed) failedIds.add(videoId);
      const stored = comparison.get(videoId);
      const rows = mode === 'phash' ? stored : stored?.rows;
      if (rows) comparisonRows.push(...rows);
      if (mode === 'visual' && stored) {
        grayRowsByVideo.delete(videoId);
        grayRowsByVideo.set(videoId, stored);
      }
    }
    return { signatureRows, completeById, failedIds, comparisonRows };
  }

  function rememberFingerprints(videoId, fingerprints, mode) {
    fingerprintState.set(videoId, { complete: true, failed: false });
    const rows = fingerprints.map((fingerprint) => ({
      video_id: videoId,
      sample_index: fingerprint.sampleIndex,
      phash_hex: fingerprint.phashHex,
      flipped_phash_hex: fingerprint.flippedPHashHex ?? null,
      gray_bytes: fingerprint.grayBytes,
      frame_dark_ratio: fingerprint.frameDarkRatio ?? null,
    }));
    storeComparisonRows([videoId], mode, rows);
  }

  function rememberFingerprintFailure(videoId) {
    fingerprintState.set(videoId, { complete: false, failed: true });
    pHashRowsByVideo.delete(videoId);
    const gray = grayRowsByVideo.get(videoId);
    if (gray) grayBytes -= gray.bytes;
    grayRowsByVideo.delete(videoId);
  }

  function deleteVideos(videoIds) {
    for (const videoId of videoIds) {
      signatures.delete(videoId);
      fingerprintState.delete(videoId);
      pHashRowsByVideo.delete(videoId);
      const gray = grayRowsByVideo.get(videoId);
      if (gray) grayBytes -= gray.bytes;
      grayRowsByVideo.delete(videoId);
    }
  }

  function clear() {
    signatures.clear();
    fingerprintState.clear();
    pHashRowsByVideo.clear();
    grayRowsByVideo.clear();
    activeFingerprintKey = null;
    grayBytes = 0;
  }

  function getStats() {
    return {
      signatures: signatures.size,
      fingerprintStates: fingerprintState.size,
      pHashVideos: pHashRowsByVideo.size,
      grayVideos: grayRowsByVideo.size,
      grayBytes,
      grayByteLimit,
    };
  }

  return {
    beginFingerprintSettings,
    rememberSignatures,
    updateSignature,
    rememberFolder,
    hasFolder,
    folderSnapshot,
    rememberFingerprints,
    rememberFingerprintFailure,
    deleteVideos,
    clear,
    getStats,
  };
}

module.exports = { createDuplicateSessionCache, grayCacheLimitForMemory };
