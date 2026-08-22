# Video-Cull Roadmap

All implementation decisions recorded here were made interactively. Each feature includes the
chosen approach and relevant notes.

---

## Feature Toggles

**Decision:** No Minimal/Extended mode split. All optional features are on by default.
Users can disable any feature individually via a **Features** tab in Settings.

### Implementation

- `features` object added to `AppSettings`, one boolean key per optional feature.
- All keys default to `true` — nothing is hidden from new users.
- Optional UI elements check their feature flag before rendering. No restart needed when toggling.
- No mode concept, no first-run popup, no mode-switching logic anywhere in the codebase.
- Electron version is v41.3.0.

### Toggleable Features

| Feature | Settings key | Default |
|---|---|---|
| 5-star rating | `features.ratings` | `true` |
| Favorites (heart) | `features.favorites` | `true` |
| Analytics screen | `features.analytics` | `true` |
| Codec / resolution badges | `features.codecBadges` | `true` |
| Incompatible codec indicator | `features.compatibilityCheck` | `true` |
| Global mute toggle | `features.globalMute` | `true` |
| "Next Undecided" jump | `features.nextUndecided` | `true` |

The **Features** tab in Settings lists each toggle with a one-line description of what it does.

---

## Priority 0 — Switch to SQLite

The only P0 task. Do not fix the JSON cache bug first — that would be fixing a burning
ship before scuttling it. The SQLite migration resolves the duration bug as a side effect:
durations are regenerated from ffprobe during the first scan after migration, so no
separate bug fix is needed.

### Switch cache layer to better-sqlite3

- Add `better-sqlite3` to `dependencies`. Configure `electron-builder` to unpack its
  native binary in `asarUnpack` (same pattern as `@ffmpeg-installer` already in the build config).
- Implement `resolveCachePath(folderPath, mode)` as the single function that all cache
  reads and writes go through. Nothing touches cache files directly.
- On first launch after update: detect old JSON cache files, import their `status` and
  `bookmarks` fields into the new SQLite db, then delete the JSON files. Do not attempt
  to migrate `durationSecs` or `thumbnails` from JSON — regenerate them from ffprobe on
  the next scan instead. This is simpler and more reliable than fixing the JSON bug.
- See Phase 3 for the full schema and cache location architecture.

---

## Phase 1 — Quick Wins (Both Builds)

Small, high-impact changes. No architectural dependencies.

### 1.1 Drag & Drop Folder Opening

**Status:** Implemented in `1.5.0`.
**Note:** "Open as new" is implemented. "Add to current session" UI/flow is in place, but true multi-directory session behavior is still pending Phase 3.

**Decision:** Drop target is the entire app window. Supports **adding** a directory to the
current session, not just replacing it. Distinction between "add" and "open new" must be
explicit in the UI.

**Implementation notes:**
- Listen for `dragover` / `drop` on the root `<div>` in `App.tsx`.
- Extract the folder path from `event.dataTransfer.files[0]`.
- **Validate in Electron main before scanning:** confirm the path exists and `stat.isDirectory()` returns true. Reject files, shortcuts (`.lnk`), and non-existent paths with a clear error message.
- If no directory is currently open → open as new (replace).
- If a directory is already open → prompt: **Add to current session** / **Open as new**.
- The existing "Open folder" button in the sidebar should gain the same choice.
- Electron `webContents` `will-navigate` is NOT needed; use the renderer-side drag events.

### 1.2 Privacy Screen

**Status:** Implemented in `1.5.0`.
**Note:** Current implementation uses a full-window privacy overlay image toggle on `Shift+Esc` (instead of pure black), with input blocking while active.

**Decision:** Solid black overlay covering the entire window. Toggle with **Shift+Esc**
(hardcoded, not configurable for simplicity). Same key toggles it off.

**Implementation notes:**
- One full-screen `position: fixed` black `<div>` in `App.tsx`, conditionally rendered.
- `isPrivate: boolean` state — local React state, no store needed.
- Keydown listener for `Shift+Escape` at the window level.
- Overlay sits above everything else (`z-index` higher than modals).
- No "Video Cull" branding or text shown — pure black.

### 1.3 Recent Directories

**Status:** Implemented in `1.5.0`.
**Note:** Recent directories are shown in both sidebar and empty state, with stale-path validation and startup pruning.

**Decision:** Shown in **both** locations — sidebar dropdown and empty state — but subtle and
non-distracting.

**Implementation notes:**
- Store `recentDirectories: string[]` (max 8) in `AppSettings` / config file.
- On every successful directory open, prepend the path and trim to 8.
- **Sidebar:** Small dropdown/chevron next to the current directory path. Only visible when
  a directory is open. Clicking shows the list; each entry reopens that directory.
- **Empty state:** Below the "Open folder" button, a compact "Recent:" section with
  path entries. Hidden if no recent entries exist.
- Display only the last folder segment + parent for readability
  (e.g., `Footage / 2024` instead of the full absolute path).
- Tooltip shows the full absolute path on hover.

---

## Phase 2 — Core Culling Enhancements (Both Modes)

Culling workflow improvements available in Minimal and Extended.

### 2.1 Hover Scrub

**Status:** Skipped.

**Decision:** Do not implement hover scrub. Current thumbnail resolution is not high enough for
meaningful frame scrubbing feedback, so this would add interaction complexity without practical
value.

**Note:** Reconsider only if thumbnail quality strategy changes in a future phase.

### 2.2 Duration Filter (Min Only)

**Decision:** Minimum duration filter only (consistent with existing minimum size filter).
Requires the cache bug (Priority 0) to be fixed first.

**Implementation notes:**
- Add `minDurationFilter: number` (seconds, default `0`) to store state.
- `computeFiltered` in `store.ts` gains a duration check alongside the size check.
- Sidebar UI: same pattern as the size filter — a number input with a label.
- Display as seconds input with a helper that shows the equivalent in `mm:ss`.

### 2.3 Keyboard Navigation in Grid

