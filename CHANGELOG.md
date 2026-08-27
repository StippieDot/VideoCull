# Changelog

All notable changes to Video Cull will be documented here.

## [2.2.0] - 2026-08-28

### Added
- Added a persistent light theme with app-wide styling, a visible theme control, a configurable keyboard shortcut, and startup persistence.
- Added an option to keep the playback timeline and controls visible while reviewing videos.
- Added a sessions-and-folders guide and expanded the in-app and website documentation for grid, review, duplicate, cache, settings, and safety workflows.

### Changed
- Replaced the Video Cull logo and application icon throughout the app, Windows executable, installer, uninstaller, and generated shortcuts.
- Reorganized Interface settings into clearer sections for grid defaults, Review mode, and report export.
- Changed downloaded updates to require an explicit choice between updating now, installing on exit, or being asked later.
- Updated Electron and related runtime packages.

### Fixed
- Review shortcuts continue working after interacting with the embedded video player.
- Playback controls remain accessible during keyboard-driven review sessions.
- Grid scrolling stays anchored when batch status changes remove videos from the current filter.
- Search shortcuts no longer interfere with editable fields, and cached thumbnails appear more reliably.
- MPEG-4 Part 2 videos now open in the external player instead of showing a black frame in the built-in player.

## [2.1.0] - 2026-08-22

### Added
- Added an offline, searchable in-app documentation modal opened from the Help menu, app chrome, or `F1`.
- Added a Mintlify documentation site covering the main grid, review, duplicate, cache, processing, settings, formats, troubleshooting, FAQ, installation, and development workflows.
- Added dedicated guides for delete safety and cache/processing decisions.
- Added live in-app shortcut tables that reflect the user's configured keybindings while the website continues to show defaults.

### Changed
- Made the selected Mintlify MDX pages the shared source for both web and in-app documentation, with an explicit in-app allowlist for user-facing pages.
- Redesigned the documentation modal around compact grouped navigation, collapsible sections, responsive fixed-height sizing, a smaller search field, and direct links to relevant settings.
- Expanded and consolidated the user guides to remove repeated sections and make guidance more task-first.
- Improved duplicate matching so exact matching respects duration and keeper selection prefers bitrate within the same resolution tier.

### Fixed
- Natural filename sorting now orders numbered files as people expect, such as `file 2` before `file 10`.
- Review shortcuts continue working after interacting with the video player using the mouse.
- Closing duplicate video playback no longer intermittently resets the list to the top.
- Previously decided videos again show their Keep, Delete, or Skip color when reopened in review mode.

## [2.0.0] - 2026-06-24

Video Cull 2.0.0 has smarter duplicate review, richer media decisions, safer cache handling, clearer destructive actions, better mounted-drive behavior, and a UI that holds up better on very large libraries and high-resolution screens.

### Added
- Duplicate review mode for finding likely duplicates across all loaded videos or the current filtered view, with pHash and visual-similarity matching, adjustable thresholds, sample counts, sampling windows, flipped comparison, and optional run-after-scan.
- Suggested keepers for duplicate groups using resolution, bitrate, duration, FPS, and size, plus manual keeper overrides, protected Keep/Skip videos, ignored match pairs, group dismissal, and right-click duplicate actions.
- Richer review decisions with ratings, favorites, bookmarks, playback speed, global mute, next-undecided navigation, scoped review summaries, pending/delete totals, and undo-aware review flows.
- Media insight throughout the app: codec, container, resolution, FPS, metadata date, compatibility badges, metadata-based sort options, and clearer labels for resolution/FPS.
- Built-in playback fallback behavior for unsupported files, including compatibility checks, external-player handoff, and decode-error overlays when Chromium cannot play the stream.
- Grid search by filename or path, with `Ctrl+F` as the default shortcut and full keybinding customization.
- Context menus for grid videos, folder headers, duplicate rows, and duplicate groups, including reveal/copy-path, status changes, thumbnail regeneration, keeper selection, exclusion, and dismissal.
- Maintenance controls for stale-cache cleanup, missing-subfolder cache pruning, empty-folder cleanup after delete, and thumbnail-count rebuild warnings.
- Safer cache storage management across centralised, per-drive, and distributed cache modes, including cache-location validation and explicit migrate/start-fresh choices.
- Custom Windows installer artwork and shortcut choices while keeping current-user installation and install-location selection.
- App diagnostics and performance instrumentation for scan, render, duplicate, cache, and idle-state troubleshooting.

