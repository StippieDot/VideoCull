# Backlog

This file tracks issues and product improvements that are still relevant in the current build. Completed work and disproven findings are intentionally omitted.

## High

### 1. Background media analysis can exhaust source-storage capacity

- Automatic processing concurrency currently considers CPU count and free memory, but not source-storage throughput, seek latency, or contention.
- The same limit is used for metadata probes, thumbnail extraction, and duplicate fingerprint extraction. On a 12-thread test system, Auto selected 15 simultaneous readers.
- Thumbnail and duplicate fingerprint work perform repeated seeks. This is particularly disruptive on hard drives, network shares, and virtual or SFTP-mounted drives.
- Playback became slow both inside VideoCull and in an independent VLC process while VideoCull was processing files. This confirms system-wide storage contention rather than a problem confined to the built-in player.
- Mounted remote storage may report itself as a fixed NTFS drive, so drive-type classification alone is not reliable.
- Manual duplicate detection is blocked during metadata processing, but it can still overlap thumbnail generation and create a second I/O-heavy worker pool.

Proposed direction:

- Keep CPU and memory limits as an upper bound, then apply a per-source I/O limit.
- Start conservatively for an unmeasured source and adapt using bounded measurements of real read/seek behavior. Do not derive concurrency from one sequential speed test alone.
- Select a limit below the observed saturation point so foreground playback retains headroom.
- Coordinate all disk-reading pipelines so thumbnail and duplicate workers cannot independently exceed the shared source limit.
- Reduce or pause background admission automatically while VideoCull is playing, buffering, or seeking.
- Optionally reduce the shared budget while the window is minimized or in the background. This lowers resource use, heat, and fan noise at the cost of longer processing time.
- Keep explicit numeric concurrency as an expert override and describe the setting as applying to media analysis, not only thumbnail FFmpeg processes.

An adaptive limit can provide best-effort headroom, but it cannot guarantee smooth playback in external players because VideoCull cannot observe their bitrate or buffering state. The manual processing pause provides a reliable fallback when foreground playback needs the source storage.

### 2. Renderer media-pipeline crash still needs reproduction

- A development run recorded a renderer crash with Windows status `0x80000003` (`STATUS_BREAKPOINT`) while video playback and background metadata work overlapped.
- The main process was not out of memory, and the GPU process remained alive. The system-wide playback contention is proven, but it does not by itself prove the renderer crash's exact cause.
- VideoCull now starts local-only Electron crash reporting before renderer creation and logs the exact dump directory.

Proposed direction:

- Reproduce after background I/O controls are available and inspect the dump before changing the media player or Chromium configuration.

## Medium

### 3. Duplicate results are not persisted between launches

- Fingerprints and ignored pairs are cached, but completed duplicate groups exist only in renderer state.
- Closing VideoCull therefore loses the finished review result and requires another duplicate run.
- Persist duplicate-group results with enough source/settings identity to invalidate them safely when videos, fingerprints, or matching settings change.

### 4. Renderer video state still scales through whole-array updates

- The renderer keeps complete video records in arrays and several update paths copy, merge, or filter those arrays when only a small number of videos changed.
- The focused view-level caches reduce immediate UI stalls, but allocation and garbage-collection pressure still grows with the full session size.
- Normalize video records by ID and keep ordered ID lists for views so individual status and metadata updates can be applied incrementally.
- This touches most store selectors and update paths, so it needs dedicated regression and performance coverage rather than a release patch.

### 5. Visual duplicate processing needs a lower-memory data flow

- Large visual duplicate runs retain comparison and fingerprint data across worker stages, increasing peak memory with the number of videos and samples.
- Process fingerprints in bounded batches and use compact transferable representations so workers do not retain multiple full forms of the same sample data.
- Preserve exact result equivalence and benchmark throughput before adopting the new flow; reducing batch size can lower memory while increasing total run time.

### 6. IPC and cache reads often move complete video records

- Several operations serialize or hydrate complete video objects even when the caller needs only IDs, paths, status, or a small metadata subset.
- Introduce purpose-specific IPC payloads and targeted SQLite column queries for the highest-volume paths.
- This can reduce peak memory and serialization work, but requires coordinated contract changes across the main process, preload, renderer, and tests.

### 16. macOS builds are not notarized and cannot update themselves

