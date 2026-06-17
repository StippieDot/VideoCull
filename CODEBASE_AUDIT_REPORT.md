# VideoCull Codebase Audit Report - `stippie-dot/VideoCull`, branch `main`

Audited repository: `D:\GitHub\Video-Cull`  
Baseline release: `v1.8.2` (`package.json` version `1.8.2`)  
Current branch: `main` (`package.json` version `2.0.0-beta.2`)  
Electron entrypoint: [`electron/main.js`](electron/main.js)  
Corrected audit date: 2026-06-17

> [!IMPORTANT]
> This corrected report focuses on behavior changed after `v1.8.2`. Findings are marked as introduced after `v1.8.2`, pre-existing, partially introduced, fixed after audit, or unclear. Several release-blocking regressions were fixed after the original audit; this report now reflects the current branch state.

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

The release-blocking concerns are now concentrated in upgrade/data-loss coverage. Several original blockers have been fixed: stale cache auto-pruning is opt-in/default-off, empty-folder cleanup is opt-in/default-off, thumbnail/metadata/scan cancellation is fixed, duplicate fingerprint cache keys are settings-scoped, visual duplicate semantics are stable across library sizes, duplicate group IDs are stable, the arbitrary `open-in-explorer` fallback is gone, settings-save rescans were reduced, stale duplicate selection/review state was tightened, pending replacement scans disable destructive delete actions, and cache migration refuses existing targets before staging copies.

Security weighting note: this is an offline local Electron media manager, so renderer-compromise and local-path disclosure issues are still real hardening work but are not weighted the same as internet-facing app vulnerabilities. Issues that can delete user files, lose cache decisions, corrupt duplicate results, or make upgrade behavior unsafe remain release-blocking. Offline-only protocol/path hardening is lower priority unless it affects destructive operations or stale file grants.

### Top Remaining Release Risks

| Rank | Risk | Delta Status | Release Impact |
|---:|---|---|---|
| 1 | `video://` still lacks realpath loaded-root revalidation after scan. | Introduced after `v1.8.2` | Offline lower security priority, but still a stale-grant/path-replacement regression. |
| 2 | `v1.8.2` cache/settings upgrade is not proven with real fixtures. | Unclear / untested | Release upgrade could lose decisions, metadata, thumbnails, or settings without a fixture catching it. |
| 3 | `video://` still lacks realpath loaded-root revalidation after scan. | Introduced after `v1.8.2` | Offline lower security priority, but still a stale-grant/path-replacement regression. |
| 4 | ffprobe failures are still retried every scan. | Introduced/worsened after `v1.8.2` | Performance/UX risk for corrupt/offline media; not currently a blocker by itself. |
| 5 | Cache migration and delete safety still need E2E coverage. | Coverage gap | Main risks are now guarded in code, but packaged/E2E behavior is not proven. |

Safety assessment: `main` is materially safer than the first audit snapshot. I would no longer block the release on offline-only renderer/path-hardening findings. I would still block a production upgrade until the real `v1.8.2` cache/settings upgrade fixture passes.

Pre-existing but still important safety debt:

- Renderer-provided scan roots mint trusted file grants. This existed in `v1.8.2`.
- Missing Electron navigation/window-open denial existed in `v1.8.2`, but the preload API is broader now.
- Cache migration target clobber risk existed in `v1.8.2`; current `main` now refuses existing targets and stages copies before source removal.
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
| `npm run check:ipc` | PASS | `IPC contract OK: 44 methods, 34 channels.` |
| `npx tsc -p tsconfig.test.json --noEmit` | PASS | No TypeScript errors. |
| `npm run test:duplicates` | PASS | Duplicate-focused suite passes after fingerprint-key, stable-group, and visual-bucketing fixes. |
| `npm run test:renderer` | PASS | 6 files, 36 tests. |
| `npm run test` | PASS | 31 files, 224 tests. |
| `npm run test:ci` | PASS | Coverage ran, but coverage is low: statements 39.21%, branches 36.58%, functions 39.8%, lines 39.18%. |
| `npm run build` | PASS | Vite warning remains: main JS chunk is about 526 kB, over the 500 kB warning threshold. |
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
| Scanner: [`electron/scanner.js`](electron/scanner.js), scan handling in [`electron/main.js`](electron/main.js) | Added stat batching, progress batching, cache-folder skipping, `visitedDirs`, scan generation/superseded checks, and scanner-internal cancellation checks. | Medium | Medium | `tests/electron/scanner.test.js`, `tests/electron/scanner.behavior.test.js` | Inaccessible directory summary test, mounted-drive latency test. |
| Cache and SQLite: [`electron/cache.js`](electron/cache.js), [`electron/cache-folder-tracker.js`](electron/cache-folder-tracker.js) | Added metadata version/failure columns, bitrate/container fields, file signatures, fingerprint table, stale row pruning, thumbnail ordering, folder tracker. Auto-prune missing subfolder cache is now opt-in/default-off. Fingerprints are scoped by a settings key. Cache migration refuses existing targets and stages copies before source removal. | Medium-High | High | `tests/electron/cache.test.js`, `tests/electron/cache.migration.test.js`, `tests/electron/cache-folder-tracker.test.js`, `tests/electron/main-helpers.test.js` | `v1.8.2` DB fixture upgrade test, source-file-change fingerprint invalidation test if file metadata is not fully covered by the key. |
| Processor and FFmpeg/ffprobe: [`electron/processor.js`](electron/processor.js) | Split metadata probing from thumbnail generation, added metadata schema version, added separate `cancelThumbnails` and `cancelMetadata`. Thumbnail and metadata cancellation regressions are fixed. | Medium | Medium-High | `tests/electron/processor.helpers.test.js`, `tests/electron/processor.test.js` | ffprobe failure backoff test, partial thumbnail file test. |
| Duplicate detection: [`electron/duplicates.js`](electron/duplicates.js), [`electron/duplicate-utils.js`](electron/duplicate-utils.js), [`electron/duplicate-worker.js`](electron/duplicate-worker.js), [`electron/visual-worker.js`](electron/visual-worker.js) | Entire duplicate pipeline added after `v1.8.2`: exact/hash/visual matching, fingerprint persistence, duplicate worker threads, ignored pairs, suggested keepers. Fingerprint settings scoping, stable group IDs, and visual candidate parity are fixed. | Medium | Medium | `tests/electron/duplicate-utils.test.js`, `duplicates.test.js`, `duplicate-worker.test.js`, `visual-worker.test.js` | Large-library memory test; source-file-change fingerprint invalidation test if not covered by current key. |
| Renderer app/store/UI: [`src/App.tsx`](src/App.tsx), [`src/store.ts`](src/store.ts), duplicate/grid/review/sidebar/settings components | Added duplicate groups view, duplicate state, active review path, hidden-mounted grid during review, perf-dev instrumentation, context menus, richer settings. Settings-save rescan, stale duplicate selection/review state, and pending-scan delete actions were tightened. | Medium | Medium-High | `tests/src/*`, `tests/src/components/*`, `tests/src/App.dom.test.tsx` | Duplicate-disabled escape hatch test, hidden-grid perf benchmark. |
| E2E/test infrastructure: [`playwright.config.ts`](playwright.config.ts), `tests/e2e/*`, Vitest configs | Added E2E harness and many unit/DOM tests. | Low | Medium | Test files exist; unit/DOM suites pass. | `npm run test:e2e` was not run; no upgrade fixture from `v1.8.2` userData/cache. |