### Changed
- Upgraded Electron and refreshed the runtime/development dependency stack.
- Reworked the sidebar around large-library culling, with denser status/filter controls, clearer folder/session feedback, duplicate-mode controls, and better skipped/inaccessible folder reporting.
- Reworked the grid for large sessions with faster filtering/sorting, folder grouping, aggregate computation, virtualized rendering, stable search controls, and lower render churn during metadata and thumbnail updates.
- Reworked review mode so thumbnail preview and playback fit normal, maximized, and high-resolution displays while keeping the action controls stable.
- Improved scanner traversal throughput, stat batching, progress reporting, cancellation behavior, stale/superseded scan handling, and behavior on slow mounted drives.
- Improved metadata and thumbnail processing with clearer progress phases, better cancellation, short-video handling, safer reuse of existing thumbnail sets, and smaller renderer update batches.
- Improved duplicate detection performance with worker-based fingerprinting, batched database access, lower memory use, stronger candidate grouping, and more stable group IDs.
- Improved cache loading, saving, migration, recovery, pruning, and corruption quarantine behavior for existing libraries, including lower thumbnail-cache write churn and conservative concurrent folder-cache loading for very large libraries.
- Made potentially destructive or expensive maintenance behavior opt-in instead of surprising: stale-cache cleanup defaults off, empty-folder cleanup defaults off, and thumbnail-count changes warn before causing rebuild work.
- Updated development and CI workflows around Node 24, Vitest, Playwright, IPC contract checks, installer checks, native cache checks, and release packaging.

### Fixed
- Existing cache decisions, metadata, thumbnails, bookmarks, ratings, favorites, duplicate fingerprints, recent folders, and settings now survive rescans, relaunches, and upgrades more reliably.
- Destructive delete flows now validate loaded paths more strictly, clean related cache artifacts, report permanent-delete fallbacks clearly, and only clean truly empty folders when the user enables that option.
- Cache migration and cache-mode changes now avoid partial/clobber-prone moves and communicate migrate/start-fresh outcomes more clearly.
- Missing/offline folders and transient stat failures no longer silently prune cache by default.
- Open/reveal/play external operations and custom `thumb://` / `video://` serving now validate loaded paths more carefully.
- Built-in playback compatibility now better matches real browser support while FFmpeg-supported files can still be scanned for thumbnails and metadata.
- Thumbnail cancellation, short-video thumbnail reuse, failed thumbnail regeneration, and thumbnail-count changes behave more predictably.
- Duplicate reruns, deleted duplicate videos, stale duplicate selections, visual fingerprint settings changes, and hidden duplicate review state now clean up more reliably.
- Sort state, resolution labels, feature toggles, keybinding capture, focused input behavior, shortcut conflicts, and privacy/shortcut precedence are more predictable.
- New-folder and pending-scan UI states are clearer, reducing ambiguity when old videos are still visible while a new scan is starting.

### Tooling
- Added `npm run check:ipc`, `npm run check:installer`, `npm run test:renderer`, `npm run test:duplicates`, `npm run test:cache-native`, and expanded `npm run test:ci`.
- Added Playwright Electron regression flows for smoke, delete safety, relaunch persistence, and duplicate reruns.
- Added cache-clutter cleanup tooling, installer validation, release/test GitHub Actions updates, and broader regression coverage for Electron, renderer, cache, scanner, duplicate, processor, and settings flows.

## [2.0.0-beta.2] - 2026-06-11

This beta focuses on scaling duplicate review, reducing large-library slowdown, tightening media compatibility behavior, and raising the regression-testing baseline before the persistent-library work begins.

### Added
- Expanded duplicate-review tooling with richer group handling, better keeper controls, safer rerun flows, and stronger duplicate-session management.
- Context-menu actions and idle/performance diagnostics for faster inspection and debugging during heavy review sessions.
- Broader automated coverage across Electron, renderer integration, duplicate workflows, relaunch persistence, and delete-safety flows.
- Dedicated CI test workflow and Playwright/Vitest infrastructure for repeatable regression checking.

