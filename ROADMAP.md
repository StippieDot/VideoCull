# VideoCull Roadmap

All implementation decisions recorded here were made interactively. Each feature includes the
chosen approach and relevant notes.

Every code claim was checked against the source (2.3.2, HEAD `b9f9cbb`) before it went into this
roadmap. Anything not yet checked is marked **(unverified)**. The facts the plan relies on are listed
in the [Reference](#reference--verified-code-facts) section at the end.

The previous roadmap (SQLite, quick wins, culling enhancements, cache architecture, feature additions,
documentation) shipped as `1.4.0`–`2.1.0` and is archived in git history.

> **Rule for implementation:** no code, comments, tests, commit messages, changelogs, docs, or
> UI text may reference other apps by name. Describe features by what they do in VideoCull.

> **Guiding constraint:** reuse existing infrastructure. Build no generic transfer, persistence or
> processing framework; each operation is a concrete, small function with its own tests.

---

## Feature Toggles

**Decision:** New optional features follow the existing `features` pattern in `AppSettings`
(`FeatureSettings` in `src/types.ts`). On by default, individually toggleable in the **Features** tab.

| Feature | Settings key | Default | Phase |
|---|---|---|---|
| Tags | `features.tags` | `true` | 3.4 |
| Keep clips | `features.clips` | `true` | 5.2 |

- Hiding a feature hides its UI only. Stored tags and clip definitions stay in the DB, and their
  safety rules (e.g. "has clips" protection, rename/move carrying them) keep applying.
- Settings such as the skip length (1.1) are ordinary settings, not feature toggles.

---

## Global Decisions

| Topic | Decision |
|---|---|
| Hover preview on cards | **No hover-scrub.** Clicking a thumbnail frame opens Review at that moment. Clicking a frame in Review's own strip seeks the player. |
| Move to folder | Its own action, separate from Delete and from the review statuses. |
| Move target outside loaded folders | Review state is **kept in the destination cache**. The video **leaves the current view**. |
| Cross-volume move | A later milestone. Same-volume move comes first. |
| Grid selection gesture | **User setting:** Shift-click range (default) / Drag to paint / Both. |
| Mark short videos scope | **Current filtered view**, with a note that Delete later applies to *all* videos marked Delete. |
| Rename | Extension **always locked**. |
| Explorer integration | **Folders only**, **both editions**. |
| Network folders | **Supported default: videos on the network, cache local.** Network-hosted cache DBs depend on 3.1. |
| Clips | Bookmarks define segments; you choose which segments to keep, as separate clips or joined into one; exported fast (lossless) or exact (re-encoded). Bookmarks keep working as seek points. The original can be **marked** Delete; it's never deleted directly. |
| Clips cut from longer videos | A timeboxed spike (Phase 8). Only **directed review suggestions** showing their coverage; never a keeper or deletion suggestion. |
| Unsupported-codec playback | Separate scope decision; not in this roadmap. |

### Defaults (change if you disagree)

- **Permanent-delete prompt:** keep the existing prompt, but offer it only for `trash-unavailable`.
- **Escape during a paint gesture:** restores the selection from before the gesture.
- **Move collisions:** **Skip** (default) or **Keep both** (`name (2).ext`). Never overwrite.
- **Tag filter:** videos with **all** chosen tags.
- **Explorer request for a folder that's already loaded:** focus that folder in the library; don't
  reload or reset.
- **Recovery guarantee:** **process crash or kill** is guaranteed. **Power loss** is best-effort: the
  journal is fsynced, but Windows can't fsync a directory.
- **Downgrading:** additive storage (new tables and columns, plus `saveCache`'s explicit-column upsert
  leaving unknown columns untouched) helps preserve data, but doesn't prove an older version keeps its
  meaning. For example, an older version can change bookmarks without updating the clip definitions
  built on them. Safe downgrade behaviour must be validated before it's promised; until then, release
  notes don't promise it. Journals (6.1) carry the extra risk that an older version may prune an
  unfinished operation's data. Whether to change the format marker is decided later, not now.

---

## Architecture Rules

Applied inside the phases below, not as a separate refactor phase.

**Rule:** a boundary changes only when a roadmap item already touches that code, and only if it removes
duplication, an implicit shared state, or an untestable block. Each change is attached to the feature
that causes it, with **what moves**, **why**, and **how we know it's done**.

### Boundaries that stay as they are

- **Stack:** Electron + React/TS + Zustand + SQLite (better-sqlite3) + FFmpeg/FFprobe.
- **Security boundary:** `contextIsolation`, `preload.js` + `contextBridge`, an explicit `ElectronAPI`,
  and `check:ipc`. Only extended (0.1).
- **Cache I/O:** `cache-service` → `cache-worker` → `cache-worker-operations`. New cache operations
  (row transfer, tag tables, thumbnail publication) become new `case`s in `cache-worker-operations.js`,
  the same pattern as `moveVideos`.
- **Heavy work stays outside React:** scanning, FFprobe/FFmpeg, fingerprints, duplicate and visual
  workers. `processing-pause.js` stays the single pause authority.
- **`main-helpers.js` pattern:** pure functions with injected I/O, unit-tested. New backend modules
  follow it.
- **Pipeline handlers in `main.js`** (scan, metadata, thumbnails, duplicates), the updater and the HTML
  report change only slightly here, so moving them would be churn. The next feature that substantially
  rewrites one of them should extract it.
- **`SettingsModal.tsx`'s API calls** and simple component calls like `openVideo` and
  `setVideoFullscreen` stay direct.

### Backend type safety: checked JS first, real TS only behind a decision gate

- **New backend modules** start with `// @ts-check` and use JSDoc types that import the shared types
  from `src/types.ts`.
- **Existing files** opt in when a feature substantially rewrites them (named per feature).
- **`main.js`** never opts in as a whole; it shrinks instead.
- **Decision gate D-TS (in 6.1, before 6.2 rename):** decide whether real `.ts` backend modules are worth
  a build step (esbuild/tsc output for `electron/`, dev-script and electron-builder changes, Store package
  validation, `node --test` runners that understand TS). Go only if checked JS proved insufficient for the
  file-operation module. Whether Electron 44's Node can strip types natively is **(unverified)**; check
  that first.

### State ownership

| State | Owner (source of truth) | Others hold | Rule |
|---|---|---|---|
| Selection, review mode, scope and index, card scale, open dialogs, toasts | Zustand / component state | — | Transient; never persisted. |
| Undo history | Zustand, for the session | — | Stays in memory (1.2). |
| Review decisions (status, rating, favourite, bookmarks), later tags and clips | **Folder DB** across sessions | Zustand working copy for the session | The renderer edits optimistically. **`review-persistence` is the only writer** to the DB (after 3.3). A scan merges DB → renderer. |
| Metadata, fingerprints, signatures | Folder DB, written by main and workers | Read-only renderer copies | The renderer never writes these. |
| Thumbnails | Files + DB rows; after 2.2 the **DB row decides which generation is live** | Renderer paths | Publication order as in 2.2. |
| Ignored duplicate pairs, keybindings, processing, cache and UI settings | `settings.json` | Zustand edits them; main reads them | After 3.2, **main reads only through `settings-store`**, and the renderer writes only through one checked save path. |
| Tag vocabulary + tombstones | `settings.json` (via 3.2) | Folder DB cached definitions | As in 3.4. |
| Loaded roots, known paths, IDs and scan-time identities | **Main: `library-registry`** (after 2.1) | Renderer `video.path`/`id` (derived) | Identity checks happen only in main. |
| File location and existence | **File system** | Everyone else | Checked before every destructive step. |
| Unfinished file operations | Journal files in `userData/file-ops` (6.1) | — | Recovery runs before scans. |
| Processing pause / run state | Main (`processing-pause.js`, run tokens) | The renderer subscribes | — |

Two problems, both fixed inside a feature:
- Main reads settings directly in 9 places, and a corrupt file silently becomes `{}`. Fixed by 3.2.
- The known-video maps are an implicit global shared by the scan, delete and save handlers. Fixed by 2.1.

### IPC contracts that become explicitly typed

| Contract | Feature | Change |
|---|---|---|
| `batchDelete` / `permanentlyDelete` → `DeleteResult` | 2.1 | `reason` union + `code`; shared type used by preload, backend JSDoc and renderer |
| Thumbnail ready batch / `generateThumbnails` result | 2.2 | `{ path, seekSecs }[]` + `thumbGeneration` |
| `saveConfig` | 3.2 | Result typed and **checked** by every caller |
| Tag read and write paths (review-state payload) | 3.4 | Typed payload; main keeps runtime validation (`normalizeReviewStateChanges`) |
| `exportClips` → `ClipExportResult` | 5.3 | Per-clip `done \| failed(reason) \| cancelled` |
| `renameVideo` / `moveVideos` → `FileOpResult` | 6.2 / 6.3 | Per-file outcome union (`not-started`, `done`, `done-with-warnings`, `moved-state-pending`, `failed`, …) with location |
| Folder handoff event | 7.1 | `onOpenFoldersRequested(paths: string[])` |

**Types don't replace runtime validation.** Main still validates every IPC payload, because the renderer
is a trust boundary.

**Not done:** a generic typed-RPC layer, or per-domain `register*Ipc` functions. Handlers stay
**registered in `main.js` as thin one-line delegations**, so every channel stays visible in one place and
`check-ipc-contract.js` keeps working unchanged.

### New or extracted modules

| Module | Feature | Owns | Moves out of |
|---|---|---|---|
| `electron/media-tools.js` | 0.3 | `ffmpegPath` / `ffprobePath` resolution + startup check | path logic in `processor.js` / `duplicates.js` |
| `electron/media-process.js` | 0.2 | `probe`, `runFfmpeg`, per-run cancellation | `fluent-ffmpeg` |
| `electron/library-registry.js` | 2.1 | Loaded roots + known path → `{id, identity}` map: `reset`, `recordScanned`, `forget`, `isLoadedPath`, `identityFor`, `remap` | `main.js` globals |
| `electron/file-ops-delete.js` | 2.1 | Trash/permanent workflow: scope filter, identity check, reasons, cache artifact cleanup, empty-folder cleanup | `main.js:1484–1540`, `:2598–2715` |
| `src/deletion.ts` (extended) | 2.1 | `deleteMarkedVideos()` + pure `summarizeDeleteResults()` | duplicates in `App.tsx` and `Sidebar.tsx` |
| `src/thumbnails.ts` | 2.2 | `regenerateThumbnails()` | `App.tsx:602` |
| `electron/settings-store.js` | 3.2 | Load, validate, atomic and serialized writes, in-memory copy for main | 9 settings reads in `main.js` + the `save-config` body |
| `src/review-persistence.ts` | 3.3 | Save queue, retries, `settleReviewSaves`, ID remap | `store.ts:552–760` |
| `src/tags.ts` | 3.4 | Pure load-time reconciliation | new |
| `electron/processing-scheduler.js` | 4.1 | Aggregate + per-storage caps, runnable dispatch | new; `processor.js`/`duplicates.js` call it |
| `electron/file-ops-primitive.js` | 5.1 | No-overwrite move | new |
| `src/clips.ts` | 5.2 | Segment and clip helpers, `exportClips()` | new |
| `electron/clip-export.js` | 5.3 | `buildClipArgs`, run, verify, promote | new |
| `electron/file-ops-journal.js`, `file-ops-transfer.js` | 6.1 / 6.2 | Journal + recovery; rename/move stages | new |
| `src/file-operations.ts` | 6.2 | `renameVideo()`, `moveVideos()` | new |
| `electron/folder-handoff.js` | 7.1 | Message parse/validate, pending list | new; `edition-guard.js` + `bootstrap.js` wire it |
| `src/open-folders.ts` | 7.1 | One `openFolders(paths, source)` decision | `App.tsx` (`handleDirectoryPicked`, drop modal) + `Sidebar.tsx` recents |

New renderer modules follow the existing flat `src/*.ts` convention. There's no `actions/` layer and no
wrapper around every `electronAPI` call.

### How refactors are proven not to change behaviour

1. **Characterization tests first:** test the current behaviour of the moved functions (inputs →
   results/messages), with `main-helpers`-style injected fs/shell/cache fakes.
2. **Move verbatim** in one commit, and change behaviour in a **separate** commit.
3. Keep green: `check:ipc`, `tsc -p tsconfig.electron.json`, unit tests, and the relevant e2e
   (`delete-safety`, `relaunch-persistence`, `smoke`).
4. Each extraction lists grep-able completion criteria, e.g. "`main.js` contains no `knownVideoPaths`".

---

## Phase 0 — Media Toolchain & Licence Compliance

Replace the bundled 2018 FFmpeg and the deprecated `fluent-ffmpeg` before anything else builds on them.
Mostly invisible to users; ships with the licence notices the bundled binaries already require.

**Why first:**
- **Age and security.** The bundled ffmpeg is N-92722 (December 2018), and ffprobe is a different build
  (gyan.dev, February 2023). Both process untrusted user files.
- **Weak AV1.** The 2018 ffmpeg decodes AV1 only through early libaom: no `dav1d`, no native `av1`, no
  hardware AV1.
- **Two versions.** Metadata comes from one FFmpeg version, thumbnails and fingerprints from another.
- **Stale packages.** `@ffmpeg-installer` (2022) and `@ffprobe-installer` (2023) are unmaintained.
  `fluent-ffmpeg` is **deprecated on npm and its repository was archived in May 2025**.
- **Later phases depend on it:** 4.2 (cropdetect), 5.3 (clip export, concat `inpoint`/`outpoint`) and
  Phase 8.

**Facts (checked 2026-10-02):**
- **Release tags:** `n9.0.2` is the newest stable; `n8.1.3` is the previous stable line.
- **FFmpeg 8.1.3 shared GPL build (BtbN), unpacked:** DLLs `avcodec` 113.4 MB, `avfilter` 35.3,
  `avformat` 21.9, `swscale` 12.3, `avdevice` 4.7, `avutil` 2.9, `swresample` 0.7; `ffmpeg.exe` 0.5 MB,
  `ffprobe.exe` 0.2 MB. Total without `ffplay.exe`: **192 MB**. Includes `libdav1d`, native `av1`,
  `libx264` and `h264_nvenc`.
- **9.0.2:** the shared GPL zip is 82 MB (8.1 was 85 MB). Unpacked (checked 2026-10-03, `autobuild-2026-10-01-13-06`):
  `avcodec-63` 119.1 MB, `avfilter-12` 37.0, `avformat-63` 23.0, `avdevice-63` 4.9, `avutil-61` 3.0, `swscale-10`
  2.3, `swresample-7` 0.7; `ffmpeg.exe` 0.5, `ffprobe.exe` 0.2. Total without `ffplay.exe`: **190.9 MB** (+52 MB).
- **BtbN's `n9.0` builds are the release branch, not the tag:** the asset is
  `ffmpeg-n9.0.2-22-g46d8f462ee-win64-gpl-shared-9.0.zip` (9.0.2 + 22 commits). Pinning exactly `n9.0.2`
  needs our own build (0.5 Default A) or accepting the branch build and naming it as such.
- The current frame (`-vframes 1`, `-hwaccel auto`) and probe (`-print_format json`) argument lists run
  without errors or deprecation warnings on that build.
- **Today:** ffmpeg 61.5 MB + ffprobe 77.2 MB = **139 MB**. A static GPL build would ship two full-size
  exes, about 360 MB (estimated), which is why we use shared.
- **fluent-ffmpeg probed with FFprobe's default text output** (`-show_streams -show_format`, parsed
  line by line), not JSON. 0.2 switched to `-print_format json`; the fields `getVideoMetadata` reads are
  the same.
