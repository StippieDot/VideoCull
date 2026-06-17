# VideoCull Codebase Audit Report - `stippie-dot/VideoCull`, branch `main`

Audited repository: `D:\GitHub\Video-Cull`  
Baseline release: `v1.8.2` (`package.json` version `1.8.2`)  
Current branch: `main` (`package.json` version `2.0.0-beta.2`)  
Electron entrypoint: [`electron/main.js`](electron/main.js)  
Corrected audit date: 2026-06-17

> [!IMPORTANT]
> This corrected report focuses on behavior changed after `v1.8.2`. Findings are marked as introduced after `v1.8.2`, pre-existing, partially introduced, or unclear. No code fixes were made.

## Table of Contents

- [Executive Summary](#executive-summary)
- [Validation Performed](#validation-performed)
- [Delta Since v1.8.2](#delta-since-v182)
- [Upgrade Safety from v1.8.2](#upgrade-safety-from-v182)
- [Finding Provenance and Verification Matrix](#finding-provenance-and-verification-matrix)
- [Critical Findings](#critical-findings)
- [High Priority Findings](#high-priority-findings)
- [Medium Priority Findings](#medium-priority-findings)
- [Low Priority / Cleanup Findings](#low-priority--cleanup-findings)
- [Electron Security Review](#electron-security-review)
- [Destructive Operation Safety Review](#destructive-operation-safety-review)
- [Performance Review](#performance-review)
- [UI/UX Improvement Opportunities](#uiux-improvement-opportunities)
- [Regression Risk Areas](#regression-risk-areas)
- [Missing Tests](#missing-tests)
- [Recommended Fix Order](#recommended-fix-order)
- [Open Questions](#open-questions)

## Executive Summary

Overall health: `main` has many real improvements since `v1.8.2`: broader automated tests, a metadata pipeline, duplicate detection, renderer performance work, crash/idle diagnostics, and more cache instrumentation. The regression risk is also high because the delta is large: 104 files changed, 22,875 insertions, 4,749 deletions.

The release-blocking concerns are concentrated in post-`v1.8.2` cache cleanup, cancellation, duplicate fingerprint persistence, custom protocol/path authorization, and new renderer duplicate/review state.

### Top Release-Blocking Regression Risks

| Rank | Risk | Delta Status | Why It Blocks Release |
|---:|---|---|---|
| 1 | Auto-pruning missing descendant cache folders can delete cache on transient `stat` failures. | Introduced after `v1.8.2` | Can lose review decisions, metadata, thumbnails, and fingerprints on offline/network/mounted drives. |
| 2 | Thumbnail cancellation token is broken after the processor split. | Introduced after `v1.8.2` | Stale FFmpeg work can continue after cancel/rescan and write stale thumbnail batches. |
| 3 | Duplicate fingerprint cache ignores sampling/source settings. | Introduced after `v1.8.2` | Duplicate results can be wrong after settings changes, with persistent stale fingerprint rows. |
| 4 | `video://` lost realpath loaded-root validation and `open-in-explorer` gained an arbitrary existing-path fallback. | Introduced after `v1.8.2` | Custom protocol/reveal behavior widened after the release baseline. |
| 5 | New duplicate/review UI state can act on hidden or stale selections. | Introduced or partially introduced after `v1.8.2` | Large-library culling can mark or operate on videos the user no longer sees. |

Safety assessment: `main` should not ship as a safe upgrade from `v1.8.2` until the post-`v1.8.2` cache deletion, cancellation, protocol authorization, and duplicate persistence issues are fixed and covered by tests.

Pre-existing but still important safety debt:

- Renderer-provided scan roots mint trusted file grants. This existed in `v1.8.2`.
- Missing Electron navigation/window-open denial existed in `v1.8.2`, but the preload API is broader now.
- Cache migration target clobber risk existed in `v1.8.2`.
- Distributed cache index pruning on offline drives existed in `v1.8.2`.

## Validation Performed

### Direct `v1.8.2..main` Comparison

| Command | Result | Notes |
|---|---:|---|
| `git tag --list *1.8.2*` | PASS | Confirmed local `v1.8.2` tag exists. |
| `git diff --name-status v1.8.2..main` | PASS | 104 changed files/modules listed. |
| `git diff --stat v1.8.2..main` | PASS | 22,875 insertions, 4,749 deletions. |
| `git show v1.8.2:electron/main.js` plus targeted matching | PASS | Used to compare IPC, protocols, migration, delete, and BrowserWindow behavior. |
| `git show v1.8.2:electron/processor.js` plus targeted matching | PASS | Used to compare cancellation and metadata behavior. |
| `git show v1.8.2:electron/scanner.js` plus targeted matching | PASS | Used to compare traversal and progress behavior. |
| `git show v1.8.2:src/App.tsx` and `src/store.ts` plus targeted matching | PASS | Used to compare renderer state and scan effect behavior. |
| CodeGraph exploration on current `main` | PASS | Used after `.codegraph` became available to verify current symbols and call paths. |

### Existing Audit Validation

| Command | Result | Important Output |
|---|---:|---|
| `npm run check:ipc` | PASS | `IPC contract OK: 43 methods, 33 channels.` |
| `npx tsc -p tsconfig.test.json --noEmit` | PASS | No TypeScript errors. |
| `npm run test:duplicates` | PASS | 4 files, 33 tests. |
| `npm run test:renderer` | PASS | 6 files, 31 tests. |
| `npm run test` | PASS | 31 files, 207 tests. |
| `npm run test:ci` | PASS | Coverage ran, but coverage is low: statements 39.21%, branches 36.58%, functions 39.8%, lines 39.18%. |
| `npm run build` | PASS | Vite warning: main JS chunk is 523.59 kB, over the 500 kB warning threshold. |
| `npx vitest run tests/electron/main-helpers.test.js tests/electron/preload.test.js` | PASS | Targeted security/preload helper check. |
| `npm run test:e2e` | NOT RUN | It launches Playwright/Electron; environment support and GUI safety were not confirmed. |

### Areas Inspected

- Electron main/preload/helpers:
  - [`electron/main.js`](electron/main.js)
  - [`electron/preload.js`](electron/preload.js)
  - [`electron/main-helpers.js`](electron/main-helpers.js)
- Scanner/cache/metadata/thumb pipeline:
  - [`electron/scanner.js`](electron/scanner.js)
  - [`electron/cache.js`](electron/cache.js)
  - [`electron/cache-folder-tracker.js`](electron/cache-folder-tracker.js)
  - [`electron/processor.js`](electron/processor.js)
- Duplicate detection:
  - [`electron/duplicates.js`](electron/duplicates.js)
  - [`electron/duplicate-utils.js`](electron/duplicate-utils.js)
  - [`electron/duplicate-worker.js`](electron/duplicate-worker.js)
  - [`electron/visual-worker.js`](electron/visual-worker.js)
- Renderer state and UI:
  - [`src/App.tsx`](src/App.tsx)
  - [`src/store.ts`](src/store.ts)
  - [`src/components/Sidebar.tsx`](src/components/Sidebar.tsx)
  - [`src/components/SettingsModal.tsx`](src/components/SettingsModal.tsx)
  - [`src/components/DuplicateGroupsView.tsx`](src/components/DuplicateGroupsView.tsx)
  - grid/review/sidebar/settings flow code
- Tests, package scripts, build config, and recent commit history.

## Delta Since v1.8.2

### Changed Files and Modules

| Module / Files | Changed Behavior Since `v1.8.2` | Regression Risk | Upgrade Risk | Tests Covering It | Missing Tests |
|---|---|---:|---:|---|---|
| Runtime and dependencies: [`package.json`](package.json), [`package-lock.json`](package-lock.json), Vite/Vitest configs | Upgraded from Electron 32 to 41, React 18 to 19, Zustand 4 to 5, `react-window` 1 to 2, `better-sqlite3` 11 to 12, Vite 8, Vitest 4, Playwright added. | Medium | Medium-High | `npm run build`, `npm run test`, `npm run test:ci` | Packaged app smoke, native module rebuild verification, full E2E on Windows. |
| Electron IPC/preload/main helpers: [`electron/main.js`](electron/main.js), [`electron/preload.js`](electron/preload.js), [`electron/main-helpers.js`](electron/main-helpers.js) | Added metadata IPC, duplicate IPC, perf diagnostics, app notifications, `getPathForFile`, `openExternalUrl`, helper extraction. `open-video` got stricter loaded-path validation; `open-in-explorer` got an existing-path fallback. `video://` changed from loaded-root realpath validation to known-path membership. | High | High | `npm run check:ipc`, `tests/electron/preload.test.js`, `tests/electron/main-helpers.test.js` | Main-process IPC integration tests, protocol tests, navigation denial tests, scan grant tests. |
| Scanner: [`electron/scanner.js`](electron/scanner.js), scan handling in [`electron/main.js`](electron/main.js) | Added stat batching, progress batching, cache-folder skipping, `visitedDirs`, scan generation/superseded checks after major phases. Still no abort inside scanner recursion. | Medium | Medium | `tests/electron/scanner.test.js`, `tests/electron/scanner.behavior.test.js` | Abort/superseded scan test, inaccessible directory summary test, mounted-drive latency test. |
| Cache and SQLite: [`electron/cache.js`](electron/cache.js), [`electron/cache-folder-tracker.js`](electron/cache-folder-tracker.js) | Added metadata version/failure columns, bitrate/container fields, file signatures, fingerprint table, stale row pruning, thumbnail ordering, folder tracker. | High | High | `tests/electron/cache.test.js`, `tests/electron/cache.migration.test.js`, `tests/electron/cache-folder-tracker.test.js` | `v1.8.2` DB fixture upgrade test, transient `stat` prune test, migration target-clobber test, fingerprint settings-key test. |
| Processor and FFmpeg/ffprobe: [`electron/processor.js`](electron/processor.js) | Split metadata probing from thumbnail generation, added metadata schema version, added separate `cancelThumbnails` and `cancelMetadata`. Regression: thumbnail token not assigned. | High | High | `tests/electron/processor.helpers.test.js`, limited `tests/electron/processor.test.js` | Thumbnail cancellation test, metadata cancellation-after-await test, ffprobe failure backoff test, partial thumbnail file test. |
| Duplicate detection: [`electron/duplicates.js`](electron/duplicates.js), [`electron/duplicate-utils.js`](electron/duplicate-utils.js), [`electron/duplicate-worker.js`](electron/duplicate-worker.js), [`electron/visual-worker.js`](electron/visual-worker.js) | Entire duplicate pipeline added after `v1.8.2`: exact/hash/visual matching, fingerprint persistence, duplicate worker threads, ignored pairs, suggested keepers. | High | Medium-High | `tests/electron/duplicate-utils.test.js`, `duplicates.test.js`, `duplicate-worker.test.js`, `visual-worker.test.js` | Fingerprint source/settings invalidation test, visual known-vs-unknown duration small-run test, stable group ID test, large-library memory test. |
| Renderer app/store/UI: [`src/App.tsx`](src/App.tsx), [`src/store.ts`](src/store.ts), duplicate/grid/review/sidebar/settings components | Added duplicate groups view, duplicate state, active review path, hidden-mounted grid during review, perf-dev instrumentation, context menus, richer settings. | High | High | `tests/src/*`, `tests/src/components/*`, `tests/src/App.dom.test.tsx` | Settings-save no-rescan test, hidden duplicate selection test, stale active review path after delete test, duplicate-disabled escape hatch test. |
| E2E/test infrastructure: [`playwright.config.ts`](playwright.config.ts), `tests/e2e/*`, Vitest configs | Added E2E harness and many unit/DOM tests. | Low | Medium | Test files exist; unit/DOM suites pass. | `npm run test:e2e` was not run; no upgrade fixture from `v1.8.2` userData/cache. |

### Changed Behavior Summary

Release-impacting behavior changed after `v1.8.2`:

- New metadata pipeline writes metadata in batches and tracks metadata versions/failures.
- Thumbnail generation now depends on cached metadata more heavily and was split from metadata probing.
- Duplicate detection and persisted fingerprints are entirely new.
- Cache schema is expanded in-place with new columns and `video_fingerprints`.
- Scan now prunes missing descendant caches after scan.
- Batch delete now removes cache artifacts and attempts empty-folder cleanup.
- `video://` authorization changed and is weaker against symlink replacement than `v1.8.2`.
- `open-in-explorer` now allows arbitrary existing fallback paths, which `v1.8.2` did not.
- Renderer keeps grid mounted while review mode is active.
- Settings changes can trigger more scan work because `handleScan` now depends on more settings.

## Upgrade Safety from v1.8.2

| Area | Current Upgrade Behavior | Risk | Release Assessment | Tests Covering It | Missing Tests |
|---|---|---:|---|---|---|
| Cache DB compatibility | Current `cache.openDb` runs `CREATE TABLE IF NOT EXISTS` plus additive `ALTER TABLE` for new video columns and fingerprint columns. Existing `v1.8.2` DBs should open because the schema changes are additive. | Medium | Probably compatible, but not proven with a real `v1.8.2` DB fixture. | `tests/electron/cache.test.js`, JSON migration tests. | Open an actual `v1.8.2` SQLite DB fixture and assert status/bookmarks/thumbs/metadata survive. |
| Thumbnail path compatibility | `v1.8.2` already used cache-mode-aware roots and relative thumbnail rows. `main` still loads relative paths via `thumbAbsolute` and keeps legacy `.video-cull-thumbs` migration. | Medium | Basic compatibility likely, but stale `thumb://` immutable caching and broad active cache roots remain. | Cache thumbnail round-trip tests. | `v1.8.2` DB with existing thumbnail rows, regeneration URL/cache invalidation test. |
| Metadata persistence | New metadata fields are additive. Old `duration_secs`, `metadata_date`, codec/resolution fields are loaded and preserved with `COALESCE`. | Medium | Upgrade should preserve old values, but new ffprobe failure backoff is ineffective because failures are swallowed. | Cache round-trip tests include metadata fields. | Upgrade fixture with stale/partial metadata; ffprobe failure should set `metadata_failed_at`. |
| Duplicate/fingerprint persistence | No `v1.8.2` fingerprint data exists, so initial upgrade starts empty. New persistent fingerprints are not keyed by sampling/source settings. | High | First run is safe from old data, later duplicate setting changes are unsafe. | Duplicate tests cover group logic and basic fingerprint row loading. | Fingerprint invalidation by settings/file metadata/source key. |
| Settings migration | `loadSettings` migrates invalid fields and duplicate settings. Cache location settings already existed in `v1.8.2`; migration flow still has target clobber/side-effect risks. | Medium-High | Upgrade settings likely load, but cache-location changes remain risky. | Store settings migration test covers invalid fields and recent pruning. | Exact `v1.8.2` settings fixture, cache migration cancel/no-side-effect test. |
| Recent folders | Recent folders persist through settings. Current tests prune missing recent directories using renderer validation. | Medium | Offline/removable recent folders may disappear from recents, depending on validation result. | Store legacy settings test covers stale recent pruning. | Offline/removable drive should be marked unavailable, not silently pruned. |
| Destructive action behavior | `batch-delete` validates loaded paths and fallback permanent delete is confirmed. Post-`v1.8.2` adds cache artifact removal and empty-folder cleanup. `open-in-explorer` became more permissive. | High | Not safe enough as an upgrade until empty-folder cleanup and reveal fallback are fixed. | `tests/e2e/delete-safety.spec.ts` exists but was not run; helper tests cover current permissive reveal behavior. | Empty-folder TOCTOU test, open-in-explorer outside-root rejection, E2E delete safety run in CI. |

## Finding Provenance and Verification Matrix

### High Findings

| ID | Finding | Verification Status | Delta Classification | Release Blocking? |
|---|---|---|---|---|
| H1 | Renderer-controlled scan paths mint file grants. | Confirmed | Existed before `v1.8.2` | Not a new regression, but still important security debt. |
| H2 | Missing navigation/window-open denial with privileged preload. | Confirmed | Existed before `v1.8.2`; impact increased after because preload API grew. | Harden before release if threat model includes compromised renderer/navigation. |
| H3 | Auto-pruning can delete cache on transient `stat` failures. | Confirmed | Introduced after `v1.8.2` | Yes. User-data loss risk. |
| H4 | Cache migration can clobber or partially move targets. | Confirmed | Existed before `v1.8.2` | Upgrade risk remains high, but not new in `main`. |
| H5 | Thumbnail cancellation token is broken. | Confirmed | Introduced after `v1.8.2` | Yes. Stale writes and runaway FFmpeg risk. |
| H6 | Superseded scans and metadata cancellation keep doing work. | Confirmed | Partially introduced after `v1.8.2`: scan no-abort existed; metadata pipeline/cancel path is new. | Yes for metadata; scanner should also be fixed. |
| H7 | Fingerprint cache ignores sampling settings/source changes. | Confirmed | Introduced after `v1.8.2` | Yes. Duplicate correctness and persistence risk. |
| H8 | Visual duplicate semantics change at 5,000 candidates. | Confirmed | Introduced after `v1.8.2` | Yes for duplicate reliability. |
| H9 | New folder sessions keep old videos/delete UI active during scan. | Confirmed | Existed before `v1.8.2` | Not new, but still destructive-action UX debt. |

### Medium Findings

| ID | Finding | Verification Status | Delta Classification | Release Blocking? |
|---|---|---|---|---|
| M1 | ffprobe failures are swallowed and retried forever. | Confirmed | Introduced after `v1.8.2` for the metadata failure-backoff path. | Yes for large/offline libraries. |
| M2 | `video://` lacks realpath loaded-root revalidation. | Confirmed | Introduced after `v1.8.2`; old handler used `isPathWithinAnyDir`. | Yes. Protocol authorization regression. |
| M3 | `thumb://` serves any `.jpg` under active cache roots. | Confirmed | Existed before `v1.8.2` | Not new; hardening debt. |
| M4 | `open-in-explorer` allows arbitrary existing paths. | Confirmed | Introduced after `v1.8.2`; old handler denied outside loaded roots. | Yes. Shell/reveal authorization regression. |
| M5 | Empty-folder cleanup has destructive TOCTOU race. | Confirmed | Introduced after `v1.8.2` | Yes. Destructive filesystem regression. |
| M6 | Cache path resolution creates directories as a side effect. | Confirmed | Existed before `v1.8.2` | Upgrade risk, but not new. |
| M7 | `process-metadata` and `generate-thumbnails` lack top-level array validation. | Confirmed | Partially introduced after `v1.8.2`: thumbnail handler pre-existed; metadata handler is new. | Fix with low effort before release. |
| M8 | Saving processing settings can trigger a full rescan. | Confirmed | Introduced/worsened after `v1.8.2`; `handleScan` gained more processing-setting dependencies. | Yes for mounted-drive UX/perf. |
| M9 | Overlapping loaded roots duplicate files in state. | Confirmed | Existed before `v1.8.2` | Not new; data/state correctness debt. |
| M10 | Duplicate filters can hide selected videos that still get marked. | Confirmed | Introduced after `v1.8.2` | Yes for duplicate review safety. |
| M11 | Disabling duplicates while in duplicate mode can trap user. | Confirmed | Introduced after `v1.8.2` | Medium release risk. |
| M12 | Deleting videos leaves stale review/duplicate state. | Confirmed | Partially introduced after `v1.8.2`; duplicate annotations and active review path are new. | Yes for stale path/destructive UI. |
| M13 | Regenerated or failed thumbnails can reuse stale/broken files. | Partially confirmed | Existed before `v1.8.2`; force-regeneration path increases visibility. | Needs targeted repro before blocking. |
| M14 | Duplicate group IDs are unstable across runs. | Confirmed | Introduced after `v1.8.2` | Medium release risk. |
| M15 | Visual duplicate mode has avoidable O(n^2) and memory pressure. | Confirmed | Introduced after `v1.8.2` | Medium release risk for large libraries. |
| M16 | Hidden grid recomputes during review mode. | Confirmed | Introduced after `v1.8.2`; old app unmounted grid in review mode. | Medium perf risk. |
| M17 | Offline distributed cache paths are dropped at startup. | Confirmed | Existed before `v1.8.2` | Upgrade risk for removable drives, but not new. |

## Critical Findings

No Critical finding was proven from repository contents alone. The High post-`v1.8.2` findings below are release-blocking because they can lose user data, widen filesystem access, or corrupt duplicate decisions.

## High Priority Findings

### H1. Renderer-Controlled Scan Paths Mint File Grants

| Field | Detail |
|---|---|
| Severity | High |
| Category | Security / Destructive Operation |
| Verification | Confirmed |
| Delta Since `v1.8.2` | Existed before `v1.8.2` |
| Location | [`electron/main.js`](electron/main.js) `scan-directory`, `batch-delete`, `video://` |

**Problem**

`scan-directory` accepts a renderer-supplied directory string, then populates `currentScanDirs` and `knownVideoPaths`. Those sets authorize later streaming, opening, revealing, metadata, thumbnails, and deletion.

**Why It Matters**

A compromised renderer or renderer bug can turn any existing directory into a trusted media root, then operate on files inside it. This is especially risky because permanent delete fallback exists.

**Evidence From Code**

- Current `main`: `scan-directory` receives `dirPath` directly from IPC and later adds scanned paths to `knownVideoPaths`.
- `v1.8.2`: the same grant model existed. `knownVideoPaths` was also populated on `scan-directory`.

**Suggested Fix**

Make the main process own path grants. Only accept roots selected through main-process dialogs or persisted trusted grants. Use opaque root IDs/tokens for follow-up IPC instead of trusting raw renderer paths.

**Suggested Test**

Invoke `scan-directory` with an existing but ungranted temp directory and assert rejection. Then grant via `select-directory` and assert scan succeeds.

### H2. Untrusted Navigation Can Inherit the Privileged Preload API

| Field | Detail |
|---|---|
| Severity | High |
| Category | Security |
| Verification | Confirmed |
| Delta Since `v1.8.2` | Existed before `v1.8.2`; impact increased because `electronAPI` grew |
| Location | [`electron/main.js`](electron/main.js) `createWindow`, [`electron/preload.js`](electron/preload.js), [`index.html`](index.html) |

**Problem**

The `BrowserWindow` has a broad `window.electronAPI`, but no `setWindowOpenHandler`, `will-navigate`, or `will-attach-webview` denial was found.

**Why It Matters**

If the renderer is navigated to remote content, that page can receive the same preload bridge. This existed in `v1.8.2`, but `main` exposes more APIs: metadata, duplicates, perf diagnostics, app notifications, `openExternalUrl`, and `getPathForFile`.

**Evidence From Code**

- `nodeIntegration: false` and `contextIsolation: true` are set in both versions.
- No explicit navigation/window/webview deny handlers exist in either version.
- Current CSP still includes Google Fonts and localhost dev connect targets.

**Suggested Fix**

Deny new windows, block top-level navigation except packaged app/dev URL, deny webviews, set `sandbox: true` explicitly, and split production CSP from dev CSP.

**Suggested Test**

E2E/main test attempts `window.open()` and `location.href = "https://example.com"` and asserts no navigation and no remote page gets `window.electronAPI`.

### H3. Auto-Pruning Can Delete Cache on Transient `stat` Failures

| Field | Detail |
|---|---|
| Severity | High |
| Category | Regression / Data Integrity |
| Verification | Confirmed |
| Delta Since `v1.8.2` | Introduced after `v1.8.2` |
| Location | [`electron/main-helpers.js`](electron/main-helpers.js) `listMissingDescendantCacheFolders`, [`electron/main.js`](electron/main.js) `pruneMissingDescendantCaches` |

**Problem**

`listMissingDescendantCacheFolders` treats any `statPath` error as missing. `pruneMissingDescendantCaches` then calls `cache.deleteDb`.

**Why It Matters**

`EACCES`, disconnected drives, sleeping network mounts, or slow cloud drives can be interpreted as deleted folders, losing review decisions, metadata, fingerprints, and thumbnails.

**Evidence From Code**

- Current `main`: `pruneMissingDescendantCaches` is called after scan.
- Current helper: all `statPath` errors push the folder into the missing list.
- `v1.8.2`: this descendant auto-prune path was not present.

**Suggested Fix**

Only prune on confirmed `ENOENT`, add a grace period or quarantine, and never delete cache for permission/offline/timeout errors.

**Suggested Test**

Mock `statPath` throwing `EACCES` for a known descendant and assert no DB/thumb deletion.

### H4. Cache Migration Can Clobber or Partially Move Existing Targets

| Field | Detail |
|---|---|
| Severity | High |
| Category | Data Integrity / Destructive Operation |
| Verification | Confirmed |
| Delta Since `v1.8.2` | Existed before `v1.8.2` |
| Location | [`electron/main.js`](electron/main.js) `movePathIfPresent`, `migrateOneCache`, `migrate-cache-settings` |

**Problem**

Migration moves DB, `-wal`, `-shm`, and thumbs independently. Cross-device copy uses `fs.cp(..., { force: true })`; "Start fresh" deletes only source paths, not existing target caches.

**Why It Matters**

Existing target cache data can be overwritten, migration can land in a mixed sidecar state, and "fresh" mode can reuse stale target data when switching back.

**Evidence From Code**

- Current `main`: `migrateOneCache` loops sidecars and thumbs independently.
- `v1.8.2`: the same migration structure and target-root resolution already existed.
- Current cache contents are higher-stakes because metadata failure state and fingerprints were added after `v1.8.2`.

**Suggested Fix**

Refuse or merge when targets exist. Checkpoint/close WAL before migration. Copy into temp, verify, then swap. In "fresh" mode quarantine both source and target cache for known folders.

**Suggested Test**

Pre-create distinct source and target DB/thumb data, migrate, and assert neither target clobbering nor partial sidecar state occurs.

### H5. Thumbnail Cancellation Is Broken

| Field | Detail |
|---|---|
| Severity | High |
| Category | Bug / Regression / Performance |
| Verification | Confirmed |
| Delta Since `v1.8.2` | Introduced after `v1.8.2` |
| Location | [`electron/processor.js`](electron/processor.js) `thumbToken`, `processVideos`, `cancelThumbnails` |

**Problem**

`thumbToken` is declared, but `processVideos` assigns `currentToken = token`. `cancelThumbnails` only flips `thumbToken.cancelled`.

**Why It Matters**

Cancelling, rescanning, or closing can kill active FFmpeg commands while the queue continues to start new work and emit stale `thumb-ready-batch` events.

**Evidence From Code**

- Current `main`: processor split introduced `thumbToken` and `cancelThumbnails`.
- Current `processVideos`: assigns `currentToken = token`, not `thumbToken = token`.
- `v1.8.2`: processor used `currentToken` consistently.

**Suggested Fix**

Assign `thumbToken = token`, clear only if still current, and check cancellation before starting each video and before `onVideoReady`.

**Suggested Test**

Mocked multi-video thumbnail run; call `cancelThumbnails`; assert no further videos start and no ready callbacks fire.

### H6. Superseded Scans and Metadata Cancellation Keep Doing Work

| Field | Detail |
|---|---|
| Severity | High |
| Category | Performance / Data Integrity |
| Verification | Confirmed |
| Delta Since `v1.8.2` | Partially introduced after `v1.8.2` |
| Location | [`electron/scanner.js`](electron/scanner.js) `scanDirectory`, [`electron/main.js`](electron/main.js) `scan-directory`, [`electron/processor.js`](electron/processor.js) `processMetadata` |

**Problem**

`scanDirectory` has no abort signal and serially walks the tree. The main process checks supersession only after scan phases. Metadata cancellation only flips a token and does not kill ffprobe or re-check after awaited probe completion before callbacks.

**Why It Matters**

On large or mounted drives, old scans and probes can continue heavy I/O after the user has moved on, then race stale progress or cache writes into the new session.

**Evidence From Code**

- `v1.8.2`: scanner also had no abort inside recursive walk.
- Current `main`: `ScanSupersededError` was added, but only around main-process phases, not scanner internals.
- Current metadata pipeline is new and can call `onVideoReady` after awaited `readMetadataForVideo`.

**Suggested Fix**

Pass an abort callback/signal into scanner and metadata probe. Check before/after `readdir`, stat batches, ffprobe, and before every callback/write.

**Suggested Test**

Fake a deep tree and slow ffprobe; cancel after first directory/probe starts; assert no deeper stat calls and no metadata-ready callback.

### H7. Fingerprint Cache Ignores Sampling Settings and Source Changes

| Field | Detail |
|---|---|
| Severity | High |
| Category | Bug / Duplicate Detection |
| Verification | Confirmed |
| Delta Since `v1.8.2` | Introduced after `v1.8.2` |
| Location | [`electron/cache.js`](electron/cache.js) `video_fingerprints`, `getFingerprintCounts`; [`electron/duplicates.js`](electron/duplicates.js) sampling/backfill |

**Problem**

`video_fingerprints` is keyed by `(video_id, sample_index)`, while timestamps depend on sample count/window/duration/settings. Cache reuse checks row counts, not the fingerprint generation parameters.

**Why It Matters**

Changing duplicate settings can reuse fingerprints from a different time window, producing false positives or false negatives.

**Evidence From Code**

- Duplicate pipeline and `video_fingerprints` table did not exist in `v1.8.2`.
- Current `getFingerprintCounts` checks counts/flipped counts.
- Current `loadPHashRows` and `loadGraySampleRows` take the first N rows.

**Suggested Fix**

Store a fingerprint source/settings key including file size/mtime/duration/sample window/count/flip mode, and rebuild when it differs.

**Suggested Test**

Run duplicate detection with `sampleCount: 3`, then rerun with `sampleCount: 2` or a custom window and assert fingerprints are rebuilt.

### H8. Visual Duplicate Semantics Change at 5,000 Candidates

| Field | Detail |
|---|---|
| Severity | High |
| Category | Bug / Regression |
| Verification | Confirmed |
| Delta Since `v1.8.2` | Introduced after `v1.8.2` |
| Location | [`electron/visual-worker.js`](electron/visual-worker.js), [`electron/duplicate-utils.js`](electron/duplicate-utils.js) `durationsWithinTolerance` |

**Problem**

Below 5,000 candidates, visual mode uses all-pairs comparison and `durationsWithinTolerance` returns true if either duration is unknown. At 5,000+, bucketing avoids known-vs-unknown comparisons.

**Why It Matters**

Duplicate results depend on library size. A known-duration and unknown-duration video can match below the threshold but not above it.

**Evidence From Code**

- `visual-worker.js` did not exist in `v1.8.2`.
- Current `BUCKET_ACTIVATION_THRESHOLD = 5000`.
- Current all-pairs path calls `durationsWithinTolerance`.

**Suggested Fix**

Use the bucketed candidate generator for all visual runs, or explicitly skip known-vs-unknown duration pairs.

**Suggested Test**

Visual-worker parity test: known duration vs unknown duration should produce zero compared pairs below and above 5,000 candidates.

### H9. New Folder Sessions Keep Old Videos and Delete UI Active During Scan

| Field | Detail |
|---|---|
| Severity | High |
| Category | Bug / UI/UX / Destructive Operation |
| Verification | Confirmed |
| Delta Since `v1.8.2` | Existed before `v1.8.2` |
| Location | [`src/store.ts`](src/store.ts) `setDirectory`, [`src/App.tsx`](src/App.tsx), [`src/components/Sidebar.tsx`](src/components/Sidebar.tsx) |

**Problem**

`setDirectory(non-null)` changes folder state but does not clear old `videos`, `filteredVideos`, or stats before the new scan resolves.

**Why It Matters**

Users can see old cards and old marked-delete counts while a new folder is scanning, making destructive actions ambiguous.

**Evidence From Code**

- Current `setDirectory(non-null)` does not clear videos.
- `v1.8.2` behaved similarly.
- Current duplicate/review state increases the number of stale-state surfaces.

**Suggested Fix**

Quarantine or clear previous session state when a new root scan starts, and disable destructive actions while a new-session scan is pending.

**Suggested Test**

Load marked-delete videos, select a different folder with delayed scan, assert old delete controls are hidden or disabled.

## Medium Priority Findings

### M1. ffprobe Failures Are Swallowed and Retried Forever

| Field | Detail |
|---|---|
| Severity | Medium |
| Category | Bug / Performance |
| Verification | Confirmed |
| Delta Since `v1.8.2` | Introduced after `v1.8.2` for metadata failure backoff |
| Location | [`electron/processor.js`](electron/processor.js) `readMetadataForVideo`, `processMetadata`; [`src/App.tsx`](src/App.tsx) metadata refresh |

**Problem**

`readMetadataForVideo` catches probe errors and returns cached/null metadata, so `processMetadata` treats failures as success.

**Why It Matters**

Corrupt, offline, or unsupported files are probed every scan and failure backoff is bypassed.

**Evidence From Code**

- `v1.8.2` had ffprobe inside thumbnail generation and swallowed some failures, but did not have the new metadata failure-backoff system.
- Current main has metadata failure tracking, but processor does not propagate normal ffprobe failures to `onVideoFailed`.

**Suggested Fix**

Return structured failure or throw on probe failure. Only clear failure markers after writing current metadata.

**Suggested Test**

Mock ffprobe rejection; assert `markMetadataFailure` is called and next non-force run skips recent failure.

### M2. `video://` Uses Stale Known-Path Membership Without Realpath Revalidation

| Field | Detail |
|---|---|
| Severity | Medium |
| Category | Security |
| Verification | Confirmed |
| Delta Since `v1.8.2` | Introduced after `v1.8.2` |
| Location | [`electron/main-helpers.js`](electron/main-helpers.js) `canServeVideoPath`, [`electron/main.js`](electron/main.js) `video://` |

**Problem**

`canServeVideoPath` checks exact `knownVideoPaths` membership and extension, then streams the path.

**Why It Matters**

A scanned file can be replaced with a symlink/reparse point escaping the loaded root.

**Evidence From Code**

- `v1.8.2` `video://` checked `isPathWithinAnyDir(filePath, currentScanDirs)`, which follows realpaths.
- Current `video://` uses `canServeVideoPath` and no current loaded-root realpath check.

**Suggested Fix**

Make `video://` validation async and require current realpath containment, `lstat`/`stat` file checks, and opened-handle streaming.

**Suggested Test**

Scan `clip.mp4`, replace it with symlink to outside root, assert `video://` returns 403.

### M3. `thumb://` Serves Any `.jpg` Under Active Cache Roots

| Field | Detail |
|---|---|
| Severity | Medium |
| Category | Security / Privacy |
| Verification | Confirmed |
| Delta Since `v1.8.2` | Existed before `v1.8.2` |
| Location | [`electron/main-helpers.js`](electron/main-helpers.js) `canServeThumbPath`, [`electron/main.js`](electron/main.js) active cache roots |

**Problem**

Thumbnail serving checks `.jpg` and containment under active cache roots, not known thumbnail rows or expected thumb subdirectories.

**Why It Matters**

If cache root is broad or a DB row is stale/poisoned, renderer can load unrelated JPEGs through the app protocol.

**Evidence From Code**

`v1.8.2` also served `.jpg` files inside active cache roots; current code extracted this into `canServeThumbPath`.

**Suggested Fix**

Serve only known DB thumbnail rows or `thumbRootDir/<valid-id>/thumb_NN.jpg`; reject drive roots/home folders as cache roots.

**Suggested Test**

Active cache root `D:\`; request `D:\photos\private.jpg`; assert 403.

### M4. `open-in-explorer` Allows Arbitrary Existing Paths

| Field | Detail |
|---|---|
| Severity | Medium |
| Category | Security / Privacy |
| Verification | Confirmed |
| Delta Since `v1.8.2` | Introduced after `v1.8.2` |
| Location | [`electron/main-helpers.js`](electron/main-helpers.js) `canRevealInExplorerPath`, [`electron/main.js`](electron/main.js) `open-in-explorer` |

**Problem**

After known/loaded checks, `canRevealInExplorerPath` falls back to allowing any existing file or directory.

**Why It Matters**

The renderer can reveal arbitrary local/UNC paths and gets an existence oracle.

**Evidence From Code**

- `v1.8.2`: `open-in-explorer` allowed only known paths or paths inside current scan dirs.
- Current helper returns true for any `statPath` file/directory.
- Current tests codify this permissive behavior.

**Suggested Fix**

Remove the fallback or restrict it to main-owned recent directories selected by dialog.

**Suggested Test**

Reject `C:\Windows`, arbitrary temp paths, and UNC paths unless granted.

### M5. Empty-Folder Cleanup Has a Destructive TOCTOU Race

| Field | Detail |
|---|---|
| Severity | Medium |
| Category | Destructive Operation |
| Verification | Confirmed |
| Delta Since `v1.8.2` | Introduced after `v1.8.2` |
| Location | [`electron/main.js`](electron/main.js) `trashEmptyDeletedVideoFolders` |

**Problem**

`trashEmptyDeletedVideoFolders` checks `readdir`, then trashes/removes the directory later.

**Why It Matters**

A sync/camera/copy process can create a new file between the emptiness check and folder trash.

**Evidence From Code**

`trashEmptyDeletedVideoFolders` was added after `v1.8.2` and is called after batch delete success paths.

**Suggested Fix**

Skip automatic empty-folder trash by default, or only use atomic `fs.rmdir` and leave non-empty folders alone.

**Suggested Test**

Mock `readdir` empty, create a file before `trashItem`, assert no folder trash occurs.

### M6. Cache Path Resolution Creates Directories as a Side Effect

| Field | Detail |
|---|---|
| Severity | Medium |
| Category | Data Integrity / UX |
| Verification | Confirmed |
| Delta Since `v1.8.2` | Existed before `v1.8.2` |
| Location | [`electron/cache.js`](electron/cache.js) `resolveCachePaths`, [`electron/main.js`](electron/main.js) cache migration/validation |

**Problem**

`resolveCachePaths` calls `mkdirSync`. Migration and validation paths can create cache directories before the user confirms.

**Why It Matters**

Selecting distributed/per-drive modes can create hidden `.videocull` or target roots even if the user cancels migration.

**Evidence From Code**

The same `mkdirSync` side effect existed in `v1.8.2`.

**Suggested Fix**

Split pure path calculation from `ensureCacheDirs`. Only create after explicit confirmation and just before writes.

**Suggested Test**

Choose distributed migration then cancel; assert no `.videocull` directory was created.

### M7. `process-metadata` and `generate-thumbnails` Lack Top-Level Array Validation

| Field | Detail |
|---|---|
| Severity | Medium |
| Category | IPC Input Validation |
| Verification | Confirmed |
| Delta Since `v1.8.2` | Partially introduced after `v1.8.2` |
| Location | [`electron/main.js`](electron/main.js) `process-metadata`, `generate-thumbnails` |

**Problem**

Both handlers call `videos.filter` before proving `videos` is an array.

**Why It Matters**

Malformed IPC can throw in the main handler, unlike `find-duplicates`, which validates arrays first.

**Evidence From Code**

- `generate-thumbnails` lacked this check in `v1.8.2`.
- `process-metadata` is new after `v1.8.2` and repeats the pattern.

**Suggested Fix**

Add `if (!Array.isArray(videos)) return false;` before filtering, plus size limits for large payloads.

**Suggested Test**

Invoke each handler with `null`, object, string, and oversized arrays.

### M8. Saving Processing Settings Can Trigger an Unexpected Full Rescan

| Field | Detail |
|---|---|
| Severity | Medium |
| Category | Bug / UI/UX / Performance |
| Verification | Confirmed |
| Delta Since `v1.8.2` | Introduced/worsened after `v1.8.2` |
| Location | [`src/App.tsx`](src/App.tsx) `handleScan` effect, [`src/components/SettingsModal.tsx`](src/components/SettingsModal.tsx) settings save |

**Problem**

The auto-scan effect depends on `handleScan`, and `handleScan` now depends on settings such as thumbnail count and intro skip.

**Why It Matters**

Saving preferences can rescan large mounted folders, despite UI copy saying changes apply on next run/regeneration.

**Evidence From Code**

- `v1.8.2` `handleScan` dependencies were narrower.
- Current `handleScan` dependencies include more processing settings because of metadata/thumb orchestration.

**Suggested Fix**

Make scan effect depend on directory identity or explicit rescan triggers. Keep mutable settings in refs for the current callback.

**Suggested Test**

Loaded directory, save `thumbsPerVideo`, assert `scanDirectory` is not called.

### M9. Overlapping Loaded Roots Can Duplicate the Same Files

| Field | Detail |
|---|---|
| Severity | Medium |
| Category | Bug / Data Integrity |
| Verification | Confirmed |
| Delta Since `v1.8.2` | Existed before `v1.8.2` |
| Location | [`src/store.ts`](src/store.ts) directory add flow, [`src/App.tsx`](src/App.tsx) scan flattening |

**Problem**

Directory de-dupe is exact-match only. Parent/child loaded roots can scan the same files twice.

**Why It Matters**

Duplicate video IDs/paths can corrupt counts, status updates, duplicate grouping, and delete-all behavior.

**Evidence From Code**

Multi-directory sessions existed in `v1.8.2`, and exact-only root de-dupe existed then too.

**Suggested Fix**

Reject parent/child overlaps or de-dupe scan results by normalized path before `setVideos`.

**Suggested Test**

Add root and child containing same video; assert state has one video and warns.

### M10. Duplicate Filters Can Hide Selected Videos That Still Get Marked

| Field | Detail |
|---|---|
| Severity | Medium |
| Category | UI/UX / Destructive Workflow |
| Verification | Confirmed |
| Delta Since `v1.8.2` | Introduced after `v1.8.2` |
| Location | [`src/components/DuplicateGroupsView.tsx`](src/components/DuplicateGroupsView.tsx) `selectedIds`, `markSelectedDuplicates` |

**Problem**

Selected duplicate IDs are local state, while visible groups are filtered separately. `markSelectedDuplicates` acts on all selected IDs still in `videosById`.

**Why It Matters**

Users can mark hidden duplicate videos for deletion after filtering.

**Evidence From Code**

`DuplicateGroupsView` did not exist in `v1.8.2`. Current selection is not pruned on filter/sort/group changes.

**Suggested Fix**

Prune selection to visible IDs or show a hidden-selection count and restrict action scope.

**Suggested Test**

Select across two groups, filter to one, mark selected, assert hidden group remains pending.

### M11. Disabling Duplicates While in Duplicate Mode Can Trap the User

| Field | Detail |
|---|---|
| Severity | Medium |
| Category | UI/UX / Bug |
| Verification | Confirmed |
| Delta Since `v1.8.2` | Introduced after `v1.8.2` |
| Location | [`src/components/Sidebar.tsx`](src/components/Sidebar.tsx), [`src/App.tsx`](src/App.tsx) duplicate mode rendering |

**Problem**

When duplicate mode is active and duplicates are disabled in settings, Sidebar can return `null` while App still renders duplicate mode.

**Why It Matters**

The "Back to Grid" escape hatch disappears.

**Evidence From Code**

Duplicate mode did not exist in `v1.8.2`. Current Back-to-grid button is inside the duplicate-enabled sidebar branch.

**Suggested Fix**

Force `duplicateGroupsMode: false` when disabling duplicates, or always render an escape control.

**Suggested Test**

Enable duplicate mode, disable duplicates, assert grid is reachable.

### M12. Deleting Videos Leaves Stale Review and Duplicate State

| Field | Detail |
|---|---|
| Severity | Medium |
| Category | Bug / State Integrity |
| Verification | Confirmed |
| Delta Since `v1.8.2` | Partially introduced after `v1.8.2` |
| Location | [`src/store.ts`](src/store.ts) `removeDeletedVideos`, [`src/App.tsx`](src/App.tsx) review menu actions |

**Problem**

`removeDeletedVideos` prunes videos/groups but does not fully re-clamp `reviewScopeIds`, `reviewIndex`, `activeReviewVideoPath`, or reapply duplicate annotations after dropped groups.

**Why It Matters**

Reveal/play can target stale review paths, and singleton videos can keep stale `duplicateGroupId`/keeper flags.

**Evidence From Code**

- `v1.8.2` already did not clamp review state on delete.
- Current `activeReviewVideoPath` and duplicate annotations are new after `v1.8.2`, increasing the stale-state impact.

**Suggested Fix**

Prune review scope, clamp index, clear active path if removed, and run `applyDuplicateGroupsToVideos` after group pruning.

**Suggested Test**

Delete active review video and last member of a duplicate group; assert active path clears and remaining videos have no stale duplicate fields.

### M13. Regenerated or Failed Thumbnails Can Reuse Stale/Broken Files

| Field | Detail |
|---|---|
| Severity | Medium |
| Category | Bug / Cache Integrity |
| Verification | Partially confirmed |
| Delta Since `v1.8.2` | Existed before `v1.8.2`; force-regeneration path increases visibility |
| Location | [`electron/main.js`](electron/main.js) `thumb://`, [`electron/processor.js`](electron/processor.js) thumbnail generation, [`src/components/ThumbnailStrip.tsx`](src/components/ThumbnailStrip.tsx) |

**Problem**

`thumb://` responses are cached as immutable for a day, thumbnails are written directly to final paths, and reuse checks count filenames rather than validating images.

**Why It Matters**

Regeneration may keep showing old thumbnails, and killed FFmpeg jobs can leave partial JPEGs that later satisfy the count check.

**Evidence From Code**

The immutable cache header existed in `v1.8.2`. The partial-file outcome should be reproduced with a killed FFmpeg process before treating this as a release blocker.

**Suggested Fix**

Write temp files then atomic rename. Validate generated files. Add mtime/version query or generation directory.

**Suggested Test**

Corrupt `thumb_01.jpg`, rerun generation, assert it regenerates and the rendered URL changes or refetches.

### M14. Duplicate Group IDs Are Unstable Across Runs

| Field | Detail |
|---|---|
| Severity | Medium |
| Category | Bug / Duplicate Detection |
| Verification | Confirmed |
| Delta Since `v1.8.2` | Introduced after `v1.8.2` |
| Location | [`electron/duplicates.js`](electron/duplicates.js) `buildGroups` |

**Problem**

Group IDs are assigned as `dup-${groupIndex++}` before final ordering.

**Why It Matters**

Adding an unrelated stronger group can renumber existing groups, breaking UI state and manual keeper/undo assumptions.

**Evidence From Code**

Duplicate groups did not exist in `v1.8.2`. Current IDs are sequential, not derived from member IDs.

**Suggested Fix**

Derive IDs from sorted member IDs, for example a short hash of `videoIds.sort().join('|')`.

**Suggested Test**

Build A/B group, then add C/D group with higher similarity; assert A/B keeps the same ID.

### M15. Visual Duplicate Mode Has Avoidable O(n^2) and Memory Pressure

| Field | Detail |
|---|---|
| Severity | Medium |
| Category | Performance |
| Verification | Confirmed |
| Delta Since `v1.8.2` | Introduced after `v1.8.2` |
| Location | [`electron/visual-worker.js`](electron/visual-worker.js), [`electron/duplicates.js`](electron/duplicates.js) visual comparison data loading |

**Problem**

Visual mode does full all-pairs comparison below 5,000 candidates, loads gray BLOB rows into the main process, clones them into workers, and accumulates pair objects.

**Why It Matters**

Large libraries can spike CPU and memory before reaching the bucket threshold.

**Evidence From Code**

Visual duplicate detection was added after `v1.8.2`; bucket activation threshold is fixed at 5,000.

**Suggested Fix**

Always bucket/window visual candidates and return union/group summaries rather than every matching pair where possible.

**Suggested Test**

Many different-duration videos below 5,000 should compare only eligible bucketed pairs.

### M16. Hidden Grid Still Recomputes During Review Mode

| Field | Detail |
|---|---|
| Severity | Medium |
| Category | Performance |
| Verification | Confirmed |
| Delta Since `v1.8.2` | Introduced after `v1.8.2` |
| Location | [`src/App.tsx`](src/App.tsx) grid visibility, [`src/components/GridMode.tsx`](src/components/GridMode.tsx) subscriptions |

**Problem**

Grid remains mounted with hidden visibility; it still subscribes to full `videos`/`filteredVideos` and rebuilds rows/maps on decisions.

**Why It Matters**

Review mode on 10k+ videos pays grid costs even when the grid is invisible.

**Evidence From Code**

`v1.8.2` only rendered `GridMode` when `!reviewMode`. Current code keeps it mounted and hidden.

**Suggested Fix**

Freeze grid subscriptions while hidden or preserve scroll state without keeping the full grid reactive.

**Suggested Test**

10k videos in review mode, mark keep/delete, assert hidden grid row/map builders do not run.

### M17. Offline Distributed Cache Paths Are Dropped at Startup

| Field | Detail |
|---|---|
| Severity | Medium |
| Category | Data Integrity / Cache Maintenance |
| Verification | Confirmed |
| Delta Since `v1.8.2` | Existed before `v1.8.2` |
| Location | [`electron/main.js`](electron/main.js) `pruneDistributedIndex` |

**Problem**

`pruneDistributedIndex` removes every distributed path whose `fs.stat` fails.

**Why It Matters**

Offline removable/network drives lose tracking, so later migration/cleanup can miss existing `.videocull` caches.

**Evidence From Code**

The same startup pruning existed in `v1.8.2`.

**Suggested Fix**

Mark entries unavailable with `lastSeen` and prune only after explicit user action or long TTL.

**Suggested Test**

Seed distributed index, make one path throw `EACCES`, assert it remains marked unavailable.

## Low Priority / Cleanup Findings

| ID | Finding | Delta Classification | Note |
|---|---|---|---|
| L1 | Production CSP still allows remote fonts and dev connect targets. | Existed before `v1.8.2` in broad form; current dependency/runtime upgrade makes hardening worthwhile. | Bundle fonts or use system fonts; split dev/prod CSP. |
| L2 | Destructive confirmation language is inconsistent. | Partially changed after `v1.8.2` with duplicate/delete UI changes. | Use one destructive confirmation path. |
| L3 | Duplicate "best size" UI conflicts with keeper logic. | Introduced after `v1.8.2`. | Align label or keeper metric. |
| L4 | Shortcut conflicts are warned but still savable. | Mostly existed before; global mute behavior added after. | Block conflicts or define precedence. |
| L5 | IPC listener effect is coupled to shortcut help state. | Introduced/worsened after `v1.8.2`. | Split IPC subscriptions from keyboard state. |

## Electron Security Review

| Area | Assessment |
|---|---|
| BrowserWindow options | `nodeIntegration: false` and `contextIsolation: true` are present in both `v1.8.2` and `main`. `sandbox` is not explicit. `backgroundThrottling: false` was added after `v1.8.2`. |
| Preload API surface | `v1.8.2` exposed scan/cache/delete/update APIs. `main` adds metadata, duplicate detection, perf diagnostics, app notifications, `openExternalUrl`, and `getPathForFile`. The broader bridge raises the impact of missing navigation denial. |
| IPC input validation | Improved in some places after `v1.8.2` (`open-video` now uses loaded-path validation, duplicate detection validates array input). Regressed or incomplete in others (`scan-directory` grant model, `process-metadata` array validation). |
| Custom protocols | `thumb://` broad cache-root behavior existed before. `video://` regressed after `v1.8.2` by replacing loaded-root realpath validation with known-path membership. |
| Path traversal / symlink risk | Delete/open paths are stronger than `v1.8.2` in some flows, but `video://` is weaker against symlink replacement. |
| Destructive filesystem operations | `batch-delete` validation remains useful. Post-`v1.8.2` empty-folder cleanup adds a destructive race. |
| `shell.openExternal` / `shell.openPath` | `openExternalUrl` was added after `v1.8.2` and is allowlisted. `openVideo` improved. `open-in-explorer` regressed by allowing arbitrary existing paths. |
| Remote content | Google Fonts remain. CSP still permits localhost dev connect targets in production HTML. |
| CSP | Exists, but should be production-specific and narrower. |
| Updater risk | `electron-updater` remains GitHub based. Runtime upgraded from Electron 32 to 41. Packaged updater behavior was not tested. |
| Dependency risk | Major runtime upgrades happened after `v1.8.2`. No live advisory scan was run due restricted network. |

## Destructive Operation Safety Review

| Operation | `v1.8.2` Behavior | `main` Behavior | Assessment |
|---|---|---|---|
| Batch delete | Validated known/loaded paths and used Recycle Bin with permanent fallback confirmation. | Still validates, also removes cache artifacts and tries empty-folder cleanup. | Post-`v1.8.2` empty-folder cleanup is the main regression. |
| Trash behavior | File trash fallback confirmation existed. | Same general flow, more cache cleanup. | File fallback is acceptable; folder cleanup is not. |
| Empty folder trash/removal | Not found in `v1.8.2`. | Added `trashEmptyDeletedVideoFolders`. | Regression risk. Make opt-in or remove. |
| Cache clearing | Cache modes and migration existed. | Similar, but more data types now exist in DB. | Higher data-loss impact after fingerprints/metadata fields. |
| Cache migration | Existing target clobber risk already existed. | Still present; source settings now read from persisted config. | Not new, but should be fixed before upgrade release. |
| Report export | Existed before. | Export accepts multiple roots now. | No new blocking issue found. |
| Open/reveal/play external | `open-video` only checked known path; reveal checked known or loaded root. | `open-video` improved; reveal regressed with existing-path fallback. | Fix reveal before release. |
| Stale known-path state | Existed. | More stale state surfaces due metadata/duplicates/review active path. | Needs state cleanup tests. |
| Renderer-provided path trust | Existed. | Still present. | Not a new regression, but remains trust-boundary debt. |

## Performance Review

Ranked by expected gain versus implementation effort, with regression focus.

| Rank | Area | Delta Since `v1.8.2` | Expected Gain | Effort | Notes |
|---:|---|---|---:|---:|---|
| 1 | Fix thumbnail/metadata cancellation | Introduced after | High | Low-Med | Stops stale FFmpeg/ffprobe work and stale UI batches. |
| 2 | Add scanner abort signal | Pre-existing, but supersession added after | High | Med | Biggest mounted-drive improvement. |
| 3 | Prevent settings-triggered rescans | Worsened after | High | Low | Avoids surprise full rescans. |
| 4 | ffprobe failure backoff | Introduced after | High | Low-Med | Avoids retry storms on bad/offline files. |
| 5 | Always bucket visual duplicate candidates | Introduced after | High | Med | Reduces CPU/memory and fixes semantic threshold. |
| 6 | Fingerprint settings/source key | Introduced after | High | Med | Correctness and avoids wrong duplicate reuse. |
| 7 | Freeze hidden grid during review | Introduced after | Medium | Med | Helps large review sessions. |
| 8 | De-dupe overlapping roots | Pre-existing | Medium | Low | Prevents duplicated state and extra work. |
| 9 | Narrow thumbnail protocol/cache invalidation | Pre-existing | Medium | Low-Med | Prevents stale images and broad cache reads. |
| 10 | Split IPC listener effect | Worsened after | Low | Low | Cleanup with minor perf benefit. |

## UI/UX Improvement Opportunities

Ranked by practical value and release relevance:

1. Clear or quarantine old session state while a new folder scan is pending. Pre-existing, but more dangerous with duplicate/review state.
2. Remove or make opt-in empty-folder cleanup. This is a post-`v1.8.2` destructive behavior change.
3. Make duplicate selections visibly scoped; never act on hidden selected IDs silently. New after `v1.8.2`.
4. Always provide a duplicate-mode escape hatch, even when duplicate detection is disabled. New after `v1.8.2`.
5. Show skipped/inaccessible folder counts and sample paths after scan. Pre-existing gap, important for mounted drives.
6. Use one explicit destructive confirmation with count, size, affected roots, recycle-bin fallback, and empty-folder behavior.
7. Block shortcut conflicts instead of only warning.
8. Make cache migration wording match actual behavior and avoid creating folders before confirmation.
9. Add "what happened" feedback for metadata/thumbnail failures and retry backoff.
10. Surface mounted-drive/offline cache status rather than pruning silently.

## Regression Risk Areas

Recent commits most likely tied to post-`v1.8.2` risks:

| Commit | Area | Regression Risk |
|---|---|---|
| `25e3d7a fix: disable background throttling during thumbnail generation` | Thumbnail generation | Makes broken cancellation more expensive because background thumbnail work keeps running. |
| `8431894 feat: auto-clean stale cache after scans` | Cache pruning | Introduced the high-risk descendant cache pruning path. |
| `916eef3 feat: prune missing subfolder caches and remove library UI remnants` | Cache pruning / UI simplification | Adjacent cache pruning risk. |
| `c82deb9 perf: improve scanner traversal throughput` | Scanner | Scanner still serially recurses and has no cancellation; performance changes need mounted-drive tests. |
| `f5edad9 perf: reduce cache and duplicate startup overhead` | Cache and duplicate startup | Fingerprint/cache reuse is a correctness regression risk. |
| `9fb111f perf: reduce grid, review, and sidebar recomputation` | Renderer perf | Hidden grid and broad subscription behavior are future regression areas. |
| `47c06c5 perf: reduce renderer rerender fan-out` | Renderer perf | State derivation and invalidation need regression tests around review/delete/duplicates. |

## Missing Tests

### Release-Blocking Tests to Add First

- `v1.8.2` SQLite DB fixture upgrade test:
  - Open a real `v1.8.2` DB.
  - Assert status, bookmarks, metadata, thumbnails, and relative paths survive.
  - Assert new columns/table are added without data loss.
- Cache prune transient failure test:
  - `statPath` throws `EACCES` or simulated offline error.
  - Assert no DB/thumb deletion.
- Thumbnail cancellation test:
  - Start mocked multi-video thumbnail run.
  - Call `cancelThumbnails`.
  - Assert no later video starts and no ready batch fires.
- `video://` symlink escape test:
  - Scan file, replace with symlink/reparse escape, assert 403.
- `open-in-explorer` outside-root rejection test:
  - Reject arbitrary temp/system/UNC paths unless granted.
- Empty-folder cleanup TOCTOU test:
  - Folder becomes non-empty between `readdir` and trash; assert no folder trash.
- Fingerprint settings/source invalidation test:
  - Run duplicate detection with one sampling config, rerun with another, assert rebuild.
- Visual worker known/unknown duration parity test:
  - Below and above 5,000 candidates should have the same eligibility semantics.

### Other Concrete Tests

- Main-process IPC grant tests for `scan-directory`, `batch-delete`, `open-video`, and `open-in-explorer`.
- `thumb://` serving only known thumb paths.
- Cache migration target-clobber and sidecar partial-move tests.
- Metadata cancellation after awaited probe.
- ffprobe failure should set `metadata_failed_at`.
- Scanner abort/superseded traversal and inaccessible directory reporting.
- Stable duplicate group ID test.
- Renderer tests for hidden duplicate selection, duplicate-mode escape, settings-save no-rescan, overlapping directories, and stale active review path.
- E2E tests for upgrade from seeded `v1.8.2` userData/cache, delete-all-marked, undo, cache migration cancel, and duplicate review.

## Recommended Fix Order

### Stage 1 - Release-Blocking Post-`v1.8.2` Regressions

1. Fix cache auto-prune so only confirmed `ENOENT` can prune, preferably with quarantine/grace period.
2. Fix thumbnail token assignment and metadata cancellation checks.
3. Restore `video://` realpath loaded-root validation.
4. Remove `open-in-explorer` arbitrary existing-path fallback.
5. Remove or make opt-in empty-folder cleanup.
6. Add fingerprint source/settings invalidation.
7. Normalize visual duplicate candidate generation below/above 5,000.

Required tests before/after:

- Cache prune transient failure.
- Thumbnail/metadata cancellation.
- Protocol symlink.
- Reveal outside-root rejection.
- Empty-folder cleanup race.
- Fingerprint settings invalidation.
- Visual duration parity.

### Stage 2 - Upgrade Safety from `v1.8.2`

1. Add exact `v1.8.2` DB and settings fixtures.
2. Prove cache schema upgrade preserves decisions, bookmarks, metadata, and thumbnails.
3. Prove cache migration cancel has no filesystem side effects.
4. Prove recent folders on offline/removable drives are not silently lost.
5. Run E2E upgrade smoke with seeded `v1.8.2` userData.

### Stage 3 - High-Value Bug Fixes

1. Propagate ffprobe failures into metadata backoff.
2. Prevent settings-save full rescans.
3. Clear/quarantine new-session state during pending scan.
4. Prune duplicate selection to visible items.
5. Clear active review path and duplicate annotations after delete.
6. Stabilize duplicate group IDs.

### Stage 4 - Performance and Maintainability

1. Add scanner abort signal and then bounded directory concurrency.
2. Freeze hidden grid subscriptions in review mode.
3. Write thumbnails to temp files and atomic rename.
4. Split IPC listener effect from shortcut-help state.
5. Split pure cache path resolution from directory creation.

## Open Questions

1. Should drag-and-drop paths be trusted the same as dialog-selected paths, or should both become explicit main-issued grants?
2. Should VideoCull ever automatically trash empty source folders, or should that be a separate opt-in cleanup command?
3. Must distributed `.videocull` caches survive long-term offline/removable drives without pruning?
4. In duplicate detection, should unknown-duration videos be compared visually at all, or only after metadata succeeds?
5. Should `2.0.0-beta.2` block release until an automated `v1.8.2` upgrade fixture passes in CI?