**Status:** Skipped.

**Decision:** Do not implement grid keyboard navigation. The grid is already dense and mouse-driven,
and arrow-key focus management adds friction without enough UX benefit for this app.

**Note:** Reconsider only if a dedicated accessibility pass later shows a clear keyboard-first need.

### 2.4 Session Progress Bar in Review Mode

**Decision:** A thin progress bar showing % complete, plus the existing counter enhanced
with decided/remaining counts.

**Implementation notes:**
- Progress = `(keep + delete)` out of `total` in the current filter (not just position).
- Progress is rendered in the review counter pill itself (filled background), not as a separate top bar.
- Counter line becomes: `12 / 47 — 8 decided, 39 remaining`.
- No pace or time estimates (avoid anxiety-inducing metrics).
- Both values derived from existing `stats` in the store — no new state.

### 2.5 Batch Selection in Grid

**Decision:** Checkbox-first batch selection with range selection and explicit status actions.
Selection mode begins on first multi-select, shows checkboxes, and supports Explorer-style
Shift range selection from an anchor.

**Deletion safety:** All delete operations (single and batch) use Electron's
`shell.trashItem(path)` — files go to the OS Recycle Bin, not permanently deleted via
`fs.unlink`. If `shell.trashItem` fails (file too large for Recycle Bin on some systems),
warn the user explicitly before proceeding with permanent deletion. This applies everywhere
in the app that deletes files.
- **Path validation:** Before calling `shell.trashItem` on any path, confirm it starts with one of the currently loaded `directories`. Reject anything outside with an error log and skip that file.
- **Concurrency:** Batch deletes run up to 5 `shell.trashItem` calls in parallel using a concurrency-limited `Promise.all`. Fast without hammering the filesystem.

**Implementation notes:**
- `selectedIds: Set<string>` in local `GridMode` state.
- First multi-select action enters selection mode and selects the clicked card.
- In selection mode, selected cards show checkboxes.
- Shift+click selects a contiguous range from the selection anchor.
- Plain click on a selected card unselects it.
- While selection mode is active, opening/playing videos is only done via the existing card play button.
- Floating bar: fixed at bottom of grid, shows count + Keep / Delete / Skip / Reset / Clear.
- Skip sets selected videos to `skipped`.
- Reset returns selected videos from `keep` / `delete` / `skipped` to `pending`.
- Batch actions auto-clear selection after apply.
- Keep/Delete/Skip/Reset wraps all SQLite writes in a single transaction (`BEGIN`/`COMMIT`) and calls the store's `set()` once with the full updated array — not in a loop. One re-render for the whole batch regardless of selection size.
- Escape key clears selection.

**Review mode decision updates:**
- Skip marks the current video as `skipped` and advances to the next video.
- Reset returns the current video from `keep` / `delete` / `skipped` to `pending`.
- Undo reverses Skip and Reset just like any other status change.

### 2.6 "Review This Folder" Button on Folder Headers

**Decision:** Each folder group header in the grid gets a **▶ Review** button. Clicking it
enters review mode scoped to only that folder's videos.

**Implementation notes:**
- The folder header row in `GridMode.tsx` already has label, count, and size. Add a small
  button on the right.
- Clicking sets a temporary filter to that folder's path, enters review mode at index 0.
- On exit from review mode, restore the previous filter state.
- This means `GridMode` needs to pass a `onReviewFolder(folderPath: string)` callback
  to the row renderer, and `App.tsx` handles the scoping logic.

### 2.7 Export Decisions as HTML

**Decision:** A styled, self-contained `.html` report. Triggered from a less prominent entry
point in the toolbar and Settings, not from the sidebar. The action is only enabled when a
folder is actually loaded; it remains disabled in the empty state.

**Implementation notes:**
- Entry points: toolbar item and Settings button only; hidden from the main sidebar.
- Button label: "Export Report" or similar (small, not prominent).
- Only enable when a folder is loaded (`directory` is set) and the app is not on empty state.
- Electron `ipcMain` handler: `exportReport(videos, dirPath)`.
- Output: single `.html` file with inline CSS (no external dependencies).
- **All user data (filenames, paths, codec strings) must be passed through `escapeHtml()` before insertion into the template.** A filename like `<script>alert(1)</script>.mp4` would otherwise execute when the report is opened in a browser. The utility replaces `& < > " '` with HTML entities. Zero performance impact.
- Structure:
  - Header: directory path, export date, summary counts and sizes.
  - Four sections: Keep / Delete / Pending / Skipped — each a styled table with filename,
    size, duration, date, status badge.
  - Optional: embed the first thumbnail as a base64 `<img>` per row — off by default.
    Warn users clearly: 2,000 videos with thumbnails can produce a 50–150MB HTML file
    that browsers will struggle to render. Show an estimated file size before confirming.
- Default filename: `videocull-report-YYYY-MM-DD.html`.

---

## Phase 3 — Cache Architecture & Multi-Directory

This is an architectural change that must be designed carefully before implementation.

### 3.1 Per-Folder Cache with Smart Subfolder Reuse

**Decision:** Cache stored **inside each folder** on the same drive as the videos
(portable/external drive support). Smart reuse: when scanning a parent folder, subfolders
with existing caches are loaded from cache rather than re-scanned.

**Current state:** One JSON cache file stored in the scanned directory root.

**Cache location strategy — user choice in Settings:**

Three modes, selectable in Settings under a "Cache storage" option:

**Option A — Per-drive**
Cache stored once per drive, in a configurable location on that drive. No subfolder
clutter. Portable/external drives work — the cache travels with the drive, not the machine.