- **fluent-ffmpeg is used only in `processor.js`:** binary paths (`:4-5`), metadata via `ffmpeg.ffprobe`
  (`:47`), frame extraction via `seekInput().frames(1)` + `-q:v 5`, `-threads 1`, `scale=320:-1`,
  `-hwaccel auto` (`:231`), cancellation via `activeCommands` (`:136`, `:523`). `duplicates.js` already
  calls `spawn(ffmpegPath, …)` directly (`:363`).

### 0.1 Checked-JS Backend Setup

**Decision:** Type-check the plain-JS backend without adding a build step. Prerequisite for every
`@ts-check` module in this roadmap.

**Implementation notes:**
- Add `tsconfig.electron.json` (`allowJs`, `checkJs: false`, `noEmit`, including `electron/**/*.js` and
  `src/types.ts`) and run it in `test:ci`.
- Files opt in with `// @ts-check` and use JSDoc imports such as
  `@typedef {import('../src/types').DeleteResult}`.
- `preload.js` opts in and annotates its exposed object as `ElectronAPI`, so the compiler checks the
  method set and parameters against the renderer's contract.
- Verify that TypeScript 7's native compiler supports the `checkJs` + JSDoc features used here
  **(unverified)**.
- **Done when:** `npx tsc -p tsconfig.electron.json` passes in CI; preload is checked; nothing changes at
  runtime (no build step, no packaging change).

### 0.2 Replace fluent-ffmpeg with Plain Process Calls

**Decision:** One small module instead of a deprecated wrapper. Same arguments, new transport.

**Implementation notes:**
- `electron/media-process.js` (`@ts-check`), about 60–100 lines:
  - `probe(path, token)`: `execFile(ffprobePath, ['-v','error','-print_format','json','-show_format',
    '-show_streams', path])`, returning the shape `getVideoMetadata` reads today (`format.duration`,
    `format.bit_rate`, `format.tags`, `streams[]`). Has a timeout (hang protection), a bounded stdout,
    and rejects malformed JSON as a probe failure. Today's metadata probe can't be stopped.
  - `runFfmpeg(args, token)`: spawn with `windowsHide`, bounded stderr capture, a promise that resolves
    or rejects, and cancellation registered with the token.
- **Cancellation stays scoped per run.** Each pipeline (metadata, thumbnails, duplicates, later clip
  export) keeps its own token. Cancelling thumbnails never kills a clip encode; killing everything is
  reserved for app shutdown. This replaces `activeCommands` per pipeline, not with one global list.
- Long and UNC paths keep using `toFfmpegInputPath`.
- `extractFrame` builds the **same argument list** fluent-ffmpeg builds today. Retry offsets,
  `-threads 1` and `-hwaccel auto` behaviour are unchanged.
- `duplicates.js` moves its own spawn/cancel code onto `runFfmpeg` **only where that's a verbatim move**.
  Its gray-frame pipe reading stays.
- **Order:** characterization tests capturing the **exact argument arrays** fluent-ffmpeg produces for
  `extractFrame` (with and without hwaccel and threads limit) → snapshot `getVideoMetadata` results for
  fixture files → swap the implementation → remove `fluent-ffmpeg` from `package.json` and the packaging
  `files` list.
- **Done when:** nothing requires `fluent-ffmpeg`; argument and metadata snapshots match; cancel kills
  running processes (tested with a long-running fake).

### 0.3 Pinned FFmpeg 9.0.2 Shared Build

**Decision:** **FFmpeg 9.0.2, BtbN `win64-gpl-shared`**, pinned to a dated release asset (not the rolling
`latest` tag), with its **SHA-256 recorded in the repo**. Fallback if 9.0 causes trouble: `n8.1.3`, the
same way.

**Implementation notes:**
- **Keep the archive under our own control.** BtbN keeps only the last 14 daily builds and each month's
  last build (for two years). The exact archive (or our own build, see 0.5) is uploaded **once** as an
  asset of a GitHub release (`toolchain-ffmpeg-9.0.2`). The fetch script downloads only from there.
  That release must never be picked up by the app updater, which reads GitHub releases (`publish.provider:
  github`) and could treat it as a new VideoCull version. Host it in a separate toolchain repository,
  or otherwise prove the updater ignores it.
- **Windows minimum: decide.** BtbN only guarantees Windows 10 22H2 (build 19045). The Store manifest
  declares `10.0.19041.0` (`check-store-config.js:30`). Either raise the minimum to 19045, or test the
  build on 19041.
- **DLL inventory:** list the DLL imports of `ffmpeg.exe`/`ffprobe.exe` and all 7 DLLs (`dumpbin
  /dependents` or equivalent). Only system DLLs may remain outside the bundle. A cold-install test
  without any CI cache must run.
- **Fetching:** `scripts/fetch-ffmpeg.js` downloads the zip, checks the hash and extracts **only**
  `ffmpeg.exe`, `ffprobe.exe` and the 7 DLLs to `vendor/ffmpeg/`. Runs in `postinstall` and CI.
  `vendor/ffmpeg/` is git-ignored and cached in CI by version + hash.
- **Packaging:** electron-builder `extraResources` copies `vendor/ffmpeg/` to `resources/ffmpeg/` for
  **both** NSIS and the Store package. The DLLs sit next to the exes. Remove the `@ffmpeg-installer/**`
  and `@ffprobe-installer/**` entries from `files`/`asarUnpack`, remove both packages, and update
  `check-installer-config.js`, `check-store-config.js` and `validate-store-package.js`.
- **Path resolution:** `electron/media-tools.js` (`@ts-check`) exports `ffmpegPath` and `ffprobePath`:
  `process.resourcesPath/ffmpeg` when packaged, `vendor/ffmpeg` in dev, an env override for tests only.
  At startup it checks both files exist and logs `-version` once. `processor.js` and `duplicates.js`
  import from it; the `app.asar` → `app.asar.unpacked` string replacement goes away.
