# VideoCull architecture context

A short orientation to how VideoCull is built, who owns which state, and which rules keep it working.
Read this before changing code that crosses the renderer, preload, main-process or cache seams.

Each section labels its content as one of:

- **Current**: what the code does at the commit named below.
- **Decided**: accepted decisions. These are recorded in [decisions/](decisions/) and in the Architecture Rules section of [roadmap.md](../roadmap.md#architecture-rules).
- **Direction**: where the architecture is meant to go. Nothing marked this way is built yet.
- **Open**: questions nobody has decided yet.

Last checked against `1dcc13f`. Line numbers are approximate and drift as files change.

---

## 1. What VideoCull is

VideoCull is a Windows desktop app for reviewing large folders of video files and deciding what to keep. It scans folders, reads metadata with FFprobe and makes thumbnail strips with FFmpeg. Duplicate detection uses file hashes and visual fingerprints. The user marks each video *keep*, *delete* or leaves it *pending*, and can add ratings, favourites and bookmarks. Delete then moves the marked files to the Recycle Bin.

Architectural goals:

- **Decisions are never lost.** Review state lives in a per-folder SQLite database and survives restarts, rescans and app updates.
- **Destructive actions are guarded.** A file is deleted only when it belongs to a loaded folder and is unchanged since the scan.
- **Heavy work never blocks the UI.** Scans, FFmpeg runs and fingerprinting happen outside React.
- **Every release works on its own.** The app ships in small, continuously releasable steps.

## 2. Major subsystems (Current)

```
 Renderer (React + TS, Vite)                      Electron main (CommonJS, no build step)
 ┌──────────────────────────────┐   preload.js    ┌──────────────────────────────────────────┐
 │ components/*  presentation    │  contextBridge  │ main.js  lifecycle, window, protocols,   │
 │ App.tsx  scan pipeline,       │ ─────────────▶  │          54 IPC registrations, pipeline  │
 │          menu commands        │  ElectronAPI    │          handlers, updater, report       │
 │ store.ts Zustand: videos,     │  (src/types.ts) │ main-helpers.js  pure, injected I/O      │
 │          filters, review,     │ ◀─────────────  │ power-manager / graceful-shutdown /      │
 │          review-save queue    │  push events    │   processing-pause  lifecycle modules    │
 │ deletion.ts, utils, hooks     │                 │ scanner / processor / duplicates         │
 └──────────────────────────────┘                 │ media-tools → media-process (FFmpeg)     │
                                                  │ duplicate-worker / visual-worker threads │
                                                  │ cache-service → cache-worker → cache-    │
                                                  │   worker-operations → cache.js (SQLite)  │
                                                  └──────────────────────────────────────────┘
                                                     │ settings.json, cache-index.json,
                                                     │ per-folder SQLite DBs, thumbnail files
```

| Subsystem | Responsibility | Key files |
|---|---|---|
| React components | Presentation and user interaction | `src/components/*` |
| Zustand store | Transient app and review state; the renderer's optimistic copy of review decisions; the review-save retry queue | `src/store.ts`, `src/store-invalidation.ts` |
| Renderer orchestration | Scan pipeline sequencing, menu-command dispatch, delete flows | `src/App.tsx`, `src/components/Sidebar.tsx`, `src/deletion.ts` |
| Preload / IPC | The only bridge. An explicit, typed `ElectronAPI` | `electron/preload.js` (`@ts-check`), `src/types.ts` (`ElectronAPI`), `scripts/check-ipc-contract.js` |
| Electron main | Lifecycle, window, `thumb:`/`video:` protocols, IPC registration, authorization against loaded folders, and (today) most pipeline orchestration. IPC sender checks and navigation guards live in `ipc-guard.js` | `electron/main.js`, `electron/ipc-guard.js` |
| Lifecycle modules | Keep-awake and finish actions, ordered shutdown (including asking the renderer to save pending review decisions), the processing pause | `power-manager.js`, `graceful-shutdown.js`, `renderer-save-flush.js`, `processing-pause.js` |
| Processing | Scanning, metadata, thumbnails, duplicate hashing and fingerprints | `scanner.js`, `processor.js`, `duplicates.js`, `duplicate-worker.js`, `visual-worker.js` |
| Media tools | FFmpeg/FFprobe path resolution, process runner with token cancellation, timeouts and an output cap | `media-tools.js`, `media-process.js` |
| Cache I/O | One worker thread owns every SQLite connection. Scope blocking and transition gates | `cache-service.js`, `cache-worker.js`, `cache-worker-operations.js`, `cache.js`, `cache-connection-manager.js`, `cache-migration.js` |
| Storage | Per-folder DBs (central or distributed mode), thumbnail files, `settings.json`, cache index JSON files | `cache.js`, `main.js` (`readJsonFile` / `writeJsonFile`) |

**Dependency direction (Current).** `src/` never imports from `electron/`, and `electron/` never imports from `src/`. The two sides share only type-only JSDoc imports from `src/types.ts`. The only runtime contact is the preload bridge.

## 3. State ownership

The roadmap's state-ownership table ([roadmap.md › State ownership](../roadmap.md#state-ownership)) is the **Decided** target. The table below shows where the code stands today.

| State | Authoritative owner today | Copies / derived | Notes |
|---|---|---|---|
| Review decisions (status, rating, favourite, bookmarks) | Folder SQLite DB, written through `cache-service.updateReviewState` | Zustand `videos` is an optimistic working copy, ahead of the DB | On an existing row only `updateVideoReviewStateBatch` changes these columns. Full-record saves (`saveCache`, `saveCacheAtomic`) leave them alone on conflict, so a stale snapshot cannot undo a decision. The save queue still lives in `store.ts`; extracting it as `review-persistence` is roadmap 3.3. |
| Pending review saves | Renderer retry queue in `store.ts` | — | Stale retries are rejected. A folder switch or close first makes one last save and shows "Decisions not saved" if anything is left. Quit asks the renderer to flush (2 s limit) before the cache producers drain. After 3 failed attempts the change is reported and dropped. |
| Settings | `userData/settings.json` | Zustand `settings` | The renderer is the only writer. Main still reads the file directly in many places, and `save-config` does not validate its payload. JSON writes in main are atomic (temp file, fsync, rename), but a corrupt file still silently becomes defaults. A cache-location migration commits the new location from main before the old caches are removed. Decided target: `settings-store` (roadmap 3.2). |
| Loaded folders, known paths, file identities | Main-process globals (`currentScanDirs`, `knownVideo*` maps, `activeCacheRoots`) in `main.js` | Renderer `directories`, `video.path` / `id` | Kept in sync only by the renderer calling `resetLoadedDirectories` and rescanning. Decided target: `library-registry` (roadmap 2.1). |
| File location and existence | File system | Everything else | Identity (size, mtime, birthtime/dev/ino) is re-checked before every delete. |
| Metadata, fingerprints, signatures | Folder DB, written by main and the workers | Read-only renderer copies, duplicate session cache in main | — |
| Thumbnails | Files under a thumbnail root plus DB rows | Renderer paths | Fixed file names; the `thumb:` protocol serves them `immutable`. Decided target: DB row decides the live generation (roadmap 2.2). |
| Selection, filters, review scope and index | Zustand | Derived `filteredVideos` | Review "where am I" is split across `reviewIndex`, `reviewScopeIds`, `activeReviewVideoPath` and `reviewPosition`; the last two are pushed back by `ReviewMode.tsx` effects. |
| Processing runs and cancellation | Main, in three mechanisms: `scanGeneration` (scan), module-level run tokens in `processor.js` (metadata, thumbnails), `activeDuplicateRun` (duplicates) | Renderer `scanIdRef` / `duplicateRunIdRef` drop stale results | There is no single owner. Reset, clear cache and migration all cancel the duplicate run through `cancelActiveDuplicateRun`, but each site still lists its other reset steps by hand, and the renderer still cancels before a rescan ([ADR-0007](decisions/ADR-0007-main-process-run-ownership.md)). |
| Processing pause | `processing-pause.js` | Renderer subscribes | Single authority (Decided). |
| Unfinished file operations | None today | — | Decided target: journals in `userData/file-ops` (roadmap 6.1). |

## 4. Invariants and lifecycle rules (Current, must be preserved)

- **Authorization comes from main's loaded-folder state.** Delete, open, save and protocol handlers accept a path only if main knows it from a scan inside a loaded folder (`isValidLoadedPath`, `validateCacheSavePayload`, `canServeVideoPath` / `canServeThumbPath`). The renderer is a trust boundary: types never replace runtime validation.
- **Delete re-checks identity** immediately before trashing or unlinking (`matchesFileIdentity`), and refuses when identity can't be confirmed.
- **IPC and navigation are locked to the app's own page.** `ipc-guard.js` wraps `ipcMain.handle` / `ipcMain.on` so calls from any other sender or frame are rejected, and it blocks navigation away from the app page and every new window.
- **Stale cache rows are pruned only for folders that were read completely.** A folder with an unreadable file is skipped for pruning (scanner `incompleteDirs`), so a temporary read error cannot remove saved decisions.
- **A cache-location migration commits the new location in main before the old caches are removed** (`commitCacheLocationSettings`), so a crash or a failed settings write cannot leave settings pointing at an emptied location.
- **All SQLite access goes through the single cache worker.** `cache-service` rejects requests while a transition is active, while shutting down, or for a blocked folder scope. This gate is the last line of defence against stale runs writing into a cleared or migrated cache. Don't bypass it.
- **Shutdown order:** `prepare` (set `isQuitting`, bump the scan generation, cancel runs) → `drain` the tracked cache producers → close the cache (5 s timeout, then terminate) → run the power action or update install (`graceful-shutdown.js`, `main.js` ~624–664). Only handlers wrapped in `trackCacheProducer` are drained. The renderer is also asked to save its pending review decisions (2 s limit, `renderer-save-flush.js`) before the cache producers stop accepting work.
- **Schema changes are additive only.** `saveCache` upserts explicit columns, so an older version leaves unknown columns untouched.
- **Stale results are dropped by run ID** in the renderer (`scanIdRef`, `duplicateRunIdRef`). Main does not detect a renderer reload or crash, so its runs keep going until the next scan cancels them.
- **Mirrored on purpose and kept in sync by hand:** the duplicate defaults (`src/keybind-defaults.ts` and `electron/duplicate-utils.js`) and the keeper-choice rules (`src/store.ts` and `electron/duplicate-utils.js`).

## 5. Decided

| Decision | Record |
|---|---|
| A seam moves only inside a roadmap feature that touches the code, with characterization tests first and the verbatim move kept separate from behaviour changes | [ADR-0001](decisions/ADR-0001-change-boundaries-only-with-feature-work.md) |
| Security boundary: context isolation, typed preload bridge, name-checked IPC contract, IPC registered centrally in `main.js` as thin delegations, no generic RPC layer | [ADR-0002](decisions/ADR-0002-preload-bridge-and-central-ipc-registration.md) |
| Backend stays plain CommonJS with opt-in `// @ts-check`; real TypeScript only through a recorded decision gate | [ADR-0003](decisions/ADR-0003-checked-javascript-backend.md) |
| Cache I/O goes only through `cache-service` → `cache-worker` → `cache-worker-operations`; schema changes are additive | [ADR-0004](decisions/ADR-0004-single-cache-worker-and-additive-schema.md) |
| Heavy work stays outside React; one pause authority; cancellation scoped per run | [ADR-0005](decisions/ADR-0005-processing-outside-react-with-per-run-cancellation.md) |
| New backend modules are plain functions with injected I/O: no classes, DI containers or repositories | [ADR-0006](decisions/ADR-0006-plain-function-backend-modules.md) |

## 6. Direction (not built yet)

These come from the roadmap's planned modules unless marked otherwise.

- **`main.js` gets thinner as features touch it.** Handlers become one-line delegations to focused modules: `library-registry` and `file-ops-delete` (2.1), `settings-store` (3.2), `processing-scheduler` (4.1), `file-ops-journal` (6.1). IPC registration stays in `main.js`.
- **One owner per kind of state**, as in the roadmap's ownership table. In particular, `review-persistence` becomes the only writer of review decisions, and main reads settings only through `settings-store`.
- **Renderer workflows become focused modules**, such as `deleteMarkedVideos()` (2.1), `regenerateThumbnails()` (2.2), `review-persistence` (3.3) and `file-operations` (6.2), following the flat `src/*.ts` convention with no `actions/` layer.
- **Typed IPC results per feature:** `DeleteResult` reasons, `FileOpResult` and `ClipExportResult` replace bare booleans where the caller needs to know why something failed.
- **Decided, not built:** one owner in main for running work, one session reset (cancels all runs, lifts a pause, cancels a chosen sleep or shutdown, resets loaded folders), skip-and-wait instead of cancelling runs when files are deleted or moved, and stop all work on a renderer crash or reload. See [ADR-0007](decisions/ADR-0007-main-process-run-ownership.md).

## 7. Patterns to preserve

- `main-helpers.js` style: pure functions with injected filesystem, shell and cache, unit-tested in `tests/electron`.
- Deep lifecycle modules with small interfaces and full test coverage: `graceful-shutdown`, `power-manager`, `processing-pause`, `media-process`, `cache-service`.
- New cache operations are added as new `case`s in `cache-worker-operations.js`, like `moveVideos`.
- Field-level, token-ordered deduplication in the review retry queue.
- Grep-able "done when" criteria for every extraction. For example, "`main.js` contains no `knownVideoPaths`".

## 8. Anti-patterns to avoid

- Generic RPC layers, per-domain `register*Ipc` functions, controller hierarchies, generic repositories, DI containers.
- A wrapper around every `window.electronAPI` call. Simple direct calls (`openVideo`, `SettingsModal` API calls) stay direct.
- Splitting a file only because it is large. Extract a coherent responsibility with its own tests.
- Adding a seam with a single adapter "for testability" when injected functions already give a test seam.
- Mirroring a rule a third time. If a rule is already duplicated across the seam, add a parity test before adding another copy.
- Starting FFmpeg outside `media-process`: it would bypass the timeout, output cap and token cancellation.
## 9. Open questions

- A "pick up where you left off" feature after a window crash or reload (restart the window, show a notice, reopen the last folders). [ADR-0007](decisions/ADR-0007-main-process-run-ownership.md) only stops the work; the rest is not decided.
- Should new IPC channels share one result convention (for example, a discriminated `ok` / `reason` result)? Today there are about six shapes: boolean, `{ok}`, `{status}`, string enum, `null`, and per-item arrays.
- Should main react to a renderer reload or crash (cancel runs, reset the session), or keep relying on the next scan to cancel them?
- Is a stale thumbnail visible after regeneration, given the fixed file names and the `immutable` cache header? Unverified.
- The real-TypeScript decision gate (D-TS) is scheduled with the file-operation journal (roadmap 6.1).

## 10. References

- [roadmap.md](../roadmap.md): Architecture Rules, State ownership, IPC contracts, New or extracted modules, Reference — Verified Code Facts.
- Tests: `tests/electron/*` (backend units), `tests/src/*` (renderer), `tests/e2e/*` (Playwright against Electron). No unit test loads `electron/main.js`.