Default path pattern: `{drive}:\Users\{username}\.videocull\cache\`
- On Windows, `{username}` comes from `os.userInfo().username`.
- If `Users\{username}\` doesn't exist on the drive (e.g. a bare external), fall back
  to `{drive}:\.videocull\cache\`.

Users can override the path pattern per-drive in Settings via a folder picker. The chosen
path is stored in config as a map of drive letter to custom path:
```json
"perDriveCachePaths": {
  "C:": "C:\\Users\\ExampleUser\\.videocull\\cache",
  "D:": "D:\\MyCustomCacheFolder"
}
```
- Survives video files being moved within the same drive.
- Cache is lost only if the drive letter changes (uncommon for labelled drives).

**Option B — Centralised (default)**
All cache stored in a single directory. Default location is `%APPDATA%\Video-Cull\cache\`,
but users can choose a custom path via a folder picker in Settings.
```
%APPDATA%\Video-Cull\cache\      ← default, user can change this
  C__Users_ExampleUser_Videos_Footage.db
  D__Footage.db
```
Downside: cache is lost if videos move to a different drive or the machine changes.

**Option C — Distributed (power user / NAS) — ⚠️ NOT RECOMMENDED**
Each folder gets its own `.videocull/` hidden subdirectory. Maximum portability — cache
is colocated with the exact videos it describes. Can cause clutter in large folder trees. 
*Note: Switching back from Distributed to Centralised or Per-drive could be impossible without losing cache data if the tracking index gets lost or if drives are disconnected.*
```text
D:\Footage\2024\
  .videocull\
    cache.db
  clip001.mp4
D:\Footage\2023\
  .videocull\
    cache.db
```

The setting is: `cacheLocation: 'per-drive' | 'centralised' | 'distributed'` in `AppSettings`.
**Default: `'centralised'`** — lowest friction for most users on a single machine.

**The distributed cache index:**
Regardless of the active cache mode, the app always maintains a small index file at
`%APPDATA%\Video-Cull\distributed-index.json`. Every time a distributed cache (Option C)
is written or updated, its folder path is recorded in this index. This solves the core
problem of migrating *away* from distributed mode — without it, the app has no way of
knowing where all the `.videocull/` folders are.
```json
{
  "knownDistributedPaths": [
    "D:\\Footage\\2024",
    "D:\\Footage\\2023",
    "E:\\Archive\\Travel"
  ]
}
```
The index is updated on every cache write, and stale entries (folder no longer exists)
are pruned on app startup.

**Cache migration when switching modes:**

Migration complexity differs depending on direction:

*A or B → C (centralised/per-drive to distributed):*
Straightforward. The source caches are keyed by folder path, so the app knows exactly where to create the `.videocull/` subdirectories. Move the `.db` files and `thumbs\` folders to the target `.videocull` folders, then update the index.

*C → A or B (distributed to centralised/per-drive):*
Uses the distributed index as the source of truth. For each path in the index: if the folder exists, move the `.videocull\cache.db` and `.videocull\thumbs\` to the new roots. If missing, warn the user. Clear the index when done.

*A ↔ B (per-drive ↔ centralised):*
Both modes are centralised structures (different root paths, same file layout), so
migration is a simple folder move. All `.db` files and `thumbs\` folders are copied to the new root and originals deleted.

All mode switches show a progress modal. Dialog options:
- **"Migrate existing cache"** (recommended)
- **"Start fresh"** — discards cache, videos re-scanned on next open
- **"Cancel"**

**Multi-directory session:**
- The store's `directory: string | null` becomes `directories: string[]`.
- Each directory's cache is loaded independently.
- Videos from multiple directories shown together in the grid.
- Folder headers show the root directory as a prefix when multiple roots are loaded.
- "Open new" clears all directories and starts fresh. "Add" appends to the list.

**Cache schema:**
```sql
-- Main video metadata. Never contains thumbnail data.
CREATE TABLE videos (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  path TEXT UNIQUE NOT NULL,
  size_bytes INTEGER,
  file_date INTEGER,
  metadata_date INTEGER,
  duration_secs REAL,
  fps REAL,
  duplicate_hash TEXT,       -- fast pseudo-hash: size + first 1MB + last 1MB chunk
  status TEXT DEFAULT 'pending',
  rating INTEGER DEFAULT 0,
  favorite INTEGER DEFAULT 0,
  compatible INTEGER DEFAULT 1, -- 0 = not playable in built-in player
  video_codec TEXT,
  audio_codec TEXT,
  width INTEGER,
  height INTEGER,
  bookmarks TEXT,            -- JSON array of seconds
  os_thumbnail_path TEXT,    -- RELATIVE path from the cache root (e.g., "thumbs/vid1/os.jpg")
  updated_at INTEGER
);

-- Thumbnail file paths only. Actual image files stored on disk in the cache folder.
-- Only the paths are queried; image loading happens in the renderer via file:// URLs.
CREATE TABLE thumbnails (
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,      -- 0-based position in the strip
  file_path TEXT NOT NULL,   -- RELATIVE path from the cache root (e.g., "thumbs/vid1/thumb.jpg")
  PRIMARY KEY (video_id, idx)
);
```

**Key schema decisions:**
- `thumbnails` is a separate table storing only file paths. Grid queries run
  `SELECT * FROM videos` with zero image data. Thumbnail images are `.jpg/.webp` files
  on disk. The renderer constructs the absolute `file://` URLs at runtime by prepending the `cacheRootDir` to the relative `file_path`.
- **Paths are RELATIVE:** `file_path` and `os_thumbnail_path` store relative paths. This is mandatory so the database remains 100% portable when moving the cache across drives or changing modes.
- Thumbnail files are stored in the cache directory alongside the `.db` file.
- `fps` captured from ffprobe alongside codec/resolution at zero extra cost.
- `duplicate_hash` column is reserved for future use — always `NULL` for now. Duplicate
  detection is skipped until a dedicated feature is scoped. The column stays in the schema
  to avoid a migration later.
- `compatible` flag set via a pre-computed codec→boolean map built at app startup.
  `canPlayType` is called once per codec type (~10 calls total), not once per video.
  During scanning, the main process looks up each video's codec in the map — no IPC per video.

