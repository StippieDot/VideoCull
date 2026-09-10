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
- Keep explicit numeric concurrency as an expert override and describe the setting as applying to media analysis, not only thumbnail FFmpeg processes.

An adaptive limit can provide best-effort headroom, but it cannot guarantee smooth playback in external players because VideoCull cannot observe their bitrate or buffering state. A manual pause is still required.

### 2. Metadata, thumbnail, and duplicate work cannot be paused and resumed

- VideoCull can cancel work, but it has no resumable pause control.
- Cancellation discards the active queue. It is not a practical way to temporarily release storage for VLC or another foreground task.
- Duplicate processing is mixed: exact hashing and fingerprint extraction read source videos, while the final pHash/visual comparison is primarily CPU and memory work.

Proposed direction:

- Add one visible **Pause processing / Resume processing** control near the existing sidebar progress UI.
- Stop assigning new metadata videos immediately and let already-running probes drain safely.
- Pause thumbnail work between frames or videos without discarding completed thumbnails.
- Pause duplicate exact reads and fingerprint extraction at safe checkpoints. Full-file hash streams should stop reading promptly rather than requiring a large file to finish first.
- If the control promises to pause all duplicate work, add cooperative checkpoints to the comparison worker as well.
- Show **Pausing...** until in-flight work has drained, then **Paused**.
- Preserve progress and resume each queue exactly once. Cancellation, rescanning, window shutdown, and quit must continue to work while paused.

### 3. Renderer media-pipeline crashes do not produce enough diagnostic evidence

- A development run recorded a renderer crash with Windows status `0x80000003` (`STATUS_BREAKPOINT`) while video playback and background metadata work overlapped.
- The main process was not out of memory, and the GPU process remained alive. The system-wide playback contention is proven, but it does not by itself prove the renderer crash's exact cause.
- VideoCull logs `render-process-gone` details and a post-crash diagnostic snapshot, but it does not start Electron crash reporting early enough to capture a local renderer dump.

Proposed direction:

- Start Electron crash reporting before renderer creation with uploads disabled.
- Store dumps locally in the configured crash directory and log the exact dump location.
- Reproduce after background I/O controls are available and inspect the dump before changing the media player or Chromium configuration.

## Medium

### 4. Permanent-delete fallback does not identify the affected files

- When moving files to the Recycle Bin fails, VideoCull asks whether the failed files should be permanently deleted.
- The warning shows only the number of failures, not the paths that would be permanently deleted.
- This makes an irreversible decision harder to verify and creates a data-loss risk.
- Show the affected paths, with a sensible preview and total count, before enabling permanent deletion. A renderer review screen would provide more room than the current native dialog.

### 5. Duplicate results are not persisted between launches

- Fingerprints and ignored pairs are cached, but completed duplicate groups exist only in renderer state.
- Closing VideoCull therefore loses the finished review result and requires another duplicate run.
- Persist duplicate-group results with enough source/settings identity to invalidate them safely when videos, fingerprints, or matching settings change.

## Low

### 6. Duplicate matching is weak for trimmed or offset copies

- The duplicate engine compares samples at corresponding relative positions and applies duration tolerance.
- It is effective for exact files, re-encodes, resized copies, and broadly aligned full-length videos, but it is not designed to align a trimmed excerpt with its longer source.
- Document this limitation explicitly. Treat sliding-window comparison or audio fingerprints as a future algorithm project rather than a small matching adjustment.

### 7. Suggested keeper rules do not account for source trust or file health

- Keeper selection can prioritize resolution, bitrate, duration, frame rate, and file size.
- It cannot prefer trusted source folders or account for structural file health, silent variants, or likely reframing when candidates are otherwise close.
- If real libraries need it, add optional reorderable soft rules such as source-path priority and metadata-based container health. Keep them disabled by default and do not let them change duplicate grouping.

### 8. Duplicate defaults and keeper ranking have manually synchronized copies

- Duplicate defaults exist in both the renderer settings layer and the CommonJS backend.
- Keeper comparison logic is also mirrored in renderer and backend code.
- Sync comments and separate tests reduce the immediate risk, but there is no single shared implementation or direct parity test.
- Prefer a shared side-effect-free module if it fits both build environments. Otherwise add an explicit parity test covering defaults and keeper ordering.

## Recommended order

1. Add shared I/O-aware admission and resumable processing pause.
2. Capture actionable renderer crash dumps and reproduce the media crash.
3. Improve permanent-delete review.
4. Persist duplicate results if repeated runs remain a significant workflow cost.
5. Address lower-priority duplicate matching, keeper, and maintenance improvements as demand justifies them.

## Resolved issues

These entries retain a compact audit trail for issues removed from the active backlog after verification.

| Issue | Former problem | Fixed |
| --- | --- | --- |
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