### Changed Behavior Summary

Release-impacting behavior changed after `v1.8.2`:

- New metadata pipeline writes metadata in batches and tracks metadata versions/failures.
- Thumbnail generation now depends on cached metadata more heavily and was split from metadata probing.
- Duplicate detection and persisted fingerprints are entirely new.
- Cache schema is expanded in-place with new columns and `video_fingerprints`.
- Scan can optionally prune missing descendant caches after scan; the option is now default-off.
- Batch delete now removes cache artifacts and can optionally remove truly empty folders; the empty-folder cleanup option is now default-off.
- `video://` authorization changed and is weaker against symlink replacement than `v1.8.2`.
- `open-in-explorer` briefly allowed arbitrary existing fallback paths after `v1.8.2`; current `main` is back to loaded/known path validation.
- Renderer keeps grid mounted while review mode is active.
- Settings changes previously triggered more scan work because `handleScan` depended on more settings; the noisy save-triggered rescan path has been reduced.

## Upgrade Safety from v1.8.2

| Area | Current Upgrade Behavior | Risk | Release Assessment | Tests Covering It | Missing Tests |
|---|---|---:|---|---|---|
| Cache DB compatibility | Current `cache.openDb` runs `CREATE TABLE IF NOT EXISTS` plus additive `ALTER TABLE` for new video columns and fingerprint columns. Existing `v1.8.2` DBs should open because the schema changes are additive. | Medium | Probably compatible, but not proven with a real `v1.8.2` DB fixture. | `tests/electron/cache.test.js`, JSON migration tests. | Open an actual `v1.8.2` SQLite DB fixture and assert status/bookmarks/thumbs/metadata survive. |
| Thumbnail path compatibility | `v1.8.2` already used cache-mode-aware roots and relative thumbnail rows. `main` still loads relative paths via `thumbAbsolute` and keeps legacy `.video-cull-thumbs` migration. | Medium | Basic compatibility likely, but stale `thumb://` immutable caching and broad active cache roots remain. | Cache thumbnail round-trip tests. | `v1.8.2` DB with existing thumbnail rows, regeneration URL/cache invalidation test. |
| Metadata persistence | New metadata fields are additive. Old `duration_secs`, `metadata_date`, codec/resolution fields are loaded and preserved with `COALESCE`. | Medium | Upgrade should preserve old values. ffprobe failures are still retried, but this is now UX/perf debt rather than cache compatibility risk. | Cache round-trip tests include metadata fields. | Upgrade fixture with stale/partial metadata; optional ffprobe failure backoff test if retry suppression is desired. |
| Duplicate/fingerprint persistence | No `v1.8.2` fingerprint data exists, so initial upgrade starts empty. Persistent fingerprints are now scoped by a fingerprint settings key. | Medium | First run is safe from old data; settings changes are now covered better. Source-file mutation should still be verified against the key. | Duplicate/cache tests cover fingerprint settings keys and failure keys. | Source-file-change invalidation test if file size/mtime/duration is not fully encoded. |
| Settings migration | `loadSettings` migrates invalid fields and duplicate settings. Cache location settings already existed in `v1.8.2`; target clobber is now blocked before migration moves data. | Medium | Upgrade settings likely load, but exact `v1.8.2` settings are still not fixture-tested. | Store settings migration test covers invalid fields and recent pruning. | Exact `v1.8.2` settings fixture, cache migration cancel/no-side-effect test. |
| Recent folders | Recent folders persist through settings. Current tests prune missing recent directories using renderer validation. | Medium | Offline/removable recent folders may disappear from recents, depending on validation result. | Store legacy settings test covers stale recent pruning. | Offline/removable drive should be marked unavailable, not silently pruned. |
| Destructive action behavior | `batch-delete` validates loaded paths and fallback permanent delete is confirmed. Post-`v1.8.2` adds cache artifact removal and optional empty-folder cleanup. `open-in-explorer` is back to loaded/known path validation. | Medium-High | Safer than the first audit snapshot. Still needs E2E delete-safety and upgrade fixture coverage before production release. | `tests/e2e/delete-safety.spec.ts` exists but was not run; helper tests cover empty-folder cleanup and reveal validation. | E2E delete safety run in CI; new-folder pending-scan destructive UI test. |