**SQLite implementation rule — no exceptions:**
All SQL queries use `db.prepare()` with `?` bound parameters. No string interpolation or
concatenation in query construction anywhere in the codebase. Enforced at code review.

**Bulk operations use transactions — chunked, not monolithic:**
Any operation inserting or updating more than one row (initial scan, JSON migration, batch
status updates) wraps all writes in `db.transaction()` calls. This is 100x faster than
autocommit and prevents partial writes on crash.

**Critical:** `better-sqlite3` is 100% synchronous. A single large transaction that inserts
thousands of rows blocks the V8 thread for its entire duration. IPC progress messages sent
inside the transaction are queued but never flushed to the renderer until the transaction
commits — the UI appears frozen, then jumps to 100% complete. The fix is chunked transactions
with an explicit event loop yield between chunks:

```javascript
// WRONG — blocks event loop; IPC progress messages never reach the renderer mid-transaction:
const insertAll = db.transaction((videos) => {
  for (let i = 0; i < videos.length; i++) {
    insert.run(videos[i]);
    if (i % 100 === 0) webContents.send('progress', i); // queued, not sent
  }
});
insertAll(videos);

// CORRECT — yields event loop between chunks; progress flushes before the next chunk starts:
const chunkSize = 500;
const insertChunk = db.transaction((chunk) => {
  for (const v of chunk) insert.run(v);
});
for (let i = 0; i < videos.length; i += chunkSize) {
  insertChunk(videos.slice(i, i + chunkSize));
  webContents.send('progress', i);
  await new Promise(resolve => setImmediate(resolve)); // yield event loop
}
```

Chunk size of 500 rows balances transaction overhead against yield frequency. Adjust based
on measured performance; 100–1000 is the practical range for this workload.

**Cache path writability check:**
When a user sets a custom cache path (Option A per-drive or Option B custom location),
the app writes a small test file to the chosen directory before saving the setting. If the
write fails, the setting is rejected with a clear error. This catches network shares,
read-only paths, and permission issues before they cause silent data loss.

**Thumbnail file location — thumbnails always live alongside the `.db` file:**

Thumbnail `.jpg` files are part of the cache, not part of the video folder. They move
wherever the DB moves. The exact location depends on the active cache mode:

| Cache mode | DB location | Thumbnail location |
|---|---|---|
| Centralised (default) | `%APPDATA%\Video-Cull\cache\<folder>.db` | `%APPDATA%\Video-Cull\cache\thumbs\<videoId>\` |
| Per-drive | `{drive}:\.videocull\cache\<folder>.db` | `{drive}:\.videocull\cache\thumbs\<videoId>\` |
| Distributed | `{folder}\.videocull\cache.db` | `{folder}\.videocull\thumbs\<videoId>\` |

The `thumbs\` directory is always a sibling of the `.db` file in the cache root.

**Thumbnail generation (P3 onwards):** `processor.js` writes new thumbnails directly to
the cache directory (`cacheRootDir/thumbs/<videoId>/`), never to the video folder.
The `cacheRootDir` is passed down from `main.js` (same value used for the DB path).

**Thumbnail migration (on first P3 launch):** Any existing `.video-cull-thumbs` folders
inside video directories (written by P0/P1/P2) must be relocated to the new cache location.
This happens automatically during the first scan after upgrade:
1. For each video in the DB, check if its thumbnail paths point to the old `.video-cull-thumbs` location.
2. Move the files to `cacheRootDir/thumbs/<videoId>/` and update the `thumbnails` table with the new paths. *(Note: If the active mode is Option C/Distributed, the cacheRootDir is `.videocull/`, so this step is just a fast local directory rename from `.video-cull-thumbs` to `.videocull/thumbs`)*.
3. Once all thumbnails for a video are moved, delete the now-empty `.video-cull-thumbs` folder from the video directory.
4. If a move fails (e.g. cross-device), fall back to copy + delete. If that also fails, mark for regeneration.

This migration runs silently in the background after the scan completes and does not block the UI.

**When switching cache modes (A ↔ B):** Thumbnail files must be physically moved alongside
the `.db` files as part of the mode-switch migration. The migration dialog ("Migrate / Start
Fresh / Cancel") covers both DB files and their accompanying `thumbs\` directories.

---

## Phase 4 — Feature Additions

Optional features that build on the core culling workflow. All enabled by default; each individually toggleable via the Features tab in Settings.

### 4.1 5-Star Rating

**Decision:** Shown and interactive on the video card in grid mode, and in review mode
below the meta row.

**Implementation notes:**
- Add `rating: 0 | 1 | 2 | 3 | 4 | 5` to the `Video` type (default `0`).
- `setVideoRating(videoId, rating)` action in the store, saves to cache.
- Card: 5 star icons in the card footer. Click sets rating. 0 = no stars shown until hover.
- Review mode: same 5-star row below filename/meta.
- Sidebar: add filter chip "★ Rated only" (any rating > 0).
- Sort option: "Sort by rating."

### 4.2 Heart / Favorites Toggle

**Decision:** On the card and in review mode. Filterable from the sidebar.

**Implementation notes:**
- Add `favorite: boolean` to the `Video` type (default `false`).
- `toggleFavorite(videoId)` action in the store.
- Card: heart icon in the top-right corner of the card (subtle when off, filled when on).
- Review mode: heart toggle button next to the filename.
- Sidebar filter: "♥ Favorites" filter option.
- Different semantic from Keep/Delete — it means "best of my kept videos", not a
  culling decision. Rating and Favorites coexist independently.

### 4.3 Resolution + Codec on Video Type

**Decision:** Captured during thumbnail generation (ffprobe already runs) — zero added cost.
Displayed as small badges on the card and in the review mode meta row.

**Implementation notes:**
- Add to `Video` type: `videoCodec: string | null`, `audioCodec: string | null`,
  `width: number | null`, `height: number | null`.
- Capture in the Electron thumbnail generation code (alongside existing duration/date
  extraction from ffprobe output).
- Resolution badge logic:
  - width ≥ 3840 → `4K`
  - width ≥ 1920 → `1080p`
  - width ≥ 1280 → `720p`
  - otherwise → `{height}p` or omit
- Codec badge: display codec name (e.g., `H.265`, `AV1`, `H.264`).
- FPS badge: always displayed (e.g., `24fps`, `60fps`, `120fps`). Captured from ffprobe
  alongside codec at zero extra cost.
- **ffprobe returns FPS as a rational fraction string, not a float.** `r_frame_rate` and
  `avg_frame_rate` return values like `"60/1"`, `"30000/1001"` (≈29.97), or
  `"24000/1001"` (≈23.976). The ingest code must split on `/` and compute
  `numerator / denominator` before storing in the `fps REAL` column. Use `avg_frame_rate`
  as the primary source; fall back to `r_frame_rate` if `avg_frame_rate` is missing or
  `"0/0"`. Round to 2 decimal places for display (e.g. `29.97fps`, not `29.970329970329972fps`).
- Card: small badges below the thumbnail strip, left-aligned. Order: resolution, codec, fps.
- Review meta row: appended after date.
- Sorting: add "Sort by resolution" and "Sort by fps" options.

### 4.4 Storage Analytics Screen

**Decision:** Dedicated screen accessible from the sidebar. Not always-visible.

**Implementation notes:**
- Sidebar nav item: "Analytics" (or chart icon).
- Requires resolution + codec on `Video` type (Phase 4.3 must be done first).
- Analytics computed via SQLite aggregate queries (`SUM`, `GROUP BY`) — not from the
  in-memory Zustand store. Fast even at 10,000+ videos.
- Stats to display:
  - Total library size and video count.
  - Size breakdown by codec (H.264 / H.265 / AV1 / other) — bar chart or table.
  - Size breakdown by resolution tier (4K / 1080p / 720p / other).
  - Size breakdown by folder (top 10).
  - Size breakdown by year (from `metadataDate`).
  - Potential savings: "X GB could be freed by deleting marked videos."
- Use simple CSS bar charts — no charting library needed.

### 4.5 Incompatible Codec Indicator

**Decision:** Flag videos that can't play in the built-in player with a visible badge.
No proxy generation — users play incompatible files in the external player, which already
works today.

**Compatibility detection:** Use `HTMLVideoElement.canPlayType(mimeType)` in the renderer
— not hardcoded codec strings from ffprobe. Chromium's media engine gives the authoritative
answer, accounting for platform-specific support and Electron build variations. The
`compatible` flag in the SQLite schema is set from this check, not from ffprobe output.
ffprobe still captures codec name/resolution for display purposes.

**canPlayType requires specific MIME strings.** Passing only the container (e.g.
`video/mp4`) returns `"maybe"` which is useless. The codec parameter must be included.
Use ffprobe to get both container format and codec name, then map them to the correct
MIME+codec string before calling `canPlayType`:

```
ffprobe output          → canPlayType string
────────────────────────────────────────────────────────
mp4 + h264              → video/mp4; codecs="avc1.42E01E"
mp4 + hevc/h265         → video/mp4; codecs="hvc1"
mp4 + av1               → video/mp4; codecs="av01.0.00M.08"
webm + vp8              → video/webm; codecs="vp8"
webm + vp9              → video/webm; codecs="vp9"
webm + av1              → video/webm; codecs="av01.0.00M.08"
ogg + theora            → video/ogg; codecs="theora"
mov + prores            → video/quicktime; codecs="ap4h"  ← likely "no"
avi + mpeg4/divx        → video/x-msvideo                ← likely "no"
```

Return values from `canPlayType`: `"probably"` = supported, `"maybe"` = uncertain
(treat as compatible to avoid false positives), `""` (empty string) = not supported.
Only `""` sets `compatible = 0` in SQLite. Build the mapping table as a shared constant
in the Electron main process so it can be unit tested independently of the renderer.

**Implementation notes:**
- During thumbnail generation, test playability via IPC: renderer calls `canPlayType`,
  result stored in `compatible` column.
- No badge on individual cards — keeps cards clean.
- In review mode, the Play button is replaced by "Open in external player" for incompatible
  files — no confusing silent failure.
- Toolbar shows a count of incompatible videos; clicking it filters the grid to show only
  those files.
- Unsupported-codec report remains a separate future report track from the current
  Phase 2.7 decisions report.
  
### 4.6 "Next Undecided" Jump Navigation

**Decision:** A keyboard shortcut in review mode that jumps directly to the next video
with `status = 'pending'`, skipping already-decided videos.

**Implementation notes:**
- Keybind: configurable, suggested default `Tab`.
- Scans forward from the current `reviewIndex` through `filteredVideos` for the next
  pending video. Wraps around to the beginning if none found after current position.
- Shows a toast if there are no pending videos remaining.
- Pairs naturally with the progress bar (Phase 2.4) — users can see how many remain and
  jump through them efficiently.

### 4.7 Global Mute Toggle

**Decision:** A global mute toggle that suppresses all audio in both grid hover and review
mode. Persisted across sessions.

**Implementation notes:**
- Add `globalMute: boolean` to `AppSettings` (default `false`).
- Configurable keybind, suggested default `M`.
- When muted, all `<video>` elements have `muted` attribute set. The mute state is also
  shown as a small persistent icon in the toolbar so users know audio is suppressed.

### 4.8 Library Management Tab

A **Library** tab in Settings that surfaces all known cached folders as a managed library.
This is the first step toward the app becoming a persistent home for video collections
rather than a folder-by-folder tool.

**Display:**
- Folders grouped by root (top-level scanned path) — not listed as individual subfolder entries.
- Each root shows aggregate stats: total video count, total size on disk, decisions summary
  (keep / delete / pending / skipped), last scanned date.
- Expand a root to see its subfolder caches as a collapsible tree. Collapsed by default.

**Actions per root:**
- **Delete cache** — removes the `.db` file(s) and thumbnail files for that root. Video files are not touched.
- **Rescan** — opens the folder directly into a new scan, bypassing the folder picker.
- **Rewire path** — for when the folder has moved to a new location. Opens a folder picker,
  then performs a path-prefix find-and-replace across all stored paths in the DB and renames
  the DB file key. Shows a preview (old prefix → new prefix, N rows affected) before committing.

**Implementation notes:**
- Build the root tree from the `knownCacheFolders` registry: any stored path that is a
  prefix of another is its parent. Paths that share no prefix become separate roots.
- Aggregate stats via SQLite `SUM` / `COUNT` queries across all DBs under a root — not
  from the in-memory store.
- Rewire runs as a single `db.transaction()`. The preview step is mandatory before applying.
  If the write fails mid-transaction, the DB is rolled back cleanly.

### 4.9 About Tab in Settings

A dedicated **About** tab at the end of the Settings modal.

**Contents:**
- App name and current version (injected at build time via `import.meta.env.VITE_APP_VERSION`).
- Link to the GitHub repository (`shell.openExternal`).
- Link to the GitHub Releases / Changelog page.
- Two support buttons: **GitHub Sponsors** and **PayPal** (links from `.github/FUNDING.yml`).

**Implementation notes:**
- Version defined in Vite config via `define: { __APP_VERSION__: JSON.stringify(pkg.version) }`.
- All external links use `shell.openExternal` — no in-app navigation.
- Support buttons are secondary style — present but not prominent.

---

## Phase 5 — Documentation and In-App Guidance

As the feature set grows, users need both a discoverable reference and small bits of
guidance at the exact points where the workflow becomes unclear. This phase adds a local,
version-matched documentation surface and uses it to make the existing app easier to learn
without changing the underlying product model.

**Status:** Implemented in `2.1.0`.

### 5.1 Documentation Delivery

**Decision:** In-app modal (no separate Electron window, no extra Chromium process). The
modal renders documentation content directly in the main app window. A prominent link at
the top points users to the GitHub docs for the most up-to-date version.

**Implementation notes:**
- `Help → Documentation` in the Electron menu bar and a `?` icon in the app chrome open the
  docs modal over the current view.
- Modal header: "Documentation — for the latest version, visit [GitHub ↗]" with a
  `shell.openExternal(githubDocsUrl)` link.
- Content is bundled with the app so it works offline and matches the shipped version.
- The keyboard shortcut reference page renders the user's actual current keybinds from
  the store, not hardcoded defaults.
- Modal is dismissible with Escape or a close button.

### 5.2 Documentation Structure

**Decision:** Task-first pages, not a feature dump. The docs should explain how to use the
existing workflows the app already has today.

```
Documentation
├── Getting Started
│   ├── What is Video Cull?
│   ├── Opening folders and building a session
│   └── The main workflow: scan → review → delete
├── Grid View
│   ├── Filtering, sorting, and grouping
│   ├── Card actions and context menus
│   └── Batch selection
├── Review Mode
│   ├── Keyboard shortcuts
│   ├── Playback, bookmarks, and external player fallback
│   └── Scope, progress, and decision flow
├── Duplicate Review
│   ├── Visual vs. pHash
│   ├── Similarity, sample count, and recommended starting points
│   ├── Suggested keeper, right-click actions, and batch actions
│   └── Ignored matches and reruns
├── Cache and Processing
│   ├── Cache storage modes
│   ├── Thumbnail generation settings
│   └── Which settings apply now vs. next run
├── Delete and Safety
│   ├── Marking vs. deleting
│   ├── Recycle Bin behavior
│   └── Empty-folder cleanup
└── FAQ
    ├── Which video formats are supported?
    ├── Why are some videos opened in the external player?
    └── How do I move cache to a new drive?