- Issue #29. The macOS beta ships unsigned, so Gatekeeper blocks the first launch until the person runs `xattr -cr` or allows it in System Settings (README documents this), and the app does not update itself.
- Self-update on macOS needs a signed and notarized app, which needs an Apple Developer ID and signing secrets in the release workflow. Until then new versions are a manual download.
- Proposed direction: sign and notarize in `release.yml` once an Apple Developer account exists, then enable the updater for the macOS build. Keep the manual-download note in the README until it does.
- The macOS beta should not be called stable before this lands or the first-launch step is judged acceptable by testers.

## Low

### 7. Duplicate matching is weak for trimmed or offset copies

- The duplicate engine compares samples at corresponding relative positions and applies duration tolerance.
- It is effective for exact files, re-encodes, resized copies, and broadly aligned full-length videos, but it is not designed to align a trimmed excerpt with its longer source.
- Document this limitation explicitly. Treat sliding-window comparison or audio fingerprints as a future algorithm project rather than a small matching adjustment.

### 8. Suggested keeper rules do not account for source trust or file health

- Keeper selection can prioritize resolution, bitrate, duration, frame rate, and file size.
- It cannot prefer trusted source folders or account for structural file health, silent variants, or likely reframing when candidates are otherwise close.
- If real libraries need it, add optional reorderable soft rules such as source-path priority and metadata-based container health. Keep them disabled by default and do not let them change duplicate grouping.
- Codec preference is the one rule from this family that is committed: roadmap 1.6 (issue #31).

### 9. Duplicate defaults and keeper ranking have manually synchronized copies

- Duplicate defaults exist in both the renderer settings layer and the CommonJS backend.
- Keeper comparison logic is also mirrored in renderer and backend code.
- Sync comments and separate tests reduce the immediate risk, but there is no single shared implementation or direct parity test.
- Prefer a shared side-effect-free module if it fits both build environments. Otherwise add an explicit parity test covering defaults and keeper ordering.
- The keeper rule list itself is a third copy: `KEEPER_RULES` in both `src/keybind-defaults.ts` and `electron/duplicate-utils.js`. A parity test now covers the defaults, rule names and codec order (`tests/src/keybind-defaults.test.ts`); the ranking functions are still two copies.

### 10. FFprobe has no cancellable per-file timeout

- A malformed, inaccessible, or unusually slow video can occupy a metadata worker indefinitely until the broader operation is cancelled.
- Add a cancellable timeout that terminates the probe and records a retryable metadata failure.
- Keep the default conservative or adaptive because a short timeout could defer valid probes on slow disks and network shares.

### 11. Reproducible disk caches have no size budget

- Thumbnail and fingerprint artifacts can continue growing with every library the user processes.
- Add a configurable quota with least-recently-used eviction for data that can be regenerated.
- Eviction bounds disk use but makes revisiting cold videos slower while their thumbnails or fingerprints are rebuilt.

### 12. Undo history is not bounded by retained data size

- Long sessions can retain old action snapshots beyond the period in which users are likely to undo them.
- Cap history using both an action count and an approximate retained-data budget.
- The user-visible tradeoff is that sufficiently old actions can no longer be undone.

### 13. Session path lookups retain parallel full-library indexes

- Session validation currently maintains more than one path-oriented collection for the loaded library.
- Consolidate them behind one authoritative index where lookup requirements allow it.
- The likely memory saving is modest, so include this in a broader session-state cleanup rather than performing an isolated refactor.

### 14. Distributed cache for a video reached through a file link sits beside the link

- With the experimental **Follow symbolic links and junctions** setting on and the distributed cache mode, a video reached through a file symbolic link has its cache row and thumbnails in the link's folder, not beside the real file. Folder links and junctions are not affected: their path already leads into the target folder.
- Decisions are saved safely where they are; the only effect is where they live. Opening the target folder directly does not show them.
- Moving the row beside the real file is not safe with the current cache: every scan of a folder prunes all rows in its database that the scan did not see (`pruneStaleVideosBefore`), so the target folder's next scan would delete the linked video's review decisions. About a dozen call sites also derive the cache folder from `path.dirname(video.path)` (main.js, duplicates.js, cache-folder-tracker.js).
- Do with Phase L (persistent library), which reworks where rows live and how they are pruned: route every cache lookup through one resolver that uses the real path, and prune only rows whose real folder is the scanned folder.

### 15. Show what's new once after an update

- Updates change a lot at once, and the only place to read about them is the full release notes on GitHub (Help > Release Notes).
- Agreed design: a panel shown once on the first start after an update (never on a fresh install, never behind the privacy screen, not during a scan), reopenable from Help > What's New. At most three highlights, each written as what the person can now do, with a button that opens the feature; one "Good to know" line for changed behaviour; a link to the full release notes. Skipped versions are combined. Releases without highlights show nothing.
- Highlights are written by hand per release, never generated from the changelog, and ship with the app so they work offline. A release check refuses more than three highlights or a highlight without an action.
- Pictures per highlight, in light and dark, captured by a script that reuses the Playwright Electron harness: each highlight names the steps to stage it, the script crops and saves the result, and refuses a capture that shows the user's name in a path. A highlight without a picture falls back to its icon.
- Blocked on demo footage: the source footage behind the existing screenshots is gone, and the test fixtures are plain black clips. Record or license a small demo set first, keep it outside the repository, and note where it lives.

### 17. Play videos inside the grid

- Issue #32. A first-time user expected the large grid cards to play in place, so a decision could be made without leaving the grid. Today a card shows its frames and playback means opening Review.
- Not committed. The deliberate design is click-to-seek on frames (roadmap 2.2) with no hover-scrub. In-place playback would also add one more concurrent decode and storage reader per playing card, which conflicts with the contention described in item 1.
- If revisited: one card plays at a time, started by an explicit action, using the same player path and permission checks as Review.

### 18. Theater mode in Review

- Issue #32. Let the player grow to fill the window while the metadata and decision controls stay visible, without going full screen.
- Not committed. Review already sizes the media to the viewport (`getReviewMediaWidth`), so this is a layout option, not a new player.

### 19. Adjustable threshold for single-frame thumbnails

- Issue #32. Videos under 10 seconds get one thumbnail instead of the usual set, and the person cannot change that. Someone who works mainly with short clips would want the full set, or a different cut-off.
- The constant `SINGLE_THUMBNAIL_VIDEO_DURATION_SECS = 10` is declared three times (`electron/processor.js`, `electron/main.js`, `src/App.tsx`) and must be read from one setting if it becomes configurable. A copy left behind makes the expected thumbnail count disagree with what was generated.
- Changing it leaves existing thumbnails with the old count. Treat that like a thumbnail count change: regenerate only on request, never silently (roadmap 2.2 provenance rule).

### 20. ARM builds for Windows and Linux

- Not built today. The pinned FFmpeg toolchain covers `win32-x64`, `linux-x64`, `darwin-arm64` and `darwin-x64` (`config/ffmpeg-toolchain.json`), so Windows ARM and Linux ARM have no FFmpeg build, no `better-sqlite3` prebuild check and no release job.
- Viability and demand have not been recorded here. Measure demand from feedback first; each added platform adds a build in `VideoCull-FFmpeg`, a test target and a release job.

### 21. Flatpak and Flathub

- Issue #4 asks for a Flatpak. Linux releases ship an AppImage for any distribution and a .deb for Debian-based ones; a Flatpak would add a real installer and system-managed updates on Fedora, Linux Mint, Zorin, Pop!_OS and the Steam Deck, whose app stores are built on Flathub.
- Not committed. The AppImage and .deb already cover every distribution, so a Flatpak adds reach through the app stores, not new capability. Taken off the roadmap (it was Phase M.1 for `2.5.0`) until the beta builds have real feedback.
- Packaging: the simplest Flathub route repackages the released .deb (or a tarball) with a pinned checksum on the Electron base app (`org.electronjs.Electron2.BaseApp`), as many Electron apps on Flathub do. Nothing is rebuilt on Flathub's builders, and the bundled FFmpeg arrives inside the package with its corresponding source already published by `VideoCull-FFmpeg`. Confirm Flathub's current policy on repackaged binaries before submitting.
- App ID must map to a domain or account we control: `app.videocull.VideoCull` (videocull.app) or `io.github.StippieDot.VideoCull`.
- Every release then needs a version and checksum update in the Flathub repository; their external-data checker can open that pull request automatically.

What the sandbox changes:

| Needed by VideoCull | In the Flatpak sandbox | Required |
|---|---|---|
| Scan any folder, recent sessions, per-drive cache | The file-chooser portal hands out document-portal paths (`/run/user/<uid>/doc/...`), which break recent sessions, real-path checks and the per-drive cache | Broad access: `--filesystem=host`, or home plus `/media`, `/run/media` and `/mnt`. Flathub accepts this for media tools with a justification |
| Delete to Trash | Works with that filesystem access | Test on the home disk and on an external drive |
| Reveal in file manager | `shell.showItemInFolder` uses the file manager's DBus service | `--talk-name=org.freedesktop.FileManager1` |
| Sleep or shut down after processing | `electron/system-power.js` runs `systemctl`, which does not exist inside the sandbox | Code change: call logind over DBus, plus `--system-talk-name=org.freedesktop.login1` |
| Keep the computer awake | `powerSaveBlocker` goes through the desktop's inhibit service | Test |
| Hardware decoding (VAAPI) | The bundled FFmpeg ships its own `libva` and loads the system's drivers; the runtime provides drivers through its GL extension | `--device=dri`, then test; NVDEC needs the NVIDIA GL extension |
| Self-update | Updates come from the Flatpak remote | Code change: detect `FLATPAK_ID` and disable the in-app updater, as for the Microsoft Store edition |
| Settings and cache | Move to `~/.var/app/<app id>/` | Acceptable; no shared profile with an AppImage or .deb install |

Proposed direction:

- First the two code changes, since they are useful on their own: logind over DBus for sleep and shut down, and turning the updater off inside a sandbox.
- Then a local Flatpak build to test filesystem access, Trash, VAAPI and session restore on an external drive, on at least two distributions.
- Submit to Flathub only after that. The Linux notes in the README gain a Flatpak line when it ships.

## Recommended order

1. Add shared I/O-aware admission across media-analysis pipelines.
2. Reproduce the renderer media crash and inspect the captured local dump.
3. Reduce renderer and visual-duplicate peak memory for very large sessions.
4. Narrow high-volume IPC and cache payloads where measurements justify the contract work.
5. Persist duplicate results if repeated runs remain a significant workflow cost.
6. Address lower-priority resource bounds, duplicate matching, keeper, and maintenance improvements as demand justifies them.

## Resolved issues

These entries retain a compact audit trail for issues removed from the active backlog after verification.

| Issue | Former problem | Fixed |
| --- | --- | --- |
| Missing resumable processing pause | Metadata, thumbnail, exact-hash, fingerprint, and duplicate comparison work could only be cancelled, losing the active queue. | 20-09-2026 in `0ab12b2` |
| Unclear permanent-delete fallback | Recycle Bin failures showed only a count before offering irreversible deletion. | 20-09-2026 in `3aad992` |
| Field-aware visible-list invalidation | Small media updates unnecessarily rebuilt and resorted the full visible library. | 01-06-2026 in `38794fe` |
| Scan-progress throttling | Folder scans emitted a renderer progress update for every discovered video. | 01-06-2026 in `ba91332` |
| Slow work-queue removal | Hot processing loops repeatedly used `queue.shift()`, causing avoidable array reindexing. | 01-06-2026 in `ba91332` |
| One-at-a-time fingerprint queries | Duplicate startup fetched fingerprint rows with too many small database queries. | 01-06-2026 in `ba91332` |
| One-at-a-time metadata writes | Metadata results were committed one video at a time instead of in transactions. | 09-06-2026 in `f5edad9` |
| Heavy renderer media-batch updates | Metadata and thumbnail batches triggered unnecessary merging and full-view recomputation. | 01-06-2026 in `38794fe` |
| Repeated sidebar aggregate calculations | Sidebar totals and ranges repeatedly rescanned the full video library. | 09-06-2026 in `9fb111f` |
| Grid recomputation | Grid rows, groups, and selection lookups were rebuilt more often than necessary. | 09-06-2026 in `9fb111f` |
| Review-mode recomputation | Review mode used several passes to rebuild scope lookups and progress summaries. | 09-06-2026 in `9fb111f` |
| Unwindowed duplicate results | The duplicate screen rendered every result group and card at once. | 02-06-2026 in `8737000` |
| Orphan cache and fingerprint data | Renamed, moved, or removed videos could leave stale database and thumbnail records. | Added 16-06-2026 in `8431894`; made opt-in 17-06-2026 in `c715531` |
| Conservative scanner throughput | File stat work was largely serial and slowed scans of very large libraries. | 10-06-2026 in `c82deb9` |
| Module-level duplicate scroll state | Duplicate-list scroll position lived in fragile module-level state. | 01-06-2026 in `420015f` |
| Missing ignored-pairs management | Ignored duplicate pairs could only be restored during the short undo window. | 01-06-2026 in `0e709d0` |