## Finding Provenance and Verification Matrix

### High Findings

| ID | Finding | Verification Status | Delta Classification | Release Blocking? |
|---|---|---|---|---|
| H1 | Renderer-controlled scan paths mint file grants. | Confirmed | Existed before `v1.8.2` | Not a new regression, but still important security debt. |
| H2 | Missing navigation/window-open denial with privileged preload. | Confirmed | Existed before `v1.8.2`; impact increased after because preload API grew. | Harden before release if threat model includes compromised renderer/navigation. |
| H3 | Auto-pruning can delete cache on transient `stat` failures. | Fixed after audit | Introduced after `v1.8.2` | No. Now opt-in/default-off; residual risk only when user enables cleanup. |
| H4 | Cache migration can clobber or partially move targets. | Fixed after audit | Existed before `v1.8.2` | No. Existing targets are refused and migration copies are staged before source removal. |
| H5 | Thumbnail cancellation token is broken. | Fixed after audit | Introduced after `v1.8.2` | No. Token assignment and cancellation coverage are present. |
| H6 | Superseded scans and metadata cancellation keep doing work. | Fixed after audit | Partially introduced after `v1.8.2`: scan no-abort existed; metadata pipeline/cancel path is new. | No. Scanner and metadata cancellation now have tests. |
| H7 | Fingerprint cache ignores sampling settings/source changes. | Fixed after audit | Introduced after `v1.8.2` | No for settings changes. Add source-file mutation test if needed. |
| H8 | Visual duplicate semantics change at 5,000 candidates. | Fixed after audit | Introduced after `v1.8.2` | No. Visual worker always uses bucketed candidate generation. |
| H9 | New folder sessions keep old videos/delete UI active during scan. | Partially fixed after audit | Existed before `v1.8.2` | No for destructive delete actions; old cards may still be visible while scanning. |

### Medium Findings

| ID | Finding | Verification Status | Delta Classification | Release Blocking? |
|---|---|---|---|---|
| M1 | ffprobe failures are swallowed and retried forever. | Confirmed | Introduced/worsened after `v1.8.2` for the metadata pipeline. | No. Annoying for bad/offline files, but not destructive. |
| M2 | `video://` lacks realpath loaded-root revalidation. | Confirmed | Introduced after `v1.8.2`; old handler used `isPathWithinAnyDir`. | Low-Medium in offline threat model; fix before broad distribution if possible. |
| M3 | `thumb://` serves any `.jpg` under active cache roots. | Confirmed | Existed before `v1.8.2` | Not new; hardening debt. |
| M4 | `open-in-explorer` allows arbitrary existing paths. | Fixed after audit | Introduced after `v1.8.2`; old handler denied outside loaded roots. | No. Fallback removed. |
| M5 | Empty-folder cleanup has destructive TOCTOU race. | Fixed after audit | Introduced after `v1.8.2` | No. Cleanup is opt-in/default-off and revalidates the target. |
| M6 | Cache path resolution creates directories as a side effect. | Confirmed | Existed before `v1.8.2` | Upgrade risk, but not new. |
| M7 | `process-metadata` and `generate-thumbnails` lack top-level array validation. | Confirmed | Partially introduced after `v1.8.2`: thumbnail handler pre-existed; metadata handler is new. | Fix with low effort before release. |
| M8 | Saving processing settings can trigger a full rescan. | Fixed after audit | Introduced/worsened after `v1.8.2`; `handleScan` gained more processing-setting dependencies. | No. |
| M9 | Overlapping loaded roots duplicate files in state. | Confirmed | Existed before `v1.8.2` | Not new; data/state correctness debt. |
| M10 | Duplicate filters can hide selected videos that still get marked. | Fixed after audit | Introduced after `v1.8.2` | No. |
| M11 | Disabling duplicates while in duplicate mode can trap user. | Confirmed | Introduced after `v1.8.2` | Medium release risk. |
| M12 | Deleting videos leaves stale review/duplicate state. | Fixed after audit | Partially introduced after `v1.8.2`; duplicate annotations and active review path are new. | No. |
| M13 | Regenerated or failed thumbnails can reuse stale/broken files. | Partially confirmed | Existed before `v1.8.2`; force-regeneration path increases visibility. | Needs targeted repro before blocking. |
| M14 | Duplicate group IDs are unstable across runs. | Fixed after audit | Introduced after `v1.8.2` | No. |
| M15 | Visual duplicate mode has avoidable O(n^2) and memory pressure. | Partially fixed after audit | Introduced after `v1.8.2` | No. Always-bucketed visual candidates reduce the main issue; dense buckets/pair payloads remain perf debt. |
| M16 | Hidden grid recomputes during review mode. | Confirmed | Introduced after `v1.8.2`; old app unmounted grid in review mode. | Medium perf risk. |
| M17 | Offline distributed cache paths are dropped at startup. | Confirmed | Existed before `v1.8.2` | Upgrade risk for removable drives, but not new. |