```

### 5.3 Authoring

**Decision:** The selected Mintlify MDX pages are the canonical source for both the website
and the in-app guide. The modal uses an explicit allowlist so installation, building from
source, and other website-only pages do not enter the app.

**Implementation notes:**
- Docs content lives in `docs/`, is imported at build time, and ships with the renderer.
- The in-app adapter supports the MDX structures used by the selected subset and fails
  clearly when an unsupported component is added.
- MDX comment markers in the shortcut page replace the static website tables with the
  user's live configured bindings inside the app.
- Tests lock the allowlist, task targets, supported rendering, unsupported-component
  behavior, internal modal navigation, and live keybinding output.

---

## Phase 6 — Duplicate Detection Improvements

This phase is reserved for actual duplicate-quality work: better defaults, better repeatable
evaluation, and better behavior on difficult real-world libraries. Do not mix this into the
Phase 5/7 clarity work.

### 6.1 Benchmark Harness

**Decision:** Measure first, tune second. Duplicate work should be driven by a repeatable
benchmark corpus instead of anecdotal threshold tweaking.

**Implementation notes:**
- Add a local benchmark runner that can evaluate duplicate settings against a manifest-driven
  corpus outside the repo.
- Report false positives, false negatives, group counts, and per-mode results.
- Use the same harness to compare `visual`, `pHash`, and partial-clip runs on the same
  library slice.

### 6.2 Test Coverage Expansion

**Decision:** Strengthen the existing duplicate tests rather than bolting on a separate,
fragile test path.

**Implementation notes:**
- Expand duplicate tests for cross-format copies, different encodes, duration-tolerance
  edge cases, weak-link group cleanup, partial clips, and settings interactions.
- Keep the current low-level style: deterministic fixtures, fake rows where practical,
  and explicit group expectations.

### 6.3 Better Defaults and Presets

**Decision:** Revisit duplicate defaults only after the benchmark harness exists.

**Implementation notes:**
- Re-evaluate whether `visual` should remain the default comparison mode.
- Re-evaluate the default sample count of `3` and the default similarity threshold of `95`.
- If enough evidence supports it, add simple presets such as `Strict`, `Balanced`, and
  `Broad` instead of forcing users to hand-tune every knob.

### 6.4 Cross-Format and Near-Duplicate Improvement

**Decision:** Focus on the cases users actually struggle with: copies in different formats,
different encodes, and near-duplicates that are close enough to matter but noisy enough to
trip false positives.

**Implementation notes:**
- Improve candidate filtering and confirmation logic for cross-format copies.
- Reduce false positives at lower thresholds without making the strict range weaker.
- Keep daisy-chain cleanup conservative so weak links do not pull unrelated videos into the
  same group.

### 6.5 Partial Clip Detection

**Decision:** Add VDF-style partial clip detection for cases where a shorter video is a
trimmed and/or cropped segment of a longer video, such as Twitter downloads cut from a full
scene. The first version uses bundled FFmpeg PCM audio alignment plus crop-aware visual
confirmation, not a Chromaprint dependency.

**Implementation notes:**
- Add a `partialClipDetection` duplicate setting. Keep it separate from normal duplicate
  matching because it is more expensive than same-timestamp comparison.
- After the existing duplicate pass, compare remaining unmatched videos where the shorter
  duration is roughly `10%` to `95%` of the longer duration.
- Extract low-rate mono PCM audio with the existing bundled FFmpeg, build compact audio
  features, and slide the shorter feature sequence over the longer one to find the best
  offset.
- Only continue when audio similarity clears the configured threshold. For the known
  Twitter/full-video test case, this should find the clip at about `230.77s` into the
  full video.
- Confirm visually at aligned timestamps: shorter video at `t`, longer video at
  `offset + t`. Compare normal full-frame resize and a center-crop variant that accounts
  for changed aspect ratio.
- Add `partial` as a duplicate match type and reuse the existing duplicate group UI. The
  group reason should include the approximate offset and audio/visual similarity.
- Keeper suggestion should prefer the longer/full video unless the user manually overrides it.
- Keep the audio-alignment helper isolated so a future Chromaprint/fpcalc implementation can
  replace PCM alignment without changing the duplicate grouping code.

### 6.6 Future Scope Boundary

**Decision:** Do not port VDF wholesale. Upgrade to Chromaprint/fpcalc only if the PCM
alignment version misses real clip matches in the benchmark corpus or user test folders.

---

## Phase 7 — Whole-App Usability Pass

Documentation explains the app; this phase makes the app itself easier to understand in
daily use. No major feature expansion — just clarity, consistency, and workflow polish
across the screens that already exist.

### 7.1 Sidebar and Action Hierarchy

**Decision:** Rework the visible order and wording of the main controls so the primary
workflow reads more clearly top-to-bottom.

**Implementation notes:**
- Recheck the hierarchy of: folder/session opening, scan state, review entry, duplicate
  entry, and delete actions.
- Tighten button copy so it describes the user-facing outcome instead of the internal
  mechanism.
- Make mode transitions clearer, especially entering and leaving duplicate groups mode.

### 7.2 Grid / Review / Duplicate Workflow Consistency

**Decision:** The same status concepts should feel the same everywhere. A keep/delete/skip
decision made in one part of the app should be obvious when seen in another.

**Implementation notes:**
- Align wording and visual treatment of `Keep`, `Delete`, `Skipped`, and `Pending` across
  grid, review mode, and duplicate review.
- Make it clearer that duplicate actions are library status changes, not immediate disk
  deletion.
- Recheck review entry/exit behavior from duplicate mode so the current scope is always
  obvious.

### 7.3 Duplicate Review Clarity

**Decision:** Keep the current duplicate-review model, but make it easier to understand at
first glance.

**Implementation notes:**
- Strengthen the distinction between suggested keeper, selected keeper, and ordinary rows.
- Make batch selection look unmistakably like batch selection.
- Revisit wording for `Select suggested deletions`, `Not a match`, `Dismiss group`, and
  selected-keeper actions.
- Add clearer disabled-state explanations when actions require a selected pair or a non-empty
  batch.

### 7.4 Settings Usability Pass

**Decision:** Keep the current Settings scope, but reorganise and clarify the copy so users
do not need to infer what a technical option does.

**Implementation notes:**
- Revisit tab and subsection labels for scanability.
- Add short "safe default / when to change this" help text where current labels are too
  technical.
- Reshape the duplicate settings flow into: enable → matching → scope → keeper rules →
  ignored matches → advanced.
- Make expensive or risky actions stand out more clearly: cache migration, thumbnail rebuild,
  distributed cache mode.

### 7.5 Empty, Loading, and Long-Run Feedback

**Decision:** Standardise the language used when the app is empty, busy, waiting, or blocked.

**Implementation notes:**
- Standardise empty-state wording across grid, duplicate mode, and settings-triggered flows.
- Standardise long-run progress language for scanning, metadata, thumbnail generation, and
  duplicate detection.
- Review disabled-button titles and toasts so they consistently explain what is happening,
  what is deferred, and what touches disk.

---

## Skipped Features (Recorded for Future Reference)

| Feature | Reason skipped |
|---|---|
| Hover scrub (Phase 2.1) | Skipped — thumbnail resolution is currently too low for useful scrubbing feedback |
| Grid keyboard nav (Phase 2.3) | Skipped — keyboard focus management added friction without enough UX value |
| Duplicate comparison screen | Removed — other apps handle this; duplicate_hash column reserved in schema for future |
| Tag system | Too much visual clutter for now |
| Video notes | Skipped in favour of rating + favorites |
| m3u8 → mp4 conversion | Out of scope for now |
| Folder watch (auto-detect) | Skip until multi-dir is mature |
| Volume persistence | Not needed |
| Auto-advance timer | Creates anxiety, causes mistakes |
| Torrent downloading | Different app entirely |
| AI quality scoring | Heavy deps, unreliable for creative content |

---

## Development Process

### Branch Strategy

One feature branch per phase. Branch off the previous phase branch, not always off main.
Merge into main only when the phase is solid and the app is fully usable without future phases.

```
main                   ← stable, always launchable, tagged at each release
  └─ p0-sqlite
       └─ p1-quick-wins
            └─ p2-culling-enhancements
                 └─ p3-cache-architecture
                      └─ p4-extended-mode
                           └─ p5-documentation-guidance
                                └─ p6-duplicate-improvements
                                     └─ p7-usability-pass
