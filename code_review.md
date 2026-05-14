# Code Review — Unstaged Changes

**Scope**: 17 modified files, 10 new untracked files (~2,500 lines added)  
**Features reviewed**: Duplicate detection engine, metadata pipeline separation, error boundaries, review scoping, duplicate groups UI, settings modal, sidebar extensions.

---

## Summary

The changeset introduces a well-structured duplicate detection engine with pHash and visual comparison modes, separates metadata probing from thumbnail generation, adds a React error boundary, and builds a rich duplicate groups UI. The architecture is mostly sound but there are several issues ranging from critical bugs to cumbersome patterns.

---

## Critical Issues

### 1. `readMetadataForVideo` silently removed error handling — will throw and crash the batch

**File**: [processor.js](file:///d:/GitHub/Video-Cull/electron/processor.js#L327-L373)

The old `readMetadataForVideo` wrapped `getVideoMetadata()` in a try/catch and gracefully fell back to `duration ?? 0`. The new version **removes the try/catch entirely**:

```js
const meta = await getVideoMetadata(video.path);  // Will throw on network drives, corrupt files, permission errors
duration = meta.duration;
```

The caller `processMetadata` does catch the error and calls `onVideoFailed`, so this won't crash the *entire* run — but it will mark every ffprobe-failing video as a metadata failure where previously it was silently skipping with partial metadata. This is a **behavioral regression**: videos that previously got thumbnails despite an ffprobe error will now get no metadata at all, and their duration will remain whatever the cache had.

> [!CAUTION]
> This regression is amplified by the fact that `generateThumbnailsForVideo` also removed its internal `getVideoMetadata` call (the `needsMetadata()` block was deleted). So if metadata extraction fails, the video now has **no second chance** to get metadata during thumbnail generation. Previously, the thumbnail flow was the safety net.

**Fix**: Either re-add a try/catch that preserves partial metadata on failure, or ensure the `processMetadata` -> `onVideoFailed` path explicitly marks the video so the UI knows metadata is degraded (not just silently `null`).

---

### 2. `processMetadata` and `processVideos` share a single `currentToken` — cancelling one cancels the other

**File**: [processor.js](file:///d:/GitHub/Video-Cull/electron/processor.js#L457-L458)

Both `processMetadata` and `processVideos` assign to the module-level `currentToken`:

```js
async function processMetadata(videos, config, ...) {
  const token = { cancelled: false };
  currentToken = token;  // Overwrites processVideos' token
```

And `cancelProcessing()` cancels `currentToken`. If metadata processing and thumbnail generation are running in sequence (as they are in `handleScan`), the second call's assignment to `currentToken` will orphan the first one's token. This means:

- Calling `cancelProcessing()` after metadata starts but before thumbnails start would cancel metadata but leave the stale token around.
- Starting `processMetadata` immediately after metadata finishes will overwrite the token, so a subsequent `cancelGeneration()` IPC call would cancel metadata processing instead of thumbnail processing.

This isn't causing visible issues *currently* because `handleScan` awaits metadata before starting thumbnails, and the main process calls `cancelProcessing()` at the start of `process-metadata`. But it's a race condition waiting to happen.

**Fix**: Use separate tokens for metadata and thumbnail processing, or make `cancelProcessing` cancel all active tokens.

---

### 3. `process-metadata` calls `cancelProcessing()` which kills any running thumbnail generation

**File**: [main.js](file:///d:/GitHub/Video-Cull/electron/main.js#L1509-L1510) (the `ipcMain.handle('process-metadata', ...)` handler)

The very first line of the `process-metadata` handler is `cancelProcessing()`. This means if `process-metadata` is invoked while `generate-thumbnails` is still running, it will **kill all active FFmpeg commands** and cancel thumbnail generation mid-flight. In `handleScan`, this is sequenced correctly (metadata runs first, then thumbnails), but any future caller or manual re-trigger would clobber the other pipeline.

---

## High Severity Issues

### 4. `IS NOT` in SQL should be `IS NOT` or `!=` — but semantics are subtly wrong

**File**: [cache.js](file:///d:/GitHub/Video-Cull/electron/cache.js#L417-L428)

```sql
file_signature_quick = CASE
  WHEN videos.size_bytes IS NOT excluded.size_bytes OR videos.file_date IS NOT excluded.file_date THEN NULL
  ELSE file_signature_quick
END,
```

SQLite's `IS NOT` is valid syntax (it's the negation of `IS`, handling NULL correctly). However, the *intent* here is "invalidate signatures when the file changed", comparing `size_bytes` and `file_date`. The issue: `IS NOT` will evaluate to TRUE when both sides are NULL (since `NULL IS NULL` is TRUE, `NULL IS NOT NULL` is FALSE). So if both the old and new `file_date` are NULL, the signature is preserved. This is **correct behavior** — but worth noting that it only works because SQLite has this non-standard operator. If this SQL were ever ported, it would break.

No fix needed, but add a comment documenting the `IS NOT` behavior for future maintainers.

### 5. `loadFingerprintFailureIds` and `loadRecentMetadataFailureIds` use per-row queries — O(N) query overhead

**File**: [cache.js](file:///d:/GitHub/Video-Cull/electron/cache.js#L683-L703)

Both functions iterate over `videoIds` and call `query.get(id)` for each:

```js
return new Set(videoIds.map((id) => query.get(id, cutoff)?.id).filter(Boolean));
```

For large libraries (thousands of videos), this fires thousands of individual prepared-statement executions. While `better-sqlite3` is synchronous and fast, this is still a poor pattern when a single `WHERE id IN (...)` query would suffice. Same issue exists in `loadPHashRows`, `loadGraySampleRows`, and `loadSignatureRows`.

**Fix**: Use a single query with `IN (...)` clauses, chunked if needed for SQLite's variable limit (default 999). The `loadCacheVideos` function already uses `SELECT * FROM videos` (a full table scan), which is the right pattern for bulk reads.

### 6. `ignorePairsWithUndo` captures stale `groups` reference for the undo closure

**File**: [DuplicateGroupsView.tsx](file:///d:/GitHub/Video-Cull/src/components/DuplicateGroupsView.tsx#L159-L179)

```tsx
const ignorePairsWithUndo = (nextIgnoredPairKeys, groupsToHide, title, detail) => {
  const previousGroups = groups;  // captured from render-time zustand selector
  addIgnoredDuplicatePairs(nextIgnoredPairKeys);
  if (hiddenGroupIds.size > 0) {
    setDuplicateGroups(groups.filter(...));  // uses same `groups` ref
  }
  // ...
  action: () => {
    removeIgnoredDuplicatePairs(nextIgnoredPairKeys);
    setDuplicateGroups(previousGroups);  // restores the stale snapshot
  },
};
```

If the user dismisses group A, then dismisses group B, then undoes group A's dismissal, the undo will restore the state that included group B (which was already dismissed). The undo closures capture point-in-time snapshots rather than computing deltas.

**Fix**: Instead of restoring a full snapshot, the undo should re-add the specific groups that were removed, merging them back into the current groups array.

### 7. `VideoCard` duplicate badge may render `Dup %` if `duplicateSimilarity` is `null`

**File**: [VideoCard.tsx](file:///d:/GitHub/Video-Cull/src/components/VideoCard.tsx#L167)

```tsx
{video.duplicateGroupId && <span className="card-badge">Dup {video.duplicateSimilarity?.toFixed(0) ?? ''}%</span>}
```

When `duplicateSimilarity` is null, this renders `Dup %` (with a space before the percent sign). For exact matches the similarity is set to 100 on the group, so this should usually be fine, but defensive rendering would be better.

**Fix**: Conditionally show the percentage only when non-null: `Dup {video.duplicateSimilarity != null ? `${video.duplicateSimilarity.toFixed(0)}%` : ''}`.

---

## Medium Severity Issues

### 8. `grayBytes` stored as BLOB in SQLite but transferred through Worker `workerData` — potential serialization overhead

**File**: [duplicates.js](file:///d:/GitHub/Video-Cull/electron/duplicates.js#L346-L354) and [visual-worker.js](file:///d:/GitHub/Video-Cull/electron/visual-worker.js#L17-L22)

`loadAllGrayRows` loads all gray byte BLOBs into memory, then passes them through `workerData` to the Worker thread. For a library of 5,000 videos × 3 samples × 1,024 bytes each = ~15 MB. This is manageable, but:

1. `workerData` serialization uses structured clone, which copies the data.
2. All data is held in memory simultaneously.

For very large libraries, this could cause memory spikes. Consider using `SharedArrayBuffer` or streaming the data.

### 9. Duplicate detection settings `keeperOrder` is duplicated between `keybind-defaults.ts` and `duplicate-utils.js`

**File**: [keybind-defaults.ts](file:///d:/GitHub/Video-Cull/src/keybind-defaults.ts#L38-L53) vs [duplicate-utils.js](file:///d:/GitHub/Video-Cull/electron/duplicate-utils.js#L1-L27)

Both define `DEFAULT_DUPLICATE_SETTINGS` with identical `keeperOrder` arrays and normalization logic. If one is updated without the other, the frontend and backend will diverge on default behavior.

**Fix**: The Electron main process should be the single source of truth, with the renderer importing or receiving the defaults via IPC.

### 10. `compareKeeperCandidates` is duplicated between `store.ts` and `duplicate-utils.js`

**File**: [store.ts](file:///d:/GitHub/Video-Cull/src/store.ts#L215-L228) vs [duplicate-utils.js](file:///d:/GitHub/Video-Cull/electron/duplicate-utils.js#L236-L249)

Nearly identical implementations exist in both files. This violates DRY and risks the two diverging. The main process determines `suggestedKeeperId` during `findDuplicates`, and the renderer re-computes it via `applyKeeperOrderToGroups` whenever settings change.

**Fix**: The renderer's re-computation is needed for instant settings feedback. Consider extracting to a shared module, or at minimum add a comment linking the two.

### 11. `visual-worker.js` has unused `LARGE_BUCKET_THRESHOLD` constant

**File**: [visual-worker.js](file:///d:/GitHub/Video-Cull/electron/visual-worker.js#L11)

```js
const LARGE_BUCKET_THRESHOLD = 400;
```

This constant is declared but never used in the code. It appears in the final message's `largeBucketThreshold` field, but that field isn't consumed by anyone.

### 12. `processMetadata` in `processor.js` does not respect the cancellation token from `cancelProcessing()`

**File**: [processor.js](file:///d:/GitHub/Video-Cull/electron/processor.js#L456-L491)

The `processMetadata` function creates its own `token` and sets `currentToken = token`. But `getVideoMetadata` (called via `readMetadataForVideo`) does not check this token — it's a raw ffprobe call that can't be cancelled. So `cancelProcessing()` sets `token.cancelled = true`, but ffprobe continues running until it finishes naturally. The worker loop will then break, but there could be a significant delay for large files.

Compare with `generateThumbnailsForVideo` where the token is checked between each frame extraction.

### 13. `setDuplicateGroups` and `applyDuplicateResult` both call `applyDuplicateGroupsToVideos` — redundant double-write

**File**: [store.ts](file:///d:/GitHub/Video-Cull/src/store.ts) (around the setDuplicateGroups and applyDuplicateResult actions)

Both actions iterate over all videos to apply group membership. `applyDuplicateResult` also conditionally calls `applyKeeperOrderToGroups`. When called in sequence (e.g., from the undo flow), this triggers two full video array rewrites and two `computeFiltered` calls.

### 14. `handleScan` awaits `processMetadata` sequentially per root — no overlapping I/O

**File**: [App.tsx](file:///d:/GitHub/Video-Cull/src/App.tsx#L306-L315)

```tsx
for (const group of normalizedGroups) {
  // ...
  await window.electronAPI.processMetadata(needMetadata.map(toMediaProbeInput), group.dirPath);
}
```

Each `processMetadata` call is fully awaited before the next root's metadata is started. This means if you have videos across 3 drives, metadata extraction cannot overlap between roots. The `processMetadata` handler in `main.js` calls `cancelProcessing()` at the top, so they *can't* overlap anyway, but the sequential-per-root loop adds unnecessary IPC round trips.

**Fix**: Flatten all metadata tasks into a single `processMetadata` call, or remove the `cancelProcessing()` from the handler when called within a coordinated scan.

---

## Low Severity / Style Issues

### 15. `readMetadataForVideo` initializes variables then immediately overwrites them

**File**: [processor.js](file:///d:/GitHub/Video-Cull/electron/processor.js#L327-L356)

```js
let duration = video.durationSecs;
let creationTime = video.metadataDate ?? null;
// ... 8 more initializations from video properties ...
const meta = await getVideoMetadata(video.path);
duration = meta.duration;       // immediately overwritten
creationTime = meta.creationTime; // immediately overwritten
```

All the `let` initializations are dead code since they're unconditionally overwritten by the `meta` values. This was a refactoring artifact from when the try/catch would preserve partial values.

### 16. `savedDuplicateScrollTop` is a module-level mutable variable

**File**: [DuplicateGroupsView.tsx](file:///d:/GitHub/Video-Cull/src/components/DuplicateGroupsView.tsx#L9)

Using module-level state (`let savedDuplicateScrollTop = 0`) works but is fragile in dev mode with HMR (the value resets on module reload). Consider storing it in a ref or in the zustand store.

### 17. `toast.action?.()` in App.tsx — action callbacks are stored in state

**File**: [App.tsx](file:///d:/GitHub/Video-Cull/src/App.tsx#L963-L970)

Toast objects now carry `action` (a callback function) and `actionLabel` in state. Zustand store state should generally be serializable. While this works, it means:
- Toasts can't be serialized/debugged easily.
- The closure captures variables from the creation scope, which may become stale if the component re-renders.

This is acceptable for short-lived toasts, but worth keeping in mind.

### 18. Missing type for `MediaProbeVideoInput` — used in `processMetadata` IPC but not fully typed

**File**: [types.ts](file:///d:/GitHub/Video-Cull/src/types.ts) — the type is referenced in the `ElectronAPI.processMetadata` signature but I don't see the type definition in the types.ts diff.

Verify that `MediaProbeVideoInput` is defined and imported correctly.

### 19. `pairKey` in `duplicates.js` uses `\0` as separator, while `settingsPairKey` uses `|`

**File**: [duplicates.js](file:///d:/GitHub/Video-Cull/electron/duplicates.js#L463-L469)

Two different pair key formats exist:
- `pairKey`: Uses `\0` (null byte) for internal deduplication
- `settingsPairKey`: Uses `|` for user-visible ignored pairs

This is intentional (the null byte can't appear in video IDs), but having two key functions with similar names is confusing. Consider renaming to `internalPairKey` and `storedPairKey`.

### 20. `hashBuffer` function is trivial and could be inlined

**File**: [duplicates.js](file:///d:/GitHub/Video-Cull/electron/duplicates.js#L74-L76)

```js
function hashBuffer(hash, buffer) {
  hash.update(buffer);
}
```

This wrapper adds no value. Just call `hash.update(buffer)` directly in `quickSignature`.

### 21. `BUCKET_ACTIVATION_THRESHOLD` in `visual-worker.js` — magic number without justification

**File**: [visual-worker.js](file:///d:/GitHub/Video-Cull/electron/visual-worker.js#L10)

```js
const BUCKET_ACTIVATION_THRESHOLD = 5000;
```

Below 5,000 videos, all-pairs comparison is used (O(n²)). Above it, duration-bucketed comparison is used. The threshold seems arbitrary. At 5,000 videos, the all-pairs comparison is ~12.5 million comparisons, which is substantial. Consider lowering this or adding a comment justifying the number.

---

## Architecture Observations (Not Bugs)

### A. The metadata/thumbnail pipeline split is good but creates a 3-phase waterfall

The scan flow is now: Scan → Metadata → Thumbnails → (optional) Duplicates. Each phase fully completes before the next starts. This is safe but means the user waits longer for thumbnails on large libraries. A future optimization could interleave metadata + thumbnails per-video.

### B. The `reviewScopeIds` system is well-designed

The new `reviewScopeIds` pattern cleanly solves the problem of reviewing a subset of videos (e.g., a duplicate group). The `scopeIdsRef` in `ReviewMode.tsx` correctly pins the scope on mount, preventing it from changing during review.

### C. Error boundary is minimal but appropriate

The `AppErrorBoundary` correctly logs to the main process and offers a reload button. The `window.addEventListener('error'/'unhandledrejection')` handlers in `main.tsx` provide a safety net for non-React errors.

### D. Daisy-chain pruning algorithm is sophisticated

The `pruneWeakDaisyChainMembers` / `splitDaisyChainIds` logic in `duplicates.js` is a thoughtful approach to preventing false positives in transitive similarity grouping. The recursive splitting handles edge cases well.

---

## Files Not Reviewed (New, Untracked)

The following files were reviewed above as part of the untracked files:
- ✅ `electron/duplicates.js`
- ✅ `electron/duplicate-utils.js`
- ✅ `electron/duplicate-worker.js`
- ✅ `electron/visual-worker.js`
- ✅ `src/components/AppErrorBoundary.tsx`
- ✅ `src/components/DuplicateGroupsView.tsx`
- ✅ `src/components/DuplicateGroupsView.css`

Not reviewed (test files):
- ⏭️ `electron/duplicate-utils.test.js`
- ⏭️ `electron/duplicates.test.js`
- ⏭️ `electron/duplicate-worker.test.js`