## Critical Findings

No Critical finding was proven from repository contents alone. Most original High post-`v1.8.2` regressions have been fixed after the audit. The remaining open High items are release-relevant only where they affect upgrade safety, destructive workflows, or explicit filesystem trust; offline-only hardening issues are lower priority.

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
| Verification | Fixed after audit |
| Delta Since `v1.8.2` | Introduced after `v1.8.2` |
| Location | [`electron/main-helpers.js`](electron/main-helpers.js) `listMissingDescendantCacheFolders`, [`electron/main.js`](electron/main.js) `pruneMissingDescendantCaches` |

**Problem**

Original problem: `listMissingDescendantCacheFolders` treated any `statPath` error as missing. `pruneMissingDescendantCaches` then called `cache.deleteDb`.

Current status: fixed by making missing-subfolder cache cleanup opt-in/default-off and avoiding the dangerous default path for offline/mounted drives.

**Why It Matters**

`EACCES`, disconnected drives, sleeping network mounts, or slow cloud drives can be interpreted as deleted folders, losing review decisions, metadata, fingerprints, and thumbnails.

**Evidence From Code**

- Current `main`: `pruneMissingDescendantCaches` is called after scan.
- Current helper: all `statPath` errors push the folder into the missing list.
- `v1.8.2`: this descendant auto-prune path was not present.

**Applied Fix**

Cleanup is no longer automatic by default. Keep it opt-in and continue treating offline/mounted-drive behavior conservatively.

**Suggested Test**

Mock `statPath` throwing `EACCES` for a known descendant and assert no DB/thumb deletion.

### H4. Cache Migration Can Clobber or Partially Move Existing Targets

| Field | Detail |
|---|---|
| Severity | High |
| Category | Data Integrity / Destructive Operation |
| Verification | Fixed after audit |
| Delta Since `v1.8.2` | Existed before `v1.8.2` |
| Location | [`electron/main.js`](electron/main.js) `movePathIfPresent`, `migrateOneCache`, `migrate-cache-settings` |

**Problem**

Original problem: migration moved DB, `-wal`, `-shm`, and thumbs independently. Cross-device copy used `fs.cp(..., { force: true })`; "Start fresh" deleted only source paths, not existing target caches.

Current status: fixed for target clobber and partial source removal. Migration now refuses existing targets and stages copies before removing source cache files.

**Why It Matters**

Existing target cache data can be overwritten, migration can land in a mixed sidecar state, and "fresh" mode can reuse stale target data when switching back.

**Evidence From Code**

- Current `main`: `migrateOneCache` loops sidecars and thumbs independently.
- `v1.8.2`: the same migration structure and target-root resolution already existed.
- Current cache contents are higher-stakes because metadata failure state and fingerprints were added after `v1.8.2`.

**Applied Fix**

Refuse or merge when targets exist. Checkpoint/close WAL before migration. Copy into temp, verify, then swap. In "fresh" mode quarantine both source and target cache for known folders.

**Suggested Test**

Pre-create distinct source and target DB/thumb data, migrate, and assert neither target clobbering nor partial sidecar state occurs.

### H5. Thumbnail Cancellation Is Broken

| Field | Detail |
|---|---|
| Severity | High |
| Category | Bug / Regression / Performance |
| Verification | Fixed after audit |
| Delta Since `v1.8.2` | Introduced after `v1.8.2` |
| Location | [`electron/processor.js`](electron/processor.js) `thumbToken`, `processVideos`, `cancelThumbnails` |

**Problem**

Original problem: `thumbToken` was declared, but `processVideos` assigned `currentToken = token`. `cancelThumbnails` only flipped `thumbToken.cancelled`.

Current status: fixed. `processVideos` now assigns the thumbnail token correctly and has cancellation coverage.

**Why It Matters**

Cancelling, rescanning, or closing can kill active FFmpeg commands while the queue continues to start new work and emit stale `thumb-ready-batch` events.

**Evidence From Code**

- Current `main`: processor split introduced `thumbToken` and `cancelThumbnails`.
- Current `processVideos`: assigns `currentToken = token`, not `thumbToken = token`.
- `v1.8.2`: processor used `currentToken` consistently.

**Applied Fix**

Assign `thumbToken = token`, clear only if still current, and check cancellation before starting each video and before `onVideoReady`.

**Suggested Test**

Mocked multi-video thumbnail run; call `cancelThumbnails`; assert no further videos start and no ready callbacks fire.

### H6. Superseded Scans and Metadata Cancellation Keep Doing Work

| Field | Detail |
|---|---|
| Severity | High |
| Category | Performance / Data Integrity |
| Verification | Fixed after audit |
| Delta Since `v1.8.2` | Partially introduced after `v1.8.2` |
| Location | [`electron/scanner.js`](electron/scanner.js) `scanDirectory`, [`electron/main.js`](electron/main.js) `scan-directory`, [`electron/processor.js`](electron/processor.js) `processMetadata` |

**Problem**

Original problem: `scanDirectory` had no abort signal and metadata cancellation did not re-check after awaited probe completion before callbacks.

Current status: fixed. `scanDirectory` now accepts an `assertNotCancelled` hook from `scan-directory`, and `processMetadata` re-checks cancellation after awaited metadata reads before progress/ready callbacks.

**Why It Matters**