- **Done when:** both editions run with the new binaries on a clean machine; Store package validation
  passes; package size is measured and recorded (expected about +50 MB unpacked).

### 0.4 Compatibility Check: Old Build vs New Build

**Decision:** Release gate for 0.3. No user-facing regression in metadata, thumbnails or duplicates.

**Implementation notes:**
- **Fixture set** (local, not committed if large): H.264/HEVC/AV1/VP9 MP4 and MKV, AVI/WMV, variable
  frame rate, rotated phone video, portrait video, no audio, with subtitles, a damaged file, very short
  and very long files.
- **Metadata:** `getVideoMetadata` output is the same field by field. Differences are listed and accepted
  explicitly.
- **Thumbnails:** each slot is produced and the images match visually. Changed pixels are fine; a black
  frame or failed slot is not.
- **Fingerprints:** compare pHash sequences from both builds against the duplicate thresholds. Within
  tolerance → keep existing caches. Otherwise bump the fingerprint key (the existing `fingerprint_key`
  mechanism) so fingerprints are recalculated once, and say so in the release notes.
- **Duplicate outcomes:** compare actual groups found with mixed old/new fingerprint caches, in both
  comparison modes (pHash and gray/visual), including files that failed extraction with the old build.
- **Compatibility detection:** `detectCompatibility` gives the same answers.
- **Timing:** thumbnail and fingerprint run times compared with the existing performance diagnostics.
- Every argument list we use is run at least once against 9.0.2.
- **Done when:** a short written report exists, with a decision on fingerprint invalidation.

> **Investigation option (not committed): reusable duplicate benchmark.** The fixture set and expected
> duplicate groups needed here could be built as a reusable, manifest-driven runner (corpus outside the
> repo) that reports false positives, false negatives and group counts per comparison mode. Later
> duplicate work (Phase 8, the tuning option after Phase 8) could then be measured with the same tool.
> Investigate whether that's worth the extra effort over a one-off check; extend the existing
> `test:duplicates` tests rather than adding a separate test path.

### 0.5 Licence Compliance for Everything We Ship

**Decision:** Ships together with 0.3. Every shipped licence is compatible with AGPL-3.0 and none forbids
selling; the gaps are missing notices, licence texts and source, not incompatibility.

**Audit (2026-10-02, `release/win-unpacked` 2.3.2 + `license-checker --production`):**

| Shipped component | Licence | Status today |
|---|---|---|
| VideoCull itself | AGPL-3.0-only | Source public, tags exist. **Gap:** no licence copy in the installer or Store package, **no legal notice in the app UI**. |
| 25 npm packages (react, zustand, better-sqlite3, electron-updater, …) | MIT | Compatible. LICENSE files ship inside `app.asar` but are invisible to users. |
| lucide-react, semver, graceful-fs, isexe, which | ISC | Compatible. |
| `@videojs/*` (7 packages), signal-polyfill | Apache-2.0 | Compatible with (A)GPLv3. No NOTICE files. |
| argparse / sax | Python-2.0 / BlueOak-1.0.0 | Compatible (permissive). |
| Electron + Chromium | MIT + Chromium third-party licences | ✓ `LICENSE.electron.txt` and `LICENSES.chromium.html` ship next to `VideoCull.exe`. |
| Bundled `ffmpeg.exe` / `ffprobe.exe` | **GPL-3.0-or-later** (`--enable-gpl --enable-version3`; npm metadata wrongly says LGPL-2.1) | **Gap:** no GPL text, attribution or source offer. |
| Blender demo footage | CC-BY | Docs only, credited in `docs/reference/media-credits.mdx`. ✓ |

**Implementation notes:**
1. **`THIRD_PARTY_NOTICES.txt`, generated at build time** by `scripts/generate-notices.js`:
   - Takes its package list from the **packaged** `app.asar` + `resources/`, not npm metadata (2.3.2 had
     40+ modules including transitive ones like `async`, `sax`, `js-yaml`).
   - Writes name, version, licence and full licence text per package.
   - **Fails the build** on a licence outside the allow-list (MIT, ISC, Apache-2.0, BSD-2/3-Clause,
     BlueOak-1.0.0, Python-2.0, 0BSD, CC0-1.0, GPL-3.0-or-later for FFmpeg only) or a missing licence file.
   - `licence-overrides.json` corrects wrong metadata.
   - Runs during packaging, **after the application is assembled and before the final distributable is
     produced** (e.g. electron-builder's `afterPack` hook), for both `package` and `package:store`.
     `test:ci` doesn't depend on a packaged app; it only unit-tests the generator against fixtures.
2. **FFmpeg section** (written by the 0.3 fetch script into the notices file +
   `resources/ffmpeg/LICENSE.txt`): version and tag, build source, configure flags (`-buildconf`), GPLv3
   text, and **corresponding source**:
   - The FFmpeg tag tarball + BtbN scripts is **not** complete corresponding source; a GPL build includes
     x264, x265, dav1d and others at specific revisions.
   - **Default A:** build FFmpeg ourselves once per version in CI with BtbN's scripts at a pinned commit,
     and archive **every downloaded source** + scripts + logs next to the binaries in our toolchain
     release. CI build duration **(unverified)**.
   - **Alternative B:** a provider that publishes complete corresponding source **(unverified for BtbN
     and gyan.dev)**.
   - The same gap exists **today** for the bundled 2018 binary. Don't rely only on third-party links.
3. **Ship VideoCull's own `LICENSE`** (AGPL-3.0) via `extraResources` in both packages, next to the
   notices. `check-installer-config.js` and `validate-store-package.js` check both files are present.
4. **Legal notice in About (AGPL §5d):** a small "Licence" section with "© \<year\> StippieDot",
   "VideoCull is free software under the GNU AGPL v3.0, without any warranty", and **View licence**,
   **Third-party notices**, **Source code for this version** (GitHub tag of the running version).
   Bundled files open through a dedicated `open-legal-file` IPC with allow-listed names only.
5. **Microsoft Store listing:** Partner Center → Properties → **License terms** set to **custom terms =
   AGPL-3.0** + source link, instead of the Standard Application License Terms. The description mentions
   "Open source under AGPL-3.0". Manual check; record the result here.
6. **Release checklist:** the release workflow fails if the tag's GitHub release lacks the FFmpeg source
   asset; Store submissions use a build from a tagged commit.
- **Contributors:** one outside contributor (1 commit). A future dual licence needs their permission (or
  a rewrite of that change) and a CLA for new contributions.
- **Not legal advice.** Codec **patents** (H.264/HEVC encoding) are a separate, known and accepted risk.

**Tests:** `generate-notices` fails on an unknown licence or missing text, and covers every package in
the packaged `app.asar`; the packaged-app smoke test finds `LICENSE`, `THIRD_PARTY_NOTICES.txt` and
`ffmpeg/LICENSE.txt`; About DOM test covers the licence text, the three links, and `open-legal-file`
rejecting names not on the allow-list.

### 0.6 Keeping the Toolchain Maintainable

- A version bump means changing one version string + hash and re-running 0.4.
- A CI job prints `ffmpeg -version` from the packaged app (smoke test).
- A trimmed custom build is deliberately not done (see Skipped Features).

---

## Phase 1 — Quick Wins

Small, ready-to-build changes. No architectural dependencies, and neither touches FFmpeg.

### 1.1 Configurable Skip Length in Review

**Decision:** Setting `seekStepSecs` with presets 2/5/10/15/30 (default 5). Every seek path and every
displayed shortcut text uses it.

**Implementation notes:**
- Add to settings defaults and validation.
- **Two seek paths exist today, and both must use the step:**
  - The app keybinds `keySeekBack`/`keySeekForward` (`ReviewMode.tsx:492`).
  - The player's own hotkeys (`PLAYER_HOTKEYS`: ArrowLeft/ArrowRight/j/l → `seekStep`,
    `ReviewMode.tsx:21`). Pass the setting as their step value, so a remapped app keybind never leaves a
    player hotkey seeking by a different amount.
- Shortcut texts (including the settings list) show the actual value. Docs:
  `docs/reference/keyboard-shortcuts.mdx`.

**Tests:** default and validation; DOM: arrow keys, j/l and a remapped seek keybind all seek by the
configured step.

### 1.2 Mark Short Videos for Deletion

**Decision:** A dialog that marks videos below a duration threshold as Delete, scoped to the **current
filtered view**, with protections. One undo entry.

**Implementation notes:**
- Threshold validated as finite and > 0. Videos with missing, zero or negative duration count as
  "unknown duration" and are never marked.
- Live preview of count and size.
- Protected counts: Keep, Skip, rated, favourited, bookmarked, already Delete. Protections apply even
  when the rating or favourite UI is hidden. (5.4 adds "has clips".)
- A note that Delete later applies to all videos marked Delete.
- Eligibility is rechecked at Apply, then applied via `setVideoStatusesBatch`.
- `undo` builds a `Set` from `videoIds` (today it calls `videoIds.includes` per video,
  `store.ts:1244`). No persistent undo history.

**Tests:** `selectShortVideosForDelete` covers each protection rule and invalid input; **Apply → undo →
await persistence → reload → statuses restored**; recheck at Apply; undo cost goes into the performance
diagnostics instead of a machine-dependent timing assertion.

---

## Phase 2 — Delete Safety & Thumbnail Seeking

Clear delete errors, thumbnails that know their time, and a faster selection gesture.

### 2.1 Delete Error Reasons

**Decision:** Every failed delete reports *why*. Only `trash-unavailable` offers the existing permanent
delete prompt; `in-use` offers Retry for the failed files only.

**Gate:** 2.1a — record the actual `shell.trashItem` errors for a locked file, a permission failure, and
a drive without a Recycle Bin.

**Implementation notes:**
- `DeleteResult` gets a `reason`: `changed`, `unverifiable` (stat failed; cause kept), `out-of-scope`,
  `in-use`, `permission`, `not-found`, `trash-unavailable`, `unknown`, plus the raw `code`.
- `matchesFileIdentityAtPath` returns the stat error cause instead of a bare `false`. Deletion is still
  refused whenever identity can't be confirmed.
- Scope check and full identity check also run **before every retry**.
- Before deleting, the Review player is unloaded and the processing run touching those files is
  cancelled.