### Changed
- Improved app responsiveness across the renderer, sidebar, grid, review mode, scanner traversal, cache startup, and duplicate startup paths for larger libraries.
- Reduced duplicate-detection overhead with more selective fingerprint loading, cleaner worker flow, and lower main-process startup cost before comparisons begin.
- Improved cache and metadata persistence behavior with stronger save paths, better migration coverage, and more predictable reload/relaunch behavior.
- Refined compatibility handling so built-in playback rules better match real browser support, while additional FFmpeg-supported formats are recognized during scanning.
- Updated development and CI plumbing, including Electron/Vite dev-port coordination and refreshed GitHub Actions usage.

### Fixed
- Duplicate cleanup and delete flows are safer and more consistent, including reruns, fallback behavior, and follow-up state cleanup after removals.
- Sort state now persists more reliably, and resolution labels are normalized more consistently across the UI.
- Feature-setting toggles and related input behavior now behave more predictably.
- Cache, duplicate, and scan edge cases now fail more safely under heavy or unusual workloads instead of leaving stale state behind.

### Tooling
- Migrated and expanded the automated test stack around Vitest, renderer integration tests, and E2E release checks.
- Added more helper utilities, diagnostics hooks, and performance instrumentation to support future release hardening.

## [2.0.0-beta.1] - 2026-05-12

This beta is a major step toward Video Cull v2.0: richer review decisions, smarter library filtering, clearer media insight, safer cleanup, and more predictable playback for large video collections.

### Added
- Smarter review workflow with ratings, favorites, review summaries, delete totals, scoped review context, and next-undecided navigation.
- Richer library browsing with Library status filters, rating/favorite/incompatible filters, file-size and duration ranges, and cleaner active-filter controls.
- Deeper media insight with codec, container, resolution, FPS, compatibility badges, and new metadata-based sort options.
- More predictable playback with Video Cull's own compatibility policy, external-player fallback for unsupported media, decode-error overlays, and global mute.
- Better user feedback with in-app notifications for cache recovery, save delays, update state, and background maintenance.
- Feature toggles for enabling or hiding the new review, metadata, compatibility, and playback helpers.
- Thumbnail regeneration controls for stale, partial, or interrupted thumbnail sets.
- About/settings links for project, release, and support pages.

### Changed
- Upgraded Electron to 41 and refreshed application dependencies.
- Reworked the custom video protocol for Electron 41 compatibility and stricter file-serving rules.
- Reworked the sidebar around faster decision-making, with Library status filters promoted to the top and secondary filters kept more compact.
- Improved large-library navigation with updated grid virtualization, better scroll restoration, and folder headers that show filtered size next to total size.
- Made review and grid playback behave more consistently across compatibility, mute, metadata, ratings, favorites, and external-player actions.
- Improved thumbnail generation with clearer progress phases, ordered results, retries around difficult timestamps, and safer reuse of existing thumbnail sets.
- Cache loading and merging were hardened across central, per-drive, and distributed cache layouts.
- Improved export reports for multi-directory sessions.
- Made settings, cache migration, and update flows communicate their state more clearly.

### Fixed
- Unsupported audio/video decode failures now show an in-app explanation instead of failing silently.
- Corrupt cache databases are quarantined and rebuilt instead of blocking the app from loading.
- Deleted videos now remove related cache database rows, metadata entries, and thumbnail folders.
- Empty parent folders left after deletion are removed when safe; cloud drives without Recycle Bin support now fall back to permanent removal only for verified-empty folders.
- Partial or interrupted thumbnail folders are regenerated instead of being reused as if complete.
- Stale cache rows are refreshed when rescans find newer metadata.
- Save-cache failures now retry and warn the user when decisions may not yet be persisted.
- Global shortcuts now avoid interfering with focused controls, settings, and shortcut overlays.
- Update status handling now reports errors and ready states more reliably.

### Tooling
- Added an IPC contract checker for exposed Electron APIs.
- Added a cache-clutter cleanup script for old thumbnail/cache artifacts from earlier builds.

## [1.8.2] - 2026-05-01