On large or mounted drives, old scans and probes can continue heavy I/O after the user has moved on, then race stale progress or cache writes into the new session.

**Evidence From Code**

- `v1.8.2`: scanner also had no abort inside recursive walk.
- Current `main`: `ScanSupersededError` was added, but only around main-process phases, not scanner internals.
- Current metadata pipeline is new and can call `onVideoReady` after awaited `readMetadataForVideo`.

**Applied Fix**

Pass an abort callback/signal into scanner and metadata probe. Check before/after `readdir`, stat batches, ffprobe, and before every callback/write.

**Suggested Test**

Fake a deep tree and slow ffprobe; cancel after first directory/probe starts; assert no deeper stat calls and no metadata-ready callback.

### H7. Fingerprint Cache Ignores Sampling Settings and Source Changes

| Field | Detail |
|---|---|
| Severity | High |
| Category | Bug / Duplicate Detection |
| Verification | Fixed after audit |
| Delta Since `v1.8.2` | Introduced after `v1.8.2` |
| Location | [`electron/cache.js`](electron/cache.js) `video_fingerprints`, `getFingerprintCounts`; [`electron/duplicates.js`](electron/duplicates.js) sampling/backfill |

**Problem**

Original problem: `video_fingerprints` reuse was based on row counts without a settings/source key.

Current status: fixed for duplicate settings changes. Fingerprint reads, writes, and failure rows are scoped by a fingerprint key. A source-file mutation test is still worth adding if the key does not fully encode file identity changes.

**Why It Matters**

Changing duplicate settings can reuse fingerprints from a different time window, producing false positives or false negatives.

**Evidence From Code**

- Duplicate pipeline and `video_fingerprints` table did not exist in `v1.8.2`.
- Current `getFingerprintCounts` checks counts/flipped counts.
- Current `loadPHashRows` and `loadGraySampleRows` take the first N rows.

**Applied Fix**

Store a fingerprint source/settings key including file size/mtime/duration/sample window/count/flip mode, and rebuild when it differs.

**Suggested Test**

Run duplicate detection with `sampleCount: 3`, then rerun with `sampleCount: 2` or a custom window and assert fingerprints are rebuilt.

### H8. Visual Duplicate Semantics Change at 5,000 Candidates

| Field | Detail |
|---|---|
| Severity | High |
| Category | Bug / Regression |
| Verification | Fixed after audit |
| Delta Since `v1.8.2` | Introduced after `v1.8.2` |
| Location | [`electron/visual-worker.js`](electron/visual-worker.js), [`electron/duplicate-utils.js`](electron/duplicate-utils.js) `durationsWithinTolerance` |

**Problem**

Original problem: below 5,000 candidates, visual mode used all-pairs comparison, while 5,000+ candidates used bucketing. Known-duration/unknown-duration eligibility changed with library size.

Current status: fixed. Visual mode now always uses bucketed candidate generation and applies duration eligibility before counting/comparing pairs.

**Why It Matters**

Duplicate results depend on library size. A known-duration and unknown-duration video can match below the threshold but not above it.

**Evidence From Code**

- `visual-worker.js` did not exist in `v1.8.2`.
- Current `BUCKET_ACTIVATION_THRESHOLD = 5000`.
- Current all-pairs path calls `durationsWithinTolerance`.

**Applied Fix**

Use the bucketed candidate generator for all visual runs, or explicitly skip known-vs-unknown duration pairs.

**Added Test**

Visual-worker parity test: known duration vs unknown duration should produce zero compared pairs below and above 5,000 candidates.

### H9. New Folder Sessions Keep Old Videos and Delete UI Active During Scan

| Field | Detail |
|---|---|
| Severity | High |
| Category | Bug / UI/UX / Destructive Operation |
| Verification | Partially fixed after audit |
| Delta Since `v1.8.2` | Existed before `v1.8.2` |
| Location | [`src/store.ts`](src/store.ts) `setDirectory`, [`src/App.tsx`](src/App.tsx), [`src/components/Sidebar.tsx`](src/components/Sidebar.tsx) |

**Problem**

Original problem: `setDirectory(non-null)` changes folder state but does not clear old `videos`, `filteredVideos`, or stats before the new scan resolves.

Current status: fixed for destructive delete actions. Sidebar batch delete and menu delete-all are disabled/ignored while scanning, so old marked videos cannot be deleted during a replacement scan. Old cards may still remain visible until the replacement scan resolves.

**Why It Matters**

Users can see old cards and old marked-delete counts while a new folder is scanning, making destructive actions ambiguous.

**Evidence From Code**

- Current `setDirectory(non-null)` does not clear videos.
- `v1.8.2` behaved similarly.
- Current duplicate/review state increases the number of stale-state surfaces.

**Applied Fix**

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
| Verification | Fixed after audit |
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

Original problem: after known/loaded checks, `canRevealInExplorerPath` fell back to allowing any existing file or directory.

Current status: fixed. `open-in-explorer` now uses loaded/known path validation without the arbitrary existing-path fallback.

**Why It Matters**

The renderer can reveal arbitrary local/UNC paths and gets an existence oracle.

**Evidence From Code**

- `v1.8.2`: `open-in-explorer` allowed only known paths or paths inside current scan dirs.
- Current helper returns true for any `statPath` file/directory.
- Current tests codify this permissive behavior.

**Applied Fix**

Remove the fallback or restrict it to main-owned recent directories selected by dialog.

**Suggested Test**

Reject `C:\Windows`, arbitrary temp paths, and UNC paths unless granted.