```

Never work directly on main. Never bump the version mid-branch.

### Commit Frequency

Commit at logical stopping points — not by time. Good triggers:
- A single feature works end-to-end (even if rough)
- You are about to touch a different file domain
- Before any risky refactor
- When you have just fixed a bug that was annoying to track down

Avoid committing half-migrated states where two systems coexist but neither fully works.

### Version Map

| Phase | Version | Notes |
|---|---|---|
| P0 — SQLite migration | `1.4.0` | Invisible to users; JSON auto-migrated |
| P1 — Quick wins | `1.5.0` | Drag & drop, privacy screen, recent dirs |
| P2 — Culling enhancements | `1.6.0` | Duration filter, progress bar, batch select, HTML export, etc. |
| P3 — Cache architecture | `1.7.0` | Per-drive mode, multi-directory, migration dialog |
| P4 — Feature additions | `2.0.0` | Ratings, analytics, codec, library tab, feature toggles |
| P5 — Documentation and in-app guidance | `2.1.0` | Additive, ships with or after P4 |
| P6 — Duplicate detection improvements | `2.2.0` | Benchmarking, defaults, partial clips, and duplicate-quality work |
| P7 — Whole-app usability pass | `2.3.0` | Clarity and workflow polish, no major feature expansion |

Version bump happens in one commit, at the moment of merging the phase branch into main.
Tag every release: `git tag v1.4.0 && git push origin v1.4.0`.

### Each Version Must Work Standalone

Every merged version must be fully usable without any future phase installed.
Before merging a phase branch into main, verify:
1. App opens a real folder and scans without errors
2. Status changes persist after restart
3. Build packages without warnings (`npm run package`)
4. No half-finished UI from the next phase is accidentally visible

The one architectural rule that makes this possible: **define the full SQLite schema in P0.**
All columns needed by P4 (`rating`, `favorite`, `compatible`, `video_codec`, `fps`, etc.)
are created from day one. Unused columns stay `NULL` at their defaults. No schema migration
is needed when P4 ships — the table already has the columns.

### CHANGELOG

Update `CHANGELOG.md` in the same commit as the version bump. Format:

```markdown
## [1.4.0] — YYYY-MM-DD
### Changed
- Cache layer switched from JSON to SQLite (better-sqlite3)
- Video durations now accurate and stable across reloads