- **Architecture (in this order):**
  1. **`library-registry.js`:** move `currentScanDirs` and the three `knownVideo*` maps behind functions;
     all ~25 call sites in `main.js` use it. Needed now by the delete module, later by rename/move and
     the folder handoff. **Done when** `main.js` has no `knownVideoPaths`, `knownVideoIdsByPath`,
     `knownVideoIdentitiesByPath` or direct `currentScanDirs` mutation, and the registry has unit tests.
  2. **`file-ops-delete.js`:** move `collectDeletionCacheTargets`, `removeDeletedVideoCacheArtifacts`,
     `maybeRemoveEmptyDeletedVideoFolders`, `finalizeDeletedFiles` and both handler bodies **verbatim**,
     characterization tests first. Add `reason`/`code` in a separate commit. **Done when** the
     `batch-delete`/`permanently-delete` handlers are one-line delegations and `delete-safety.spec.ts`
     passes.
  3. **Renderer:** `deleteMarkedVideos()` and `summarizeDeleteResults()` in `deletion.ts`. `App.tsx`'s
     menu action and `Sidebar.tsx` both call it, keeping only their own confirm and notify callbacks.
     **Done when** result counting and toast text exist once; `deletion.test.ts` covers every reason.

**Tests:** every reason other than `trash-unavailable` never reaches the permanent prompt; a file
replaced between attempts (same path and size) → `changed`; a retry only touches the failed files.

### 2.2 Thumbnail Seek Times, Click-to-Seek and Scrub Previews

**Decision:** Each new thumbnail stores the time it was actually taken. Clicking a grid frame opens
Review at that moment; hovering Review's seek bar shows the matching thumbnail. Legacy thumbnails without
a stored time open Review at the start — no guessing from slot numbers.

**Implementation notes:**
- **Seek times:** `extractFrame` resolves `{ path, seekSecs }`, including retry offsets. Each image travels
  with its time through sort, cache, IPC and renderer. Cache: additive `seek_secs` column; the change
  check compares path **and** time. Verify on the 9.0.2 build that the stored time lands within about a
  frame of the picture (VFR, stream start offsets) before anything relies on it.
- **Provenance:** per-video `thumb_generation` (`legacy` / `v2-seek-times`, later `v3-smart`). Videos are
  rebuilt only when the user asks or a newer generation is enabled; old caches are never silently
  rewritten.
- **Safe rebuild publication:**
  1. Generate into `<id>.gen-<runId>/`, one folder per run.
  2. Commit DB rows pointing to the new folder's paths and times in one transaction
     (`publishThumbnails` case in `cache-worker-operations`).
  3. Only after the commit is **awaited**, delete the old folder. (Today `flushBatch` starts the write
     without awaiting it, `main.js:2312`.)
  - A failed or cancelled run deletes only its own folder. At startup, `<id>.gen-*` folders not
    referenced by the DB are removed — only for DBs that **opened successfully**.
  - The renderer **no longer clears** thumbnail records before regenerating (`App.tsx:607`); it swaps
    them when the result arrives.
  - **Thumbnail rows have one writer: the main pipeline.** Full renderer cache saves
    (`writeThumbnailRowsIfChanged`, `cache.js:673`/`:977`) stop writing thumbnail rows, so a stale copy
    can't restore a deleted generation.
  - `liveThumbDir(db, id)` decides where a video's thumbnails live. Delete cleanup (`main.js:1498`),
    stale-thumbnail cleanup (`main.js:1215`), transfer stage 5 (6.1) and clear-cache all use it.
- **Grid frame click:** each frame is a keyboard-reachable button above the overlay. In selection mode a
  click toggles selection. An incompatible video opens Review paused.
- `enterReviewAndPlay(videoId, scopeIds?, { startAt })` keeps the scope argument.
- **Seek requests in Review:** each has a `requestId` so repeated clicks seek again; immediate if
  `readyState ≥ HAVE_METADATA`, otherwise on `loadedmetadata`; navigating away discards it. The
  `VideoPlayer` memo stays untouched.
- **Scrub previews:** feed the Video.js skin a `kind="metadata"`, `label="thumbnails"` track with one cue
  per stored frame. Recorded times only; legacy frames get no preview. Update the track outside the
  memoized player (as with bookmark chapters), use the existing `thumb:` URLs (verify CSP and protocol
  permissions), and swap cues with the published generation.
- **Architecture:** `processor.js` opts into `@ts-check`. `ThumbnailFrame { path, seekSecs }` and
  `thumbGeneration` go in `src/types.ts`. `handleRegenerateThumbnails` (`App.tsx:602`) moves to
  `src/thumbnails.ts` as `regenerateThumbnails()`. **Done when** `processor.js` passes the electron type
  check, `App.tsx` no longer builds cleared-video arrays, and the existing `processor.test.js` and
  `processor.helpers.test.js` pass unchanged before new tests are added.

**Tests:** retry offset recorded; a missing slot keeps pairs aligned; the t=0 fallback; same filenames
with new times are rewritten; **old count 6 vs current count 12 → legacy is unknown and opens at 0**;
publication interrupted between files and DB commit; two overlapping rebuilds; seek on an already-loaded
video and a repeated seek; duplicate-review scope preserved; scrub cues aligned with stored frames
(including missing slots and retry offsets); legacy frames omit previews; navigation and republishing
replace previous cues.

### 2.3 Drag-to-Paint Selection

**Decision:** A selection gesture setting: Shift-click range (default) / Drag to paint / Both. Starting
on an unselected card adds; starting on a selected card removes. Escape restores the previous selection.

**Implementation notes:**
- Frame buttons and the thumbnail area start a paint once the pointer moves past ~5px; below that it's a
  click. Rating, favourite, keep/delete, menu, select-toggle and play controls never start a paint.
- Pointer-up **commits**. Escape and `pointercancel` restore. `lostpointercapture` restores only if the
  gesture **wasn't already committed** by pointer-up.
- Autoscroll works while the pointer is held still at an edge; recycled virtualized rows are handled.

**Tests:** add/remove helper; **pointerup → lostpointercapture keeps the commit**; Escape restores;
control exclusions; a **manual check on a real virtualized grid**.

---

## Phase 3 — Reliable Settings & Tags

Settings and review saves become verifiably durable, then tags are built on top of them.

### 3.1 Baselines and Network-Cache Policy

**Decision:** Measure before tuning, and keep caches local for network sources by default.

**Implementation notes:**
- Measure with the existing performance diagnostics: a large library, HDD, USB, and a network source
  with a **local** cache. Phase 4 defaults come from these numbers.
- **Network-hosted cache DBs** (distributed mode on a share): investigate the effective `journal_mode`,
  locking, and disconnects during writes. Passing these tests doesn't by itself prove the setup is safe.
- Outcome: a written placement policy, default local cache for network sources.
- Moving existing data out of network caches must **carry over current decisions**, never silently start
  a fresh DB.

### 3.2 Reliable Settings Save

**Decision:** Settings writes are atomic, ordered and checked. A corrupt settings file is reported, never
silently replaced by defaults.

**Implementation notes:**
- `save-config` writes atomically (temp file + fsync + rename, the `createMarker` pattern).
- **Serializing alone isn't enough:** a stale full snapshot arriving later would still overwrite newer
  settings. So the renderer sends **patches** (changed keys only) that main merges onto its copy;
  main-originated changes (ignored-pair remaps, tag tombstones) are applied in main and pushed with
  `settings-changed`; main publishes its copy only after the disk write succeeds.
- **Every** renderer save goes through one path: the 7 `saveConfig` calls in `store.ts` **and** the
  separate queue in `App.tsx:253` (`queueSettingsSave`). The renderer **checks the boolean result**;
  `saveSettingsQuietly` logs a `false` result too.
- **Corrupt settings:** the file is kept as `settings.corrupt-<time>.json` and the user is told. Every
  successful write also keeps `settings.json.bak`. While settings are corrupt, **cache-dependent work
  waits** (no scan, cache write or cache creation) until the user chooses "Restore last good settings" or
  "Start with defaults".
- **Architecture:** `electron/settings-store.js` (`@ts-check`) with `load()` (validates once), `get()`
  (in-memory copy) and `save()` (normalizes, atomic, serialized). All 9 settings reads in `main.js` use
  `settingsStore.get()`. Renderer: one `persistSettings()`. **Done when** `main.js` has no `CONFIG_FILE`
  reads, `store.ts` has exactly one `window.electronAPI.saveConfig` call, `settings-store` has unit tests
  for corrupt input, ordering and atomicity, and `relaunch-persistence.spec.ts` passes.

**Tests:** a `false` result is surfaced; concurrent saves keep the newest; a crash during a write leaves
the old file valid.

### 3.3 Review Persistence Module

**Decision:** Move the review-save queue out of `store.ts` and give it an explicit "all saves settled"
signal. Prerequisite for tag edits (3.4) and rename/move (6.2).

**Implementation notes:**
- Move `store.ts:552–760` **verbatim** into `src/review-persistence.ts`, characterization tests first.
  No behaviour change in the move commit.
- Then add `settleReviewSaves(videoIds)`: waits for in-flight requests **and** retry-queue entries for
  those IDs. While an operation runs, new edits for those IDs are held and applied to the new ID
  afterwards.
- **Failure is explicit:** resolves `{ ok: false }` when saves for those IDs failed or retries ran out
  (today they're dropped after a notification, `store.ts:690`). An empty queue is **not** treated as
  success.
- Add `remapVideoIds` for rename/move.
- **Done when:** `store.ts` contains no retry-queue code.

### 3.4 Tags

**Decision:** A global tag vocabulary with per-folder associations. Tags propagate only when a folder
loads. Deleted tags are tombstoned; unknown tags found in a folder are offered back, never added silently.

**Implementation notes:**
- **Representation:** settings hold the vocabulary `{id, name, color}` plus **tombstones**. Each folder
  DB holds `tags(id, name, color)` and `video_tags(video_id, tag_id)`.
- **On folder load** (no startup scan):
  - Known IDs: the settings name and colour win.
  - Tombstoned ID: its associations and cached definition are removed from that DB.
  - Unknown, non-tombstoned ID: **offered back** ("Restore 3 tags found in this folder?"). When a
    recovered name matches an existing tag with a different ID, the user chooses merge or "name (2)".
- **Deleting a tag** creates a tombstone and can't be undone; bringing it back means a new tag with a new
  ID.
- **Known limitation:** if settings and tombstones are lost completely, offline folders can bring deleted
  tags back. The restore offer makes that visible.
- **UX:** chips on cards ("+k" when there are more); `T` opens a picker with type-ahead and create-new;
  the selection toolbar's "Tag…" adds or removes a tag for all selected videos with a mixed state; each
  bulk change is one undo entry; sidebar filter matches all chosen tags.
- **Architecture:** vocabulary via `settings-store`; associations via new `cache-worker-operations`
  cases; edits flow through `review-persistence`, the same path as status and rating. A tag is never
  stored only in the renderer. Load-time reconciliation is a pure function in `src/tags.ts`.

**Tests:** a settings save returning `false` during create, delete or recovery; recovery alongside a
manual edit; tombstone persistence; older versions and the other edition don't wipe tags when they save.

---

## Phase 4 — Processing Performance

Defaults come from the 3.1 measurements.

### 4.1 Storage-Aware Scheduling

**Decision:** Workers pick the next **runnable** item (one whose storage device has free capacity), not
the next item in the queue. Queued HDD items never hold a worker.

**Implementation notes:**
- The scheduling unit is one video's processing step.
- **Caps:** an aggregate cap across thumbnails, metadata, fingerprints, **full hashing** and later
  **copy/verify**, defaulting to today's thumbnail limit; plus a per-storage-device cap (volume → physical
  disk where resolvable, otherwise volume serial or UNC share root). `unknown` means no extra reduction.
  Classification is async with a timeout and never blocks opening a folder.