### M5. Empty-Folder Cleanup Has a Destructive TOCTOU Race

| Field | Detail |
|---|---|
| Severity | Medium |
| Category | Destructive Operation |
| Verification | Fixed after audit |
| Delta Since `v1.8.2` | Introduced after `v1.8.2` |
| Location | [`electron/main.js`](electron/main.js) `trashEmptyDeletedVideoFolders` |

**Problem**

Original problem: `trashEmptyDeletedVideoFolders` checked `readdir`, then trashed/removed the directory later.

Current status: fixed. Empty-folder cleanup is opt-in/default-off and the helper was tightened to skip unsafe candidates and expected races.

**Why It Matters**

A sync/camera/copy process can create a new file between the emptiness check and folder trash.

**Evidence From Code**

`trashEmptyDeletedVideoFolders` was added after `v1.8.2` and is called after batch delete success paths.

**Applied Fix**

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
| Verification | Fixed after audit |
| Delta Since `v1.8.2` | Introduced/worsened after `v1.8.2` |
| Location | [`src/App.tsx`](src/App.tsx) `handleScan` effect, [`src/components/SettingsModal.tsx`](src/components/SettingsModal.tsx) settings save |

**Problem**

Original problem: the auto-scan effect depended on `handleScan`, and `handleScan` depended on settings such as thumbnail count and intro skip.

Current status: fixed. Settings save no longer triggers the unexpected full rescan path.

**Why It Matters**

Saving preferences can rescan large mounted folders, despite UI copy saying changes apply on next run/regeneration.

**Evidence From Code**

- `v1.8.2` `handleScan` dependencies were narrower.
- Current `handleScan` dependencies include more processing settings because of metadata/thumb orchestration.

**Applied Fix**

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
| Verification | Fixed after audit |
| Delta Since `v1.8.2` | Introduced after `v1.8.2` |
| Location | [`src/components/DuplicateGroupsView.tsx`](src/components/DuplicateGroupsView.tsx) `selectedIds`, `markSelectedDuplicates` |

**Problem**

Original problem: selected duplicate IDs were local state, while visible groups were filtered separately. `markSelectedDuplicates` could act on all selected IDs still in `videosById`.

Current status: fixed. Hidden/stale duplicate selections are cleared more aggressively.

**Why It Matters**

Users can mark hidden duplicate videos for deletion after filtering.

**Evidence From Code**

`DuplicateGroupsView` did not exist in `v1.8.2`. Current selection is not pruned on filter/sort/group changes.

**Applied Fix**

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
| Verification | Fixed after audit |
| Delta Since `v1.8.2` | Partially introduced after `v1.8.2` |
| Location | [`src/store.ts`](src/store.ts) `removeDeletedVideos`, [`src/App.tsx`](src/App.tsx) review menu actions |

**Problem**

Original problem: `removeDeletedVideos` pruned videos/groups but did not fully re-clamp review state or duplicate annotations after dropped groups.

Current status: fixed. Stale duplicate review state is cleared after delete/group changes.

**Why It Matters**

Reveal/play can target stale review paths, and singleton videos can keep stale `duplicateGroupId`/keeper flags.

**Evidence From Code**

- `v1.8.2` already did not clamp review state on delete.
- Current `activeReviewVideoPath` and duplicate annotations are new after `v1.8.2`, increasing the stale-state impact.

**Applied Fix**

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
| Verification | Fixed after audit |
| Delta Since `v1.8.2` | Introduced after `v1.8.2` |
| Location | [`electron/duplicates.js`](electron/duplicates.js) `buildGroups` |

**Problem**

Original problem: group IDs were assigned as `dup-${groupIndex++}` before final ordering.

Current status: fixed. Group IDs are now derived from a hash of sorted member IDs.

**Why It Matters**

Adding an unrelated stronger group can renumber existing groups, breaking UI state and manual keeper/undo assumptions.

**Evidence From Code**

Duplicate groups did not exist in `v1.8.2`. Current IDs are sequential, not derived from member IDs.

**Applied Fix**

Derive IDs from sorted member IDs, for example a short hash of `videoIds.sort().join('|')`.

**Suggested Test**

Build A/B group, then add C/D group with higher similarity; assert A/B keeps the same ID.

### M15. Visual Duplicate Mode Has Avoidable O(n^2) and Memory Pressure

| Field | Detail |
|---|---|
| Severity | Medium |
| Category | Performance |
| Verification | Partially fixed after audit |
| Delta Since `v1.8.2` | Introduced after `v1.8.2` |
| Location | [`electron/visual-worker.js`](electron/visual-worker.js), [`electron/duplicates.js`](electron/duplicates.js) visual comparison data loading |

**Problem**

Original problem: visual mode did full all-pairs comparison below 5,000 candidates, loaded gray BLOB rows into the main process, cloned them into workers, and accumulated pair objects.

Current status: partially fixed. Visual mode now always uses bucketed candidate generation, including below 5,000 candidates. Remaining debt is dense-duration buckets, gray-row memory pressure, and returning every matching pair.

**Why It Matters**

Large libraries can spike CPU and memory before reaching the bucket threshold.

**Evidence From Code**

Visual duplicate detection was added after `v1.8.2`. The original 5,000-candidate behavior split has been removed; visual candidate generation now always uses buckets.

**Remaining Fix**

Measure large-library memory/comparison counts first. If needed, stream/batch gray rows and return union/group summaries rather than every matching pair.

**Suggested Test**