### Changed
- Thumbnail generation now limits actual active FFmpeg processes directly: frames are extracted sequentially within each video while overall parallelism is spread across videos.
- Auto concurrency now accounts for the current thread-limit setting and allows higher single-thread process counts on capable systems while still capping by available memory.
- Hardware-accelerated thumbnail generation now pauses briefly between large batches to reduce GPU/driver pressure during long scans.
- Processing settings now use clearer wording around parallel FFmpeg processes and one-thread-per-process behavior, with expanded manual process limits up to 32.
- Removed the Minimal/Extended mode selector, first-run mode notice, View menu toggle, and mode shortcut because Video Cull no longer uses app-wide modes.

### Fixed
- Auto concurrency in Settings now recalculates from the unsaved local settings, so toggling thread limiting immediately updates the displayed process count.
- Cancelling thumbnail generation now also applies to fallback frame extraction.
- `ElectronAPI` TypeScript declarations now include the distributed cache confirmation API.

## [1.8.1] - 2026-04-27

### Fixed
- Playing videos after scanning a whole drive now works correctly. Drive-root selections such as `D:\` are now handled by the loaded-folder security check instead of rejecting every child path.
- Closing the app during large thumbnail-generation runs no longer triggers a main-process "Object has been destroyed" error from delayed progress batch sends.
- Video fullscreen now hides the Electron menu bar and restores it when fullscreen exits.

## [1.8.0] - 2026-04-26

### Added
- Auto concurrency now factors in available RAM — each ffmpeg instance uses ~400 MB, so the limit is capped to whichever is lower: half the CPU cores or `(free RAM − 1 GB) / 400 MB`. Prevents out-of-memory on lower-spec machines.
- Settings panel now shows the resolved thread count when Auto concurrency is selected, making the setting self-documenting.

### Changed
- Cache writes now fan out to per-folder SQLite databases that mirror the actual directory hierarchy on disk. Existing flat-root cache DBs are automatically split on first scan.
- Thumbnail output directory is resolved per-video when using folder-distributed cache, keeping thumbs co-located with their DB.
- Sidebar layout reorganized with improved visual hierarchy and spacing.
- `defaultGroupByFolder` now correctly defaults to `true` for existing installs that predate the setting.

### Fixed
- Grid thumbnail flicker eliminated: `filteredVideos` selector upgraded to shallow equality, preventing react-window from remounting all visible rows on every thumbnail batch update.
- `getItemSize` now uses a stable ref instead of reading rows state, removing a secondary source of row remounts.
- Thumbnails now fade in with a CSS opacity transition instead of snapping in abruptly.
- `ElectronAPI` TypeScript interface updated with missing `getAutoConcurrency` declaration.

## [1.7.0] - 2026-04-25

### Added
- Multi-directory sessions with true Add to Session behavior for dropped or selected folders.
- Cache storage modes for centralised, per-drive, and distributed cache layouts.
- Cache migration flow when switching storage modes, with migrate, start fresh, and cancel choices.
- First-run Minimal/Extended mode notice, Settings mode selector, View menu toggle, and configurable mode shortcut.
- Per-drive and central cache location validation with write tests before settings are saved.

### Changed
- Thumbnail files now resolve through cache-mode-aware roots instead of assuming one central cache folder.
- Grid folder labels include the root folder prefix when multiple roots are loaded.
- SQLite cache handles are kept per DB path so multi-directory operations do not close each other's connections.
- Cache writes now preserve future metadata columns when values are present.

### Fixed
- Batch cache saves fall back to chunked persistence for very large selections to avoid blocking the main process.
- Distributed cache index entries are pruned on startup when folders are no longer available.
- Scanner ignores distributed `.videocull` cache folders during recursive scans.
- Per-drive cache overrides must stay on the drive they configure.

## [1.6.0] - 2026-04-16

### Added
- Minimum duration filter in the sidebar, including a live mm:ss helper.
- Batch selection mode in grid view with checkbox controls and actions for Keep, Delete, Skip, Reset, and Clear.
- Folder header Review action to jump into review mode scoped to one folder.
- Export Report flow in Settings and app menu, including scope selection for all or filtered videos.
- Review mode reset shortcut with configurable keybind support.

### Changed
- Review counter pill now doubles as a progress indicator and shows decided versus remaining counts.
- Report export HTML now includes folder/subfolder grouping and separate Keep, Delete, Pending, and Skipped sections.
- Batch-delete fallback messaging now clearly reports permanent-delete outcomes when recycle-bin trashing is unavailable.

### Fixed
- Grid batch selection state now persists when leaving grid view and returning from review mode.
- Settings tab routing now re-targets correctly from menu actions, including repeated requests to open Reports.
- Export availability is disabled while scanning to avoid stale-data report generation.
- Report export cancellation now shows a cancellation message instead of a generic failure.

## [1.5.1] - 2026-04-13

### Fixed
- Grid mode now invalidates its virtualization cache immediately after folder or subfolder reordering, preventing large spacing gaps and overlap until the window is resized.
- Closing review mode now returns to the previous grid scroll position instead of resetting to the top.
- Autoplay from grid play-click is now one-shot: only the initially clicked video auto-plays, while next/previous navigation opens in thumbnail view.

## [1.5.0] - 2026-04-13

### Added
- Drag-and-drop folder opening for the full app window, with directory validation and clear error feedback for invalid drops.
- Folder choice flow when another directory is already open: "Open as new" or "Add to current session".
- Privacy screen toggle on `Shift+Esc` with a full-window overlay image (`src/assets/privacy-screen-dashboard-cover.png`).
- Recent directories with persisted timestamps, shown in both sidebar and empty state.
- Toast notification system for info and error feedback, with auto-dismiss and manual close.
- Keyboard-accessible folder choice modal with focus trapping and Escape-to-close.

### Changed
- Empty state recent-folders UI simplified to a minimal text-first layout.
- Recent folders shown in UI are limited to the 5 most recent entries.
- "Include subfolders" control moved directly under "Open Directory" for a cleaner flow.
- "Clear all" in recent folders is styled as a clearer interactive control.
- Relative-time and recent-path formatting utilities were centralized in `src/utils.ts` and reused across components.

### Fixed
- Renderer-to-main bridge now exposes dropped-path validation (`validateDroppedPath`) through preload.
- Privacy mode now blocks non-toggle keyboard input and prevents conflicting actions while active.
- Review-mode Escape handling no longer conflicts with `Shift+Esc` privacy toggle.
- Stale recent-directory entries are removed when invalid and are also pruned on app startup.
- Fixed regex path-splitting escape issue in sidebar recent-path formatting.

### Documentation
- Updated `README.md` with current quick-win features and privacy-screen shortcut.

### In Progress
- "Add to current session" currently shows a placeholder notification and is not fully implemented yet.

---

## [1.4.0] - 2026-04-10

Final stable release for the SQLite migration track.
This section is cumulative and includes all changes between `v1.3.0` and `v1.4.0`
(including `v1.4.0-alpha.1` and `v1.4.0-alpha.2`).

### Added
- **SQLite cache layer** — migrated from JSON to `better-sqlite3` with per-folder database files and a dedicated cache module.
- **Chunked bulk persistence** — added chunked SQLite writes with event-loop yielding to keep IPC/UI responsive during large saves.
- **Automatic JSON migration** — legacy `.video-cull-cache.json` is imported on first scan, preserving status and bookmarks.

### Changed
- **Cache architecture** — all cache IO now goes through a single DB path resolver and centralized DB lifecycle.
- **Thumbnail storage location** — thumbnails now live under the app cache root (`userData/video-cache`) instead of colliding with Electron internals.
- **Thumbnail path handling** — DB stores relative thumbnail paths, renderer receives absolute paths via boundary conversion.
- **Scan merge behavior** — cache merge now preserves cached duration, metadata date, bookmarks, status, and thumbnail references.

### Fixed
- **Cache wipe on restart** — resolved DB/thumb data loss caused by writing into Electron's internal cache area.
- **Cascade thumbnail loss on upsert** — replaced destructive replace behavior with safe `ON CONFLICT DO UPDATE` upserts.
- **Missed thumbnail migration path** — migration now checks filesystem state directly and supports cross-device move fallback.
- **Chunked path bypass bug** — ensured bulk initial scan saves use the chunked cache path (`saveCacheChunked`) instead of the blocking monolithic path.
- **Write amplification during thumbnail generation** — store now saves only changed videos (not whole arrays) for thumbnail/status/bookmark/undo updates.
- **Transient save failures** — added a retry queue for partial saves with race-safe token reconciliation.
- **Duration persistence on rescan** — cached duration now survives rescans when thumbnails already exist.
- **Delete flow overhead** — removed redundant full-cache save after batch delete.
- **Cache load performance** — removed N+1 thumbnail query pattern by bulk-loading and grouping thumbnail rows in memory.

### Docs
- **README maintenance** — marked screenshots section as outdated for the v1.3.0 baseline prior to migration work.

### Migration
- **Automatic transition** — old JSON cache files are imported and removed; durations/thumbnails are regenerated or merged from current cache/scan state as applicable.

## [1.4.0-alpha.2] - 2026-04-10

### Fixed
- **Cache persistence** — SQLite databases and thumbnails were being silently wiped on every app restart because the cache directory (`userData/cache`) collided with Electron's internal HTTP cache. Moved to `userData/video-cache`.
- **Thumbnail records lost on rescan** — `INSERT OR REPLACE` in SQLite triggers `ON DELETE CASCADE`, destroying thumbnail records on every scan even when not intended. Switched to `ON CONFLICT DO UPDATE` (true in-place upsert, no cascade).
- **Thumbnail migration skipped** — filesystem migration from `.video-cull-thumbs` to the cache dir was gated on DB records existing, so it silently no-ops after a JSON→SQLite migration (which skips thumbnails). Now checks the filesystem directly.
- **Thumbnails stored flat** — all folders' thumbnails were written to a single `thumbs/` directory. Now organised per-folder as `thumbs/<folder-name>/` matching the DB filename.
- **`saveCacheChunked` never called** — bulk saves in the initial scan used the blocking single-transaction path instead of the chunked async path.

## [1.4.0-alpha.1] - 2026-04-10

### Added
- **Initial SQLite migration** — replaced JSON caching with SQLite (`better-sqlite3`) and introduced per-folder DB cache files.
- **Legacy import path** — first-run migration for existing JSON cache data into SQLite.

### Changed
- **Cache architecture foundation** — introduced centralized cache module (`electron/cache.js`) and DB lifecycle management.
- **Thumbnail migration foundation** — moved thumbnail ownership into cache storage flow and updated scan merge behavior.

## [1.3.0] - 2026-04-09

### Changed
- **UI refinements** — updated accent and status colors (more vibrant keep/delete), subtler borders using alpha values, improved shadows and surface tones throughout
- **Deleted cards** — grayscale + opacity treatment makes marked-for-deletion videos visually recede in the grid; restores on hover
- **Filter pills** — active pills now use accent gradient with glow; keep/delete pills use solid status colors
- **Badge animation** — status badges (keep/delete) animate in with a pop on first appearance
- **Review mode** — counter and close button styled as matching pill/circle pair; keep/delete flash uses radial gradient

### Improved
- **Empty state** — redesigned welcome screen with glowing icon container, gradient title text, and pill-shaped open button

### Removed
- Internal preview modal component (was unreachable dead code; grid play button opens review mode directly)

## [1.2.0] - 2026-04-09

### Added
- **Grid play button opens review mode** — clicking the play button on a video card now navigates directly to review mode and starts playback, instead of opening a separate preview modal.
- **Fully configurable keybindings** — all shortcuts can now be recorded as real key combinations (Esc, Delete, Ctrl+key, etc.) in Settings → Keybindings. Includes conflict detection and a Reset to Defaults button.

### Changed
- Keybindings settings panel reorganised into logical groups (Navigation, Decisions, Playback, While Playing, Preview, Global).
- "Play / Pause (Enter)" renamed to "Play / Pause (alternate)" to avoid implying the key is fixed.

## [1.1.0] - 2026-04-08

### Added
- **Bookmarks** — press B while playing to drop a bookmark at the current position. Bookmarks persist across sessions and appear as clickable chips below the player (click to seek, hover to reveal remove button). A count badge shows on the thumbnail strip when a video has bookmarks.
- **Playback speed controls** — `[` / `]` step through 0.5×, 0.75×, 1×, 1.25×, 1.5×, 2×. Speed is shown as an overlay badge and persists as you move between videos in the same session.
- **Keyboard shortcuts overlay** — press `?` anywhere to open a reference of all shortcuts.

### Fixed
- Rare crash (black screen / render process gone) that could occur while interacting with the video player during playback. Root cause: frequent React re-renders of the Video.js player stack triggered a native access violation in Chromium's media pipeline.

## [1.0.0] - 2026-03-01

Initial release.