- **Lifetime:** a cancelled waiter is removed immediately; a running item releases its slot when the
  **underlying process has exited**; the slot is released before waiting at a pause checkpoint; each
  step acquires once, so a cap of 1 can't deadlock.
- GPU cooldown batches keep working as today. Equal job counts aren't assumed to mean equal load; the
  prototype measures CPU, memory and I/O.
- **Architecture:** `electron/processing-scheduler.js` (`@ts-check`) holds caps and dispatch.
  `processor.js` (worker loop at `:404`) and `duplicates.js` (full hashing) ask it for runnable work.
  **Done when** no pipeline keeps its own concurrency counter besides the scheduler, except the GPU
  cooldown batch size.

**Tests:** cap = 1 with all pipelines running; HDD-first queue followed by SSD work → SSD proceeds; pause
before a slot is granted; cancel while paused; resume starts each item exactly once; a slot is held until
the process exits; cooldown still applies.

### 4.2 Smarter Thumbnail Frames

**Decision:** Start with dark-frame replacement only. Slot coverage never shrinks.

**Implementation notes:**
- Bounded alternative times inside each slot, scored with `frameDarkRatio`, extracted inside the
  processor's own token and `runProcessingActivity`.
- Per-slot fallback: keep the original frame when no candidate is better.
- Publication as in 2.2, generation `v3-smart`.
- Sharpness and diversity scoring only if they measurably help.
- **Cropping:** a separate gated prototype, thumbnails only.

**Tests:** all candidates dark → original kept; a failing candidate doesn't drop its slot; cancel or
commit failure keeps the old set.

---

## Phase 5 — Keep Clips

Bookmarks split a video into segments. In Review you choose which segments to keep, as separate clips or
joined into one, export them, and optionally mark the original for deletion. Keep only the good parts.

### 5.1 No-Overwrite Move Primitive

**Decision:** Native **MoveFileEx without the replace flag**: one atomic call that refuses if the
destination exists. Needed for promoting exported clips here and for rename/move in Phase 6.

**Implementation notes:**
- **Prototype question:** how to call it from Electron — an FFI module, a tiny N-API addon, or a
  PowerShell `File.Move` per batch. Compare packaging for both editions, speed and error codes.
- **Source replacement:** a path-based MoveFileEx can't guarantee the moved file is the one checked at
  preflight. Compare with a **handle-based** rename (open source, verify identity on the handle,
  `SetFileInformationByHandle` with `FILE_RENAME_INFO`, ReplaceIfExists = false). Matters most before
  cross-volume source deletion. Prototype decision, not settled.
- **Removed:** the placeholder + `fs.rename` fallback, because `fs.rename` silently overwrites.
- **Hard link + unlink** only as a backup: two steps, so recovery must handle **both names existing**. If
  the unlink fails, the source stays and only the operation's own destination link is removed after an
  identity check.
- Unsupported file systems (to measure: FAT/exFAT, SMB) report "not supported on this drive" rather than
  falling back to anything unsafe.

**Tests:** a destination created after the preview → refused, source untouched; a case-only rename;
in-use and permission error codes kept; FAT/exFAT and SMB behaviour measured.

### 5.2 Clip Definitions in Review

**Decision:** Clips are a **choice layered on top of the segments bookmarks already define**. Bookmarks
keep working exactly as today (add, remove, click to seek, timeline chapters unchanged).

**Prior art (functions only):** fixed-length loop export with an overwriting save dialog, and a separate
compilation editor with transitions; the original is never removed. **Taken:** export from Review,
optional re-encode, clear errors. **Not taken:** fixed-length clips, overwriting, transitions, a separate
editor screen.

**Implementation notes:**
- **Segments:** sorted bookmarks `b1 < … < bn` give `[0, b1]` "start–1", `[b1, b2]` "1–2", …,
  `[bn, duration]` "n–end". Derived, never stored.
- **Data model:** `clips?: { id: string; ranges: [number, number][] }[]` on `Video`. Each clip is **one
  output file**. Ranges are stored by **time**, not segment index, so adding a bookmark never changes a
  clip. Adjacent kept segments in one clip are stored merged.
- **Validation (renderer + main):** every boundary equals a current bookmark, `0` or the duration;
  ranges inside a clip are sorted and non-overlapping; a segment belongs to at most one clip. Handles
  duplicate bookmarks, bookmarks past the duration and zero-length segments.
- **Storage:** additive JSON `TEXT` column `clips`, saved through the review-state path like bookmarks
  (`VideoReviewChanges` + `normalizeReviewStateChanges`). Bookmark and clip changes are saved in one
  update. Older versions keep the column on row updates (`ON CONFLICT … DO UPDATE`); tested.
- **When bookmarks change:** adding one inside a kept range only splits the display. Removing one that
  **bounds** a kept range prompts: "This bookmark is used by Clip 2. Remove it and drop that part from
  the clip / Cancel." Removing one **inside** a merged range needs no prompt.
- **Segment strip** under the player: one chip per segment ("1–2 · 0:20"), coloured and labelled by clip
  (A, B, C…) when kept, grey otherwise. Clicking a chip seeks to the segment start.
- **Keep:** a chip toggle, or `keyClipToggle` for the segment under the playhead. A newly kept segment
  becomes its own clip, so 1–2 and 2–3 kept one after another give **two clips** by default.
- **Join:** Shift+click a chip, or `keyClipJoin` (adds to the last-used clip). 1–2 + 3–4 joined → one
  file with both parts; 1–2 + 2–3 joined → one continuous range. "Split from clip" moves a segment back to
  its own clip. Unkeeping the last segment removes the clip.
- **Play clip** previews its ranges back to back.
- Each clip change is one undo entry.
- **Timeline:** kept ranges as coloured bands per clip, if the player skin allows the overlay
  **(unverified)**; otherwise the segment strip is the display.
- **Grid card:** a "✂ 2" badge.
- Both keybinds appear in the shortcut lists and docs.
- **Architecture:** `src/clips.ts` with pure `segmentsFromBookmarks`, `keepSegment`, `joinSegment`,
  `splitSegment`, `normalizeClips`, `clipsAffectedByBookmarkRemoval`. `Clip` goes in `src/types.ts`; the
  column in `VIDEO_SCHEMA_COLUMNS`.

**Tests:** `segmentsFromBookmarks` with none, one or duplicate bookmarks; keep → two clips; join
non-adjacent → one clip with two ranges; join adjacent → one merged range; split back; bookmark added
inside a kept range leaves the clip unchanged; bounding bookmark removal prompts and drops the segment;
inner bookmark removal doesn't prompt; main rejects ranges off bookmarks; old-version row update keeps
`clips`.

### 5.3 Clip Export

**Decision:** Per video, or "Export all clips". **Exact** (re-encode) ships first; **Fast** (stream copy,
lossless) follows after a prototype and then becomes the default.

| Mode | One range | Joined ranges | Pro | Con |
|---|---|---|---|---|
| **Fast** | `-ss start -i src -t len -map 0:v -map 0:a? -c copy -avoid_negative_ts make_zero` | Concat demuxer on the same source with `inpoint`/`outpoint` per range, `-c copy` | Lossless; seconds per clip; keeps codec and container | Each range starts at the keyframe **before** its start (early, never late). Joins can show a short jump at seams. |
| **Exact** | `-ss start -i src -t len -c:v libx264 -crf 18 -preset veryfast -c:a aac -b:a 192k -movflags +faststart` → `.mp4` | `trim`/`atrim` per range + `concat` filter, same encoder settings | Frame-accurate, clean seams; output plays in Review even when the source didn't | Slower; re-encoded |

**Delivery:**
- **5.3a** single-range exact export + export record.
- **5.3b** exact joins.
- **5.3c** fast mode, only after a prototype measures boundary and seam behaviour (long GOPs, B-frames,
  VFR, timestamp offsets, delayed audio), concat `inpoint`/`outpoint`, rotation metadata, and files with
  subtitle or data streams.

**Implementation notes:**
- **Destination:** next to the original (default) or a chosen folder. Name `<name> [clip A].<ext>`, with
  a numeric suffix when taken.
- **No overwrite:**
  1. FFmpeg writes to `.<name>.<opId>.videocull-partial` **without a video extension**, format set
     explicitly (`-f mp4`/`-f matroska`). The scanner accepts files by extension only (`scanner.js:14`),
     so a `.mp4` staged name would be picked up while still growing.
  2. Verify the staged file: ffprobe duration within tolerance of the summed ranges (fast mode allows the
     keyframe lead), non-zero size, and a **full decode pass** (`-f null -`).
  3. Promote with the 5.1 primitive.
  4. A failed or cancelled export deletes only its own staged file.
- **Preflight:** parent identity still matches (`matchesFileIdentity`); destination writable; free space
  ≥ the estimate.
- **Pause and cancel:** pause takes effect **between** exports; cancel stops the active encode
  immediately.
- **CPU:** one encode at a time with an explicit `-threads` limit; through the 4.1 scheduler.
- **Exact mode details:** `-map 0:v:0 -map 0:a:0?`, `-pix_fmt yuv420p`, a no-audio branch for joins,
  timestamp reset in joins. Rotation via FFmpeg's default autorotate. HDR isn't tone-mapped; the UI warns.
  Output playback is tested in the **packaged** app.
- **Snapshot and recheck:** record the parent's identity and a **clip revision** (hash of the ranges)
  before encoding; recheck after. If either changed, the output is kept but not counted as current.
- **Results:** `ClipExportResult` per clip (`done | failed(reason) | cancelled`), reasons `disk-full`,
  `permission`, `source-changed`, `encode-failed`, `verify-failed`.
- **Limits (proposed):** at most 20 ranges per clip and 50 clips per export run.
- **Architecture:** `electron/clip-export.js` (`@ts-check`) with pure `buildClipArgs(mode, ranges, src,
  out)` (including the concat list for fast joins) and the run, verify and promote steps. `main.js`
  registers `export-clips` / `cancel-clip-export` as one-line delegations. `exportClips()` in
  `src/clips.ts` applies IPC results and the optional parent status change in one store action.