### Migration
- Existing .video-cull-cache.json files are automatically imported on first launch
- Status and bookmarks preserved; thumbnails regenerated on next scan
```

---

## Progress Tracker

Update the status column as work completes. Merge date recorded when phase lands on main.

| Phase | Status | Version | Merged |
|---|---|---|---|
| P0 — SQLite migration | ✅ Merged to main | `1.4.0` | 2026-04-10 |
| P1 — Quick wins | ✅ Merged to main | `1.5.0` | 2026-04-13 |
| P2 — Culling enhancements | ✅ Merged to main | `1.6.0` | 2026-04-16 |
| P3 — Cache architecture | ✅ Merged to main | `1.7.0` | 2026-04-25 |
| P4 — Feature additions | ✅ Merged to main | `2.0.0` | 2026-06-24 |
| P5 — Documentation and in-app guidance | ✅ Merged to main | `2.1.0` | 2026-08-22 |
| P6 — Duplicate detection improvements | ⬜ Not started | `2.2.0` | — |
| P7 — Whole-app usability pass | ⬜ Not started | `2.3.0` | — |

Status key: ⬜ Not started · 🔄 In progress · ✅ Merged to main

---

## Implementation Order (Suggested)

```
P0  Switch cache to better-sqlite3 — resolves duration bug as side effect, no separate fix needed

P1  Drag & drop (Phase 1.1)
P1  Privacy screen (Phase 1.2)
P1  Recent directories (Phase 1.3)

P2  Duration filter (Phase 2.2)
P2  Session progress bar (Phase 2.4)
P2  Batch selection + shell.trashItem deletion safety (Phase 2.5)
P2  Folder review button (Phase 2.6)
P2  Export decisions HTML (Phase 2.7)

P3  Cache architecture + location setting + per-drive custom paths (Phase 3.1)
P3  Multi-directory session support (Phase 3.1)
P4  Feature toggles infrastructure — `features` in AppSettings, Features tab in Settings
P4  Resolution + codec + fps on Video type (Phase 4.3) ← enables 4.4 and 4.5
P4  5-star rating (Phase 4.1)
P4  Favorites toggle (Phase 4.2)
P4  Analytics screen (Phase 4.4)
P4  Incompatible codec indicator + badge (Phase 4.5)
P4  "Next Undecided" jump navigation (Phase 4.6)
P4  Global mute toggle (Phase 4.7)
P4  Library management tab (Phase 4.8)
P4  About tab in Settings (Phase 4.9)

P5  Documentation modal + task-first docs structure (Phase 5.1, 5.2)
P5  Documentation authoring model (Phase 5.3)

P6  Duplicate benchmark harness (Phase 6.1)
P6  Duplicate test coverage expansion (Phase 6.2)
P6  Better defaults and presets, if benchmark-backed (Phase 6.3)
P6  Cross-format and near-duplicate improvement (Phase 6.4)
P6  Partial clip detection with audio alignment + crop-aware visual confirmation (Phase 6.5)

P7  Sidebar and top-level action hierarchy pass (Phase 7.1)
P7  Grid / review / duplicate workflow consistency pass (Phase 7.2)
P7  Duplicate review clarity pass (Phase 7.3)
P7  Settings usability pass (Phase 7.4)
P7  Empty, loading, and long-run feedback pass (Phase 7.5)
```