Many different-duration videos below 5,000 should compare only eligible bucketed pairs. Current tests cover known/unknown duration parity and bucketed eligible-pair counts.

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
| Destructive filesystem operations | `batch-delete` validation remains useful. Post-`v1.8.2` empty-folder cleanup is now opt-in/default-off and tightened. |
| `shell.openExternal` / `shell.openPath` | `openExternalUrl` was added after `v1.8.2` and is allowlisted. `openVideo` improved. `open-in-explorer` fallback regression was fixed. |
| Remote content | Google Fonts remain. CSP still permits localhost dev connect targets in production HTML. |
| CSP | Exists, but should be production-specific and narrower. |
| Updater risk | `electron-updater` remains GitHub based. Runtime upgraded from Electron 32 to 41. Packaged updater behavior was not tested. |
| Dependency risk | Major runtime upgrades happened after `v1.8.2`. No live advisory scan was run due restricted network. |

Offline-app weighting: H1/H2/M2/M3 remain valid hardening findings, but they are not release blockers by themselves unless the threat model includes compromised renderer content, local malware replacing files after scan, or remote navigation into the privileged preload. They should not outrank user-data loss, destructive operations, or upgrade compatibility.

## Destructive Operation Safety Review

| Operation | `v1.8.2` Behavior | `main` Behavior | Assessment |
|---|---|---|---|
| Batch delete | Validated known/loaded paths and used Recycle Bin with permanent fallback confirmation. | Still validates, also removes cache artifacts and can optionally run empty-folder cleanup. | No longer blocked by default cleanup; still deserves E2E coverage. |
| Trash behavior | File trash fallback confirmation existed. | Same general flow, more cache cleanup. | File fallback is acceptable; optional folder cleanup is lower risk after default-off behavior. |
| Empty folder trash/removal | Not found in `v1.8.2`. | Added optional `removeEmptyFoldersAfterDelete`, default `false`. | Acceptable as opt-in maintenance; keep copy explicit and tests around true emptiness. |
| Cache clearing | Cache modes and migration existed. | Similar, but more data types now exist in DB. | Higher data-loss impact after fingerprints/metadata fields. |
| Cache migration | Existing target clobber risk already existed. | Existing targets are refused and migration copies are staged before source removal. | No longer a blocker, but keep E2E migration coverage. |
| Report export | Existed before. | Export accepts multiple roots now. | No new blocking issue found. |
| Open/reveal/play external | `open-video` only checked known path; reveal checked known or loaded root. | `open-video` improved; reveal fallback regression was fixed. | Remaining concern is mostly protocol/stale-grant hardening. |
| Stale known-path state | Existed. | More stale state surfaces due metadata/duplicates/review active path; duplicate/review cleanup and pending-scan delete gating were improved. | Remaining issue is mostly stale visibility, not destructive action. |
| Renderer-provided path trust | Existed. | Still present. | Not a new regression, but remains trust-boundary debt. |

## Performance Review

Ranked by expected gain versus implementation effort, with regression focus.

| Rank | Area | Delta Since `v1.8.2` | Expected Gain | Effort | Notes |
|---:|---|---|---:|---:|---|
| 1 | Add `v1.8.2` cache/settings upgrade fixture | Missing coverage | High | Med | Highest remaining release confidence gain. |
| 2 | Polish pending new-folder scan state | Pre-existing, impact higher now | Medium | Low-Med | Destructive delete actions are gated; old-card visibility can still be clearer. |
| 3 | ffprobe failure backoff | Introduced/worsened after | Medium | Low-Med | Avoids retry storms on bad/offline files; not currently blocking. |
| 4 | Freeze hidden grid during review | Introduced after | Medium | Med | Helps large review sessions. |
| 5 | De-dupe overlapping roots | Pre-existing | Medium | Low | Prevents duplicated state and extra work. |
| 6 | Narrow thumbnail protocol/cache invalidation | Pre-existing | Medium | Low-Med | Prevents stale images and broad cache reads. |
| 7 | Further duplicate memory optimization | Introduced after | Medium | Med | Only needed if large-library measurements show pressure after always-bucketed visual candidates. |
| 8 | Split IPC listener effect | Worsened after | Low | Low | Cleanup with minor perf benefit. |

## UI/UX Improvement Opportunities

Ranked by practical value and release relevance:

1. Keep destructive actions disabled during pending new-folder scans; old-card visibility can be improved separately.
2. Keep empty-folder cleanup opt-in/default-off with explicit wording. This post-`v1.8.2` destructive behavior is no longer automatic.
3. Keep duplicate selections visibly scoped; hidden/stale selection cleanup was fixed, but this remains an important workflow invariant.
4. Always provide a duplicate-mode escape hatch, even when duplicate detection is disabled. New after `v1.8.2`.
5. Show skipped/inaccessible folder counts and sample paths after scan. Pre-existing gap, important for mounted drives.
6. Use one explicit destructive confirmation with count, size, affected roots, recycle-bin fallback, and empty-folder behavior.
7. Block shortcut conflicts instead of only warning.
8. Make cache migration wording match actual behavior and avoid creating folders before confirmation.
9. Add "what happened" feedback for metadata/thumbnail failures and optional retry backoff.
10. Surface mounted-drive/offline cache status rather than pruning silently.

## Regression Risk Areas

Recent commits most likely tied to post-`v1.8.2` risks:

| Commit | Area | Regression Risk |
|---|---|---|
| `09fa0ac fix: stabilize duplicate groups and visual matching` | Duplicate detection | Fixed unstable group IDs and visual candidate parity; future risk is dense-bucket memory/pair payloads. |
| `13b6ae0 fix: stop stale scan and metadata callbacks` | Scanner / metadata | Fixed scanner supersession and metadata callback cancellation; future risk is mounted-drive latency behavior. |
| `e436260 fix: clear stale duplicate review state` | Renderer duplicate/review state | Fixed stale duplicate selections/review state after filtering/deletes. |
| `113be39 fix: harden scan and duplicate cache state` | Cache / duplicate persistence / reveal | Fixed fingerprint settings scoping, scan/cache hardening, and reveal fallback regression. |
| `c715531 fix: make cleanup maintenance opt-in` | Cache cleanup / empty-folder cleanup | Made stale cache and empty-folder cleanup default-off/opt-in. |
| `25e3d7a fix: disable background throttling during thumbnail generation` | Thumbnail generation | Higher background throughput means cancellation tests should stay in place. |
| `8431894 feat: auto-clean stale cache after scans` | Cache pruning | Introduced the high-risk descendant cache pruning path; later commit made it opt-in/default-off. |
| `916eef3 feat: prune missing subfolder caches and remove library UI remnants` | Cache pruning / UI simplification | Adjacent cache pruning risk; later commit reduced default risk. |
| `c82deb9 perf: improve scanner traversal throughput` | Scanner | Performance changes still need mounted-drive tests, even after cancellation was added. |
| `f5edad9 perf: reduce cache and duplicate startup overhead` | Cache and duplicate startup | Fingerprint/cache reuse is a correctness regression risk. |
| `9fb111f perf: reduce grid, review, and sidebar recomputation` | Renderer perf | Hidden grid and broad subscription behavior are future regression areas. |
| `47c06c5 perf: reduce renderer rerender fan-out` | Renderer perf | State derivation and invalidation need regression tests around review/delete/duplicates. |

## Missing Tests

### Highest-Value Tests to Add First

- `v1.8.2` SQLite DB fixture upgrade test:
  - Open a real `v1.8.2` DB.
  - Assert status, bookmarks, metadata, thumbnails, and relative paths survive.
  - Assert new columns/table are added without data loss.
- Pending-scan destructive action tests:
  - Sidebar delete button is disabled during scan.
  - Menu delete-all is ignored during scan.
- `video://` symlink escape test:
  - Scan file, replace with symlink/reparse escape, assert 403.
- Source-file fingerprint invalidation test:
  - Change file size/mtime/duration under the same video ID and assert stale fingerprints are not reused.
- Empty-folder cleanup opt-in E2E:
  - Confirm the setting is default-off.
  - Confirm enabled cleanup removes only truly empty folders and never folders with non-video files.

### Other Concrete Tests

- Main-process IPC grant tests for `scan-directory`, `batch-delete`, `open-video`, and `open-in-explorer`.
- `open-in-explorer` outside-root rejection regression test.
- `thumb://` serving only known thumb paths.
- Cache migration E2E test with existing target conflict and failed copy.
- Inaccessible directory reporting.
- Optional ffprobe failure backoff if the retry behavior should be suppressed.
- Renderer tests for duplicate-mode escape, overlapping directories, and hidden-grid perf behavior.
- E2E tests for upgrade from seeded `v1.8.2` userData/cache, delete-all-marked, undo, cache migration cancel, and duplicate review.

## Recommended Fix Order

### Stage 1 - Remaining Release Blockers and Upgrade Confidence

1. Add and pass a real `v1.8.2` DB/settings upgrade fixture.
2. Optionally replace old cards with a pending-scan state while a new folder scan is pending.
3. Restore `video://` realpath loaded-root validation if you want to close the remaining offline hardening regression before public release.
4. Add E2E delete safety coverage for batch delete, undo, optional empty-folder cleanup, and recycle-bin fallback.
5. Add source-file mutation coverage for duplicate fingerprint invalidation.

Required tests before/after:

- `v1.8.2` upgrade fixture.
- Pending-scan destructive action gating.
- Protocol symlink.
- Delete safety E2E.
- Fingerprint source mutation.

### Stage 2 - Upgrade Safety from `v1.8.2`

1. Prove cache schema upgrade preserves decisions, bookmarks, metadata, and thumbnails.
2. Prove cache migration cancel has no filesystem side effects.
3. Prove recent folders on offline/removable drives are not silently lost.
4. Run E2E upgrade smoke with seeded `v1.8.2` userData.

### Stage 3 - High-Value Bug Fixes

1. Propagate ffprobe failures into metadata backoff if retry storms are common in real libraries.
2. Add duplicate-mode escape hatch coverage if not already proven.
3. De-dupe overlapping loaded roots.

### Stage 4 - Performance and Maintainability

1. Freeze hidden grid subscriptions in review mode.
2. Write thumbnails to temp files and atomic rename.
3. Measure duplicate worker memory on dense duration buckets before adding more scheduling code.
4. Split IPC listener effect from shortcut-help state.
5. Split pure cache path resolution from directory creation.

## Open Questions

1. Should drag-and-drop paths be trusted the same as dialog-selected paths, or should both become explicit main-issued grants?
2. Should VideoCull ever automatically trash empty source folders, or should that be a separate opt-in cleanup command?
3. Must distributed `.videocull` caches survive long-term offline/removable drives without pruning?
4. In duplicate detection, should unknown-duration videos be compared visually at all, or only after metadata succeeds?
5. Should `2.0.0-beta.2` block release until an automated `v1.8.2` upgrade fixture passes in CI?