**Tests:** `buildClipArgs` for all four mode/shape combinations; no staged file left after failure or
cancel; a collision during export gives a suffix, never an overwrite; verify-failed → parent not marked;
changed parent → refused.

### 5.4 Keeping Only the Clips

**Decision:** The export dialog offers **"Mark the original as Delete when all its clips succeed"**,
remembered, **off** the first time. The original is never deleted directly; it goes through the normal
Delete action (Recycle Bin, identity check, 2.1 reasons, undo before deleting). Available once 5.3a's
verification and export record exist.

**Implementation notes:**
- If any clip fails, the original isn't marked, and the summary says why.
- **Safety nets:** delete-all warns about videos marked Delete that still have **un-exported clips**;
  1.2 "Mark short videos" counts "has clips" as a protection.
- **Exported clips in the library:** added as new videos with status **Keep**, inheriting rating and
  favourite, via a targeted add (`library-registry.recordScanned` + the normal metadata/thumbnail
  pipeline), not a full rescan. Destinations outside the loaded folders aren't shown.
- **Export record:** `{ clipRevision, sourceIdentity, outputPath, outputIdentity }`. The delete-all
  warning checks the output still exists with the same identity and revision. The first version doesn't
  auto-skip; "Export all" re-exports unless deselected.
- **Restart after promotion:** an output without a saved record is kept and listed as "exported, not
  recorded"; the next scan picks it up. A cancel after promotion reports promoted outputs as done.
- **Clear Cache** removes clip definitions and tags along with decisions; its warning ("All manual review
  decisions will be lost") must name them. Whether Clear Cache should keep user annotations is a later
  decision.

**Tests:** the delete-all warning; the 1.2 protection; **e2e:** bookmarks at four points → keep 1–2 and
3–4 joined + 2–3 separate → export → two files appear as Keep → original marked Delete → normal Delete →
Recycle Bin.

---

## Phase 6 — Rename & Move

File operations that keep review state attached and survive crashes.

### 6.1 File-Operation Journal and Recovery

**Decision:** **Location truth is the file system.** Each stage can be repeated safely and records its
progress in a journal. **Source rows are deleted last**, so old data exists until everything else is
done.

**Journal:** `userData/file-ops/<opId>.json`, written atomically (the `createMarker` pattern). Fields:
`v`, `opId`, `type` (rename/move), `appVersion`, `stage`,
`src {path, id, identity, ownerFolder, cacheDbPath, thumbRoot}`,
`dst {path (collision-resolved), id, ownerFolder, cacheDbPath, thumbRoot, identity?}`.

| # | Stage | Idempotency rule |
|---|---|---|
| 1 | **Preflight:** scope + `matchesFileIdentity`; destination authorized; cancel the processing **run** touching the video; **settle saves** (3.3) | Nothing changes yet |
| 2 | Write the journal with `stage: intent` | — |
| 3 | **Atomic no-replace rename** (5.1), journal records `file-moved` + restat `dst.identity` | If the journal write fails after the rename, recovery sees source missing + destination matching, and continues |
| 4 | **Destination DB transaction:** insert new-ID rows (review state, tags, clips, metadata, fingerprints) using the destination restat for size and date → `dest-committed` | Rows carry `transfer_op_id = opId`. A destination row with **this** opId counts as committed; one **without** it means **needs attention**, never a silent merge. |
| 5 | **Thumbnails:** `src.thumbRoot/oldId` → `dst.thumbRoot/newId` (copy then delete across roots), paths rewritten, seek times kept → `thumbs-done` | On failure, clear the destination thumbnails; they regenerate |
| 6 | **Settings:** remap ignored duplicate pairs via 3.2 → `settings-done` | A set operation, so repeating is harmless |
| 7 | **Source DB transaction:** delete old-ID rows → `source-cleaned` | Deleting missing rows is a no-op |
| 8 | Update main maps and notify the renderer; if it can't receive, it **resyncs from main** on load. A completed file operation is never rolled back. | — |
| 9 | Delete the journal | — |

**Implementation notes:**
- **Corrupt or unreadable journal:** never treated as absent. **All destructive cache maintenance is
  suspended** (pruning, descendant-cache cleanup, clear, migrate, generation cleanup) until the user
  resolves it. An "unfinished file operation" notice shows whatever could be read.
- **Recovery** runs at startup before any scan, and before rescanning an affected folder:
  - Destination exists and matches the journal identity → resume from the recorded stage.
  - Discard the journal **only** when the recorded stage and the available evidence establish that
    nothing needs recovery (e.g. stage `intent`, source matches, destination absent). A source that
    matches after a later stage was recorded (the file may have been moved back after a partial
    transfer) is an inconsistency: keep the journal for recovery or **needs attention**. How to
    establish "nothing to recover" is researched during implementation.
  - A path exists but its identity doesn't match → attach no data, keep the old rows, mark **needs
    attention**.
  - Volume offline or file missing → stay **pending**; never taken as proof the file is gone.
  - **Case-only renames:** decided by the **on-disk spelling** (directory listing) + identity. A crash
    test runs right after the native rename, before the journal update.
- **Per-folder write protection:** while a journal for a folder is unresolved, that folder's cache gets
  **no mutating writes**: reconciliation and pruning; path-conflict deletion
  (`createPathConflictResolver`, `cache.js:537`); rescan reset (`mergeScannedVideoWithCache`);
  descendant cleanup (`pruneMissingDescendantCaches`, `main.js:1322`); corruption quarantine, clear and
  migrate. The folder opens **read-only** with a banner. Clearing, migrating or changing the cache mode is
  refused for those folders, with an explanation. Pruning gets its protected set from
  `file-ops-journal.pendingIdsByFolder()`.
- **Architecture:** `file-ops-journal.js` holds journal I/O, recovery classification and the stage runner
  for one concrete operation (not a framework). `main.js` registers `rename-video`/`move-videos` as
  one-line delegations and calls `recoverPendingFileOps()` at startup. Cache rows go through new
  `transferVideoRows`/`deleteVideoRows` cases; settings through `settings-store`; loaded state through
  `library-registry`.
- **D-TS decision** is made here, before 6.2.
- **Profile format marker decision** is made here. Bumping `storage-format.json` makes older versions
  refuse the profile instead of pruning journal data. Costs to weigh:
  - The check is an exact match (`storage-compatibility.js:83–96`), so the bump needs a migration step
    that upgrades the previous format's marker; today even the new version would refuse it.
  - Both editions share `%APPDATA%\VideoCull`, so the bump must reach the Store and direct-download
    editions in the same release; whichever lags is locked out of the profile.
  - The alternative is no bump, plus release notes saying downgrading with an unresolved file operation
    isn't supported.
- **Done when:** `main.js` contains no journal or stage logic; both new backend modules are `@ts-check`;
  the boundary tests below pass against the modules directly.

### 6.2 Rename

**Decision:** Inline editing with the extension locked. Undo is a reverse operation that can fail on its
own, which is reported.

**Gate:** 5.1 passes on the target file systems, plus the 6.1 tests.

**Implementation notes:**
- Validation covers reserved names, trailing dots and spaces, long paths, Unicode and case-only renames.
- **Renderer:** `src/file-operations.ts` holds `renameVideo()` and `moveVideos()`. Each calls
  `settleReviewSaves`, invokes IPC, and applies the `FileOpResult` through **one** store action,
  `applyFileOpResults`, which remaps selection, Review scope and index, undo entries and duplicate groups.
  Components only open the editor or dialog.

### 6.3 Move to Folder

**Decision:** Its own action. A native folder picker authorizes the destination; a collision preview
offers Skip / Keep both, and collisions appearing during the move follow the same choice.

**Gate:** rename has shipped and been verified.

**Implementation notes:**
- **Milestone A, same volume:** the 6.1 stages with different owner folders and thumbnail roots (the
  cache may be on another volume). Emptied-folder reconciliation and pruning stay as they are. A
  destination outside the loaded folders keeps its review data; the video leaves the view.
- **Milestone B, cross volume:**
  1. Copy to `.<name>.<opId>.videocull-partial` (unique to this operation).
  2. Hash both files.
  3. Re-check the source identity.
  4. Promote with the primitive.
  5. **Restat the destination**, record its identity, write its size and date into the destination rows.
  6. Commit the destination rows.
  7. Delete the source after an identity check.
  - Outcomes: `not-copied`, `copied-source-remains`, `done`.

### Investigation Option (Not Committed): Relink a Folder Moved Outside VideoCull

**Problem:** a video's ID is `md5(path:size)`, so a folder moved in Explorer gets new IDs, and the next
scan loses its decisions, bookmarks, tags and clips. 6.1–6.3 only cover moves made inside VideoCull.

**Option to investigate:** a "Relink moved folder" action that picks the new location and transfers the
cached state to the new paths, reusing the 6.1 machinery (`transferVideoRows`, thumbnail transfer,
ignored-pair remap) instead of a separate path rewrite. A preview (old path → new path, rows affected)
before anything is written. Questions to answer first: how to match files (path suffix + size +
identity), what happens to files missing or changed at the new location, and whether it belongs in
Phase 6 or a later phase.

### Boundary Tests Required Before Rename or Move Ship

- **Path reused during recovery:** a new file at the source path → original recovery data survives and
  is never attached to the replacement.
- **Whole-folder cleanup during recovery:** the protected DB and thumbnail generations survive.
- **Crash during a case-only rename:** repeated recovery reaches the right spelling and review state.
- **Stale settings snapshot after a transfer remap:** the new ignored-pair mappings survive.
- **Crash points:** a crash after **every** stage, recovery run **twice** → same end state, no
  duplicated rows, no overwritten newer edits.
- **Replaced files:** source or destination replaced externally → needs attention, no data attached.
- **Missing pieces:** destination cache unavailable or volume offline → pending, nothing pruned.
- **Scanning during recovery:** a normal scan of the source folder → old rows and thumbnails survive.
- **Journal problems:** a corrupt journal → protected and reported, never ignored.
- **Saves:** delayed and failed saves during a transfer; nothing writes to the old ID afterwards.
- **Reopen:** destination restatted, reopened and rescanned → decisions kept.
- **Cache settings:** a cache-mode change while a journal is unresolved → refused.
- **Renderer:** reloading during stage 8 → it resyncs, nothing is rolled back.

---

## Phase 7 — "Open with VideoCull" on Folders

Explorer integration for folders, in both editions. 7.1 only needs `library-registry` (2.1), so it can be
developed earlier on its own branch if convenient.

### 7.1 Folder Handoff

**Decision:** A second launch hands its folders to the running app over the existing guard pipe.
Already-loaded folders are focused, not reloaded.

**Implementation notes:**
- **Protocol:** one line of JSON (≤ 64 KB): `{ "v": 1, "type": "open-folder", "paths": [...] }`.
- **Acknowledgement:** the server acknowledges **queue acceptance** within 2s (`{ok:true, accepted:n}`
  or `{ok:false, reason:"queue-full"}`). Paths are validated **asynchronously afterwards**, so a slow UNC
  path doesn't break the timeout; failures are shown in the app. Nothing is acknowledged and then dropped.
- **Limits:** absolute-path syntax check before acknowledging; at most 20 pending paths; overflow
  rejected in the acknowledgement.
- **Mixed versions:** an older server answers with plain text → the client shows today's message.
- **No acknowledgement:** the client tries to acquire the guard once; if it succeeds, it opens the folder
  itself.
- **Busy policy:** during scan, delete, migration, a file operation, unresolved recovery or an open
  dialog, requests wait in the pending list. When free: already-loaded paths are focused (no
  `setDirectory`, no reset); new paths go to the add/replace dialog, **extended to hold several paths**.
- **Selection:** Explorer may pass several folders in one invocation or start several processes; both are
  accepted, and a short collection window merges them.
- **Architecture:** `folder-handoff.js` (`@ts-check`) holds parsing, limits and the pending list;
  `edition-guard.js` (opts into `@ts-check`) gains the request/ack exchange; `bootstrap.js` wires the
  client. Main forwards validated paths with `open-folders-requested` and keeps them until the renderer
  asks after loading. Renderer: `src/open-folders.ts` with one `openFolders(paths, source)`; picker, drop,
  open recent, add recent and the handoff all call it. **Done when** `App.tsx` and `Sidebar.tsx` no longer
  call `validateDroppedPath`, `setDirectory` is reached only through `openFolders`, and the existing drop
  and recents DOM tests pass.

**Tests:** protocol limits and overflow; old-server reply; no acknowledgement → takeover; slow UNC
validation after acknowledgement; already-loaded folder → focus, not reset; multi-folder add and replace;
queueing while busy.

### 7.2 Installer Edition (NSIS)

**Implementation notes:**
- Registry entries under `Directory\shell` and `Directory\Background\shell` (HKCU), with `"%V"` quoting.
- Set `MultiSelectModel` deliberately and test what Explorer actually passes.
- Test upgrade, uninstall and coexistence with the Store edition on an installed machine.

### 7.3 Store Edition

**Implementation notes:**
- **Proof package** (local, sideloaded): a minimal `IExplorerCommand` DLL handling the **item array**,
  registered via `com:ComServer` + `desktop4:FileExplorerContextMenus`, tested on Windows 10 and 11. The
  callbacks do no scanning and no probing.
- Then: CI build, signing, and production manifest entries.

---

## Phase 8 — Experiment: Clips Cut from Longer Videos

A timeboxed spike on a separate branch. Only promoted to a release phase if the evaluation succeeds.

**Decision:** Directed review suggestions that show **coverage** ("~70% of A found in B at 12:34"), never
"A is cut from B", and never a keeper or deletion suggestion. Content matching can't prove one file was
made from another.

**Implementation notes:**
- **Timing:** match on source frame times (decoded PTS) and require sustained coverage.
- **Storage:** separate sequence storage; bounded candidates and approximate hash buckets.
- **Insufficient evidence:** static or low-information material gets this outcome instead of a match or
  "unrelated".
- **Scope:** clips shorter than the minimum length are **unsupported**, and the UI says so.
- **Evaluation:** a labeled test set with **many unrelated videos** (shared intros and credits, repeated
  shots, static material, two different clips from one source). Precision and recall targets are
  hypotheses; resource budgets come from a first timeboxed measurement.
- **Product integration** depends on 4.1 scheduling, pause/cancel, cache versioning, and rename/move
  carrying the new sequences.
- **Architecture:** extraction through the scheduler; matching in a worker (the `visual-worker.js`
  pattern); the renderer only receives finished suggestions; no ML or new analysis infrastructure.

> **Investigation option (not committed): audio alignment as a candidate approach.** Besides visual
> matching, the spike can evaluate audio alignment with the bundled FFmpeg: extract low-rate mono PCM,
> slide the shorter clip's audio features over the longer video to find the best offset, and only then
> confirm visually at aligned timestamps (`t` in the clip, `offset + t` in the source), with a
> center-crop variant for changed aspect ratios. Candidate pairs: shorter duration roughly 10–95% of the
> longer one. A known test case should find the clip at about 230.77s into the full video. If used, keep
> the alignment helper isolated so a fingerprinting library could replace it later. Same honest-claims
> rules as above.

---

## Investigation Option (Not Committed): Duplicate Tuning

Only considered if the benchmark (see the option under 0.4) exists and shows evidence for changes. No
phase, branch or version until then.

- Re-evaluate whether `visual` should stay the default comparison mode, and the defaults of sample count
  `3` and similarity threshold `95`.
- If the evidence supports it, simple presets (`Strict`, `Balanced`, `Broad`) instead of hand-tuning
  every setting.
- Cross-format copies and different encodes: better candidate filtering and confirmation, fewer false
  positives at lower thresholds without weakening the strict range, and conservative daisy-chain cleanup
  so weak links don't pull unrelated videos into one group.

---

## Skipped Features (Recorded for Future Reference)

| Feature | Reason skipped |
|---|---|
| Hover-scrub on grid cards | Click-to-seek on frames (2.2) instead |
| Static FFmpeg build | Two full-size exes, ~360 MB |
| Trimmed custom FFmpeg build | Means maintaining our own build and its security updates; only if package size becomes a problem |
| Real `.ts` backend modules | Needs a backend build pipeline; behind decision gate D-TS (6.1) |
| Generic typed-RPC layer / per-domain IPC registration | Little gain; would require rewriting `check-ipc-contract.js` |
| Persistent undo history | Undo stays in memory for the session |
| Fixed-length clips, clip transitions, separate clip editor | Clips come from bookmark segments in Review |
| Clip crop/resize, audio-only export, ranges off bookmarks, hardware encoders for exact mode | Out of scope for the first version; hardware encoders can come later behind `buildClipArgs` |
| Auto-skipping already-exported clips | Later, on top of the export record |
| Unsupported-codec playback | Separate scope decision |

---

## Development Process

### Branch Strategy

One feature branch per phase. Branch off the previous phase branch, not always off main.
Merge into main only when the phase is solid and the app is fully usable without future phases.

```
main                        ← stable, always launchable, tagged at each release
  └─ p0-media-toolchain
       └─ p1-quick-wins
            └─ p2-delete-safety-thumbnails
                 └─ p3-settings-tags
                      └─ p4-processing
                           └─ p5-keep-clips
                                └─ p6-rename-move
                                     └─ p7-explorer-integration

main
  └─ spike/clip-coverage    ← Phase 8, never merged unless promoted to a phase
```

P1 doesn't touch FFmpeg and P7.1 only needs P2; either may branch off main and merge earlier. Versions
follow merge order, so a phase that merges early takes the next free version in the map.

Never work directly on main. Never bump the version mid-branch.

### Commit Frequency

Commit at logical stopping points — not by time. Good triggers:
- A single feature works end-to-end (even if rough)
- You are about to touch a different file domain
- Before any risky refactor
- When you have just fixed a bug that was annoying to track down

Avoid committing half-migrated states where two systems coexist but neither fully works.
When extracting code, the verbatim move and the behaviour change are separate commits.
Commit messages use conventional types (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`).

### Version Map

| Phase | Version | Notes |
|---|---|---|
| P0 — Media toolchain & licence compliance | `2.4.0` | FFmpeg 9.0.2, fluent-ffmpeg removed, licence notices + About licence section |
| P1 — Quick wins | `2.5.0` | Skip length, mark short videos |
| P2 — Delete safety & thumbnail seeking | `2.6.0` | Delete reasons, click-to-seek, scrub previews, paint selection |
| P3 — Reliable settings & tags | `2.7.0` | Additive schema; downgrade safety not promised (see Defaults) |
| P4 — Processing performance | `2.8.0` | Storage-aware scheduling, smarter frames |
| P5 — Keep clips | `2.9.0` | Clip definitions, export, keep only the clips; additive schema |
| P6 — Rename & move | `3.0.0` | Journal + recovery, rename, move. Major only if 6.1 bumps the profile format marker (older versions then refuse the profile); otherwise `2.10.0` and P7 shifts down |
| P7 — "Open with VideoCull" | `3.1.0` | Folder handoff, NSIS and Store Explorer entries |
| P8 — Clip coverage spike | — | Gets a phase and version only if promoted |

Version bump happens in one commit, at the moment of merging the phase branch into main.
Fixes between phases ship as patch releases (`2.4.1`, …), as with `2.3.1`/`2.3.2`.
Tag every release: `git tag v2.4.0 && git push origin v2.4.0`.

### Each Version Must Work Standalone

Every merged version must be fully usable without any future phase installed.
Before merging a phase branch into main, verify:
1. App opens a real folder and scans without errors
2. Status changes persist after restart
3. `npm run test:ci` passes (includes `check:ipc` and the electron type check from 0.1)
4. Both editions package without warnings (`npm run package`, `npm run package:store`) and
   `npm run validate:store-package` passes
5. No half-finished UI from the next phase is accidentally visible

The architectural rule that makes this possible: **schema changes are additive only.** New columns
(`seek_secs`, `thumb_generation`, `clips`, `transfer_op_id`) and tables (`tags`, `video_tags`) are
added with defaults, and `saveCache`'s explicit-column upsert means an older version updating a row
leaves unknown columns untouched. Each phase that adds a column tests that. This preserves data; it
doesn't guarantee an older version keeps the data's meaning (see Downgrading in Defaults).

### CHANGELOG

Update `CHANGELOG.md` in the same commit as the version bump. Describe only the user-visible delta from
the previous release (`AGENTS.md`). Format:

```markdown
## [2.4.0] - YYYY-MM-DD

### Changed
- Updated the bundled FFmpeg and FFprobe to 9.0.2, improving AV1 support.

### Added
- The About panel shows the licence, third-party notices, and a link to the source code for this version.
```

### Working Rules

- Check every claim against the code before it goes into this roadmap, and mark anything unchecked.
- Change a boundary only inside the feature that touches it.
- New backend modules are `@ts-check`, made of plain functions with injected I/O: no classes, DI
  containers or repositories. IPC handlers stay in `main.js` as one-line delegations.
- Test-first; Electron-side tests go in `tests/electron`. Manual or installed verification is needed for
  virtualized painting, Explorer integration, how thumbnails look, real locked files, and FAT/exFAT and
  SMB behaviour.
- Update docs and the changelog for user-visible changes.
- **Never reference other apps by name** in code, comments, tests, commits, docs, changelogs or UI text.

---

## Progress Tracker

Update the status column as work completes. Merge date recorded when phase lands on main.

| Phase | Status | Version | Merged |
|---|---|---|---|
| P0 — Media toolchain & licence compliance | 🔄 In progress | `2.4.0` | — |
| P1 — Quick wins | ⬜ Not started | `2.5.0` | — |
| P2 — Delete safety & thumbnail seeking | ⬜ Not started | `2.6.0` | — |
| P3 — Reliable settings & tags | ⬜ Not started | `2.7.0` | — |
| P4 — Processing performance | ⬜ Not started | `2.8.0` | — |
| P5 — Keep clips | ⬜ Not started | `2.9.0` | — |
| P6 — Rename & move | ⬜ Not started | `3.0.0` | — |
| P7 — "Open with VideoCull" | ⬜ Not started | `3.1.0` | — |
| P8 — Clip coverage spike | ⬜ Not started | — | — |

Status key: ⬜ Not started · 🔄 In progress · ✅ Merged to main

---

## Implementation Order (Suggested)

```
P0  Checked-JS backend setup (Phase 0.1) ← before every @ts-check module
P0  Replace fluent-ffmpeg, verbatim args (Phase 0.2)
P0  Pinned FFmpeg 9.0.2 shared build (Phase 0.3)
P0  Old vs new build compatibility check (Phase 0.4) ← gates the release
P0  Licence compliance (Phase 0.5) ← ships with 0.3; notices, About section and Store terms can start now
P0  Toolchain maintenance (Phase 0.6)

P1  Configurable skip length (Phase 1.1)
P1  Mark short videos for deletion (Phase 1.2)

P2  Delete error investigation (Phase 2.1a)
P2  library-registry + file-ops-delete + delete reasons (Phase 2.1) ← enables 5.4, 6.1, 7.1
P2  Thumbnail seek times + safe publication + click-to-seek + scrub previews (Phase 2.2)
P2  Drag-to-paint selection (Phase 2.3)

P3  Baselines + network-cache policy (Phase 3.1) ← before tags and Phase 4
P3  Reliable settings save (Phase 3.2) ← before tags and 6.1 stage 6
P3  Review persistence module (Phase 3.3) ← before tags and rename
P3  Tags (Phase 3.4)

P4  Storage-aware scheduling (Phase 4.1) ← before 4.2 and Phase 8 integration
P4  Smarter thumbnail frames (Phase 4.2)

P5  No-overwrite primitive prototype (Phase 5.1)
P5  Clip definitions in Review (Phase 5.2)
P5  Exact single-range export + export record (Phase 5.3a)
P5  Exact joins (Phase 5.3b)
P5  Fast mode after prototype (Phase 5.3c)
P5  Keeping only the clips (Phase 5.4) ← after 5.3a verification + export record

P6  Journal, recovery and per-folder write protection (Phase 6.1)
P6  D-TS decision + profile format marker decision (sets 3.0.0 vs 2.10.0)
P6  Rename (Phase 6.2)
P6  Move, same volume (Phase 6.3 A)
P6  Move, cross volume (Phase 6.3 B)

P7  Folder handoff + open-folders.ts (Phase 7.1)
P7  Installer edition Explorer entry (Phase 7.2)
P7  Store edition proof → production (Phase 7.3)

P8  Clip coverage spike, timeboxed, separate branch

Investigation options (not committed, no version):
--  Reusable duplicate benchmark (with Phase 0.4)
--  Relink a folder moved outside VideoCull (after Phase 6)
--  Audio alignment as a candidate approach (inside the Phase 8 spike)
--  Duplicate tuning: defaults, presets, cross-format (only with benchmark evidence)
```

---

## Reference — Verified Code Facts

Checked at `2845c57` (2.3.2) and refreshed at `b9f9cbb` (Electron 44.5.1, TypeScript 7.0.2, Vitest 5).
Line numbers are approximate after later commits.

| Area | Fact |
|---|---|
| Video identity | ID = `md5(path:size).slice(0,16)` (`scanner.js:17`). Before deleting, the backend checks size, mtime, and birthtime/dev/ino when known (`matchesFileIdentity`, `main-helpers.js:22`). `matchesFileIdentityAtPath` returns `false` on **any** stat error (`main-helpers.js:48`). |
| Delete safety | `batch-delete` and `permanently-delete` reject paths outside the loaded folders and files changed since the scan (`main.js:2617`). The renderer gets back a message string only. |
| Permanent-delete prompt | Exists (`requestPermanentDelete` in `App.tsx`, `onRequestPermanentDelete` in `Sidebar.tsx`). `deleteWithPermanentReview` shows it after **any** failed Recycle Bin move (`src/deletion.ts:18`). |
| Cache rows | `moveVideos` only moves rows between two folder DBs, with two non-atomic writes (`cache-worker-operations.js:92`). |
| Pruning | On reconcile, rows for IDs not seen in the scan are pruned (`cache-worker-operations.js:49`) and their thumbnail folders removed (`main.js:1283`). |
| Rescan reset | A cached row whose size or date differs is reset to pending, losing status, rating, bookmarks and favourite (`mergeScannedVideoWithCache`, `main-helpers.js:80`). |
| Storage locations | Review data and fingerprints: folder DB. Ignored duplicate pairs: **settings**. Thumbnails: **files** under a thumbnail root per owner folder. Selection and Review state: **renderer memory**. Known paths and identities: **main-process maps**. |
| Review saves | Sent asynchronously; failures go into per-directory retry queues (`store.ts:552`). Nothing to await for "all saves finished". |
| Settings saves | `save-config` writes directly and returns `false` on failure (`main.js:2951`). `saveSettingsQuietly` only catches rejections (`store.ts:476`). |
| JSON helpers | `readJsonFile` returns the fallback after any error, including corrupt JSON. `writeJsonFile` writes directly (`main.js:714`). `createMarker` writes atomically: temp + `wx` + fsync + rename (`storage-compatibility.js:50`). |
| Thumbnails | Named by slot (`thumb_NN.jpg`). `extractFrame` retries at ±0.25s and ±0.75s without reporting which worked; all slots failing falls back to `thumb_01.jpg` at t=0. Force-rebuild deletes old files first (`processor.js:315`); the renderer clears records before regenerating (`App.tsx:607`). The cache compares paths only (`cache.js:49`). |
| Slot times | `calculateTimestamps(120s)`: 6 slots → slot 6 at 107.0s; 12 slots → slot 6 at 55.0s. |
| Card overlay | `.card-hover-overlay` is `absolute; inset: 0; z-index: 3` (`VideoCard.css:153`). |
| Review entry | `enterReviewAndPlay(videoId, scopeIds?)`; duplicate review passes `scopeIds` (`store.ts:1530`). |
| Darkness helper | `frameDarkRatio(grayBytes)` is exported from `duplicate-utils.js`. |
| Pause | `runProcessingActivity` waits at the pause checkpoint before `beginActivity` (`processor.js:178`). |
| Worker dispatch | Each worker takes the next queued video before processing it (`processor.js:404`). |
| Full hashing | Sequential inside each quick-hash group (`duplicates.js:328`). |
| Fingerprints | `saveVideoFingerprints` deletes the whole sequence, then inserts the new one (`cache.js:1055`). |
| Renderer delivery | `canSendToRenderer` is false while the window is loading, destroyed or crashed (`main.js:173`). |
| Folder open | `handleDirectoryPicked` calls `setDirectory` when the folder is already loaded, replacing the roots (`App.tsx:228`). The add/replace dialog holds a single path. Four entry points (picker, drop `App.tsx:1008`, open/add recent `Sidebar.tsx:776–830`) validate separately. |
| Second launch | `edition-guard.js` is a named-pipe server that replies "already running" and closes. |
| SQLite | `journal_mode = WAL` (`cache.js:366`). In distributed mode the DB sits beside the videos (`cache.js:166`). |
| Undo | In memory only, cleared on directory change. `undo` calls `videoIds.includes` per video (`store.ts:1244`). |
| Backend runtime | `electron/` is plain CommonJS run directly (`"main": "electron/bootstrap.js"`), **no build step**; `tsconfig.json` excludes `electron`. Some backend tests run via `node --test` or Electron's Node (`test:profile`, `test:store`, `test:cache-native`). |
| Bookmarks | `bookmarks?: number[]` (seconds), JSON `TEXT` column, saved via the review-state path. Review shows them as a `chapters` track, one cue per bookmark-to-bookmark span (`ReviewMode.tsx:330`). **Points**, not ranges. |
| Cache upserts | `saveCache` uses `INSERT … ON CONFLICT(id) DO UPDATE SET` with explicit columns (`cache.js:586`). |
| Bundled FFmpeg | N-92722 (2018) includes `libx264`, `libx265`, `aac`, plus NVENC, QSV and AMF H.264 encoders. |
| `main.js` | 3112 lines, 47 IPC channels registered inline. Biggest handlers: scan (`:1707`), metadata (`:1929`), thumbnails (`:2157`), duplicates (`:2377`), delete (`:2598–2715`). |
| Known-video maps | `currentScanDirs` + three `knownVideo*` maps used in ~25 places in `main.js`. |
| Settings reads in main | 9 places (`readJsonFile(CONFIG_FILE…)` + direct `fs.readFile` at `:1980`, `:2203`). Corrupt → `{}` → default cache mode. Renderer is the only writer (7 `saveConfig` calls). |
| IPC contract check | `check-ipc-contract.js` compares method **names** across `preload.js`, `ElectronAPI` and channels in `main.js` only. |
| Duplicated delete-all | Same flow in `App.tsx:814` and `Sidebar.tsx:900`. |
| `window.electronAPI` use | `App.tsx` 50, `SettingsModal.tsx` 27, `store.ts` 20, `Sidebar.tsx` 14; others one or two. |
| Workers | Cache I/O: `cache-service.js` → `cache-worker.js` → `cache-worker-operations.js`. Duplicate comparison: `duplicate-worker.js`, `visual-worker.js`. FFmpeg child processes from `processor.js` and `duplicates.js`. |
| Tests | Unit tests for most backend modules and renderer; e2e `delete-safety.spec.ts`, `relaunch-persistence.spec.ts`. `main.js` handlers have **no** direct unit tests. |
| Feature toggles | `FeatureSettings` in `src/types.ts`: `ratings`, `favorites`, `codecBadges`, `compatibilityCheck`, `globalMute`, `nextUndecided`. |

**File primitives on Windows/NTFS (2026-10-01)**, single operations, not a full move with recovery:

| Primitive | Destination name already exists |
|---|---|
| `fs.rename` | **Replaces** silently |
| `fs.link` | `EEXIST` |
| `open 'wx'` | `EEXIST` |
| `copyFile EXCL` | `EEXIST` |
| .NET `File.Move(src, dst)` (MoveFileEx without replace) | **Refuses atomically**; source stays |

A case-only `fs.rename` also works.
