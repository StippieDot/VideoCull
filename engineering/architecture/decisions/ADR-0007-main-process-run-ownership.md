# ADR-0007: Main process owns processing runs and session invalidation in one place

- **Status:** Accepted, 2026-10-15. Not yet implemented.
- **Related:** [ADR-0001](ADR-0001-change-boundaries-only-with-feature-work.md), [ADR-0005](ADR-0005-processing-outside-react-with-per-run-cancellation.md), [ADR-0006](ADR-0006-plain-function-backend-modules.md); roadmap 2.1 (`library-registry`, delete), 4.1 (`processing-scheduler`), 6.1 (file-operation preflight)

## Context (verified at `1dcc13f`)

Main tracks running work in three separate places:

- `scanGeneration` guards `scan-directory` through `assertScanCurrent`.
- Module-level tokens `thumbToken` and `metadataToken` in `processor.js` are cancelled by `cancelProcessing()`, which also lifts a user's pause.
- `activeDuplicateRun` is a run object with its own worker, child processes and `cancel()`. Cancelling it only wakes a pause; it does not lift it.

"Invalidate the session" is written out by hand in four handlers in `main.js`, each with a different subset:

| Site | Bumps generation | `cancelProcessing` | Cancels duplicate run | Clears duplicate session cache |
|---|---|---|---|---|
| shutdown `prepare` (~663) | yes | yes | yes | — |
| `reset-loaded-directories` (~1792) | yes | yes | yes | yes |
| `clear-cache` (~2661) | yes | yes | yes | yes |
| `migrate-cache-settings` (~2918) | yes | yes | yes | yes |

The duplicate run used to be cancelled only at shutdown. Reset, clear and migration now call the shared `cancelActiveDuplicateRun`, and a duplicate run also stops when the cache refuses its writes. Each site still lists the other reset steps by hand, and they can drift again.

Effects:

- A pause is lifted by `cancelProcessing()`, which the sites that throw the whole session away call. `cancelActiveDuplicateRun` only cancels, so a targeted cancel cannot undo a pause.
- Handlers wrap themselves in `trackWork` / `trackCacheProducer` / `isQuitting` checks by hand. `scan-directory` and `find-duplicates` write to the cache but are not drained at shutdown.
- Main relies on the renderer calling `cancelDuplicateDetection` before a rescan. Rescan's `ensureFolder` reopens blocked scopes, so this ordering is guaranteed by the renderer only.
- A chosen "sleep or shut down when finished" is cancelled when a folder is opened or closed (`store.setDirectory`) but not by clear cache or cache migration.
- On `render-process-gone` and `unresponsive`, main only writes a log entry. Runs, the keep-awake request and any chosen finish action continue, with progress going to a window that no longer knows about them.
- Roadmap 2.1 and 6.1 both need to act on "the processing run touching these files" before a destructive step. No single place can say which runs touch a file.

## Decision

Main gets one owner for running work: a small `@ts-check` module of plain functions ([ADR-0006](ADR-0006-plain-function-backend-modules.md)), called the *run owner* here. IPC handlers stay registered in `main.js` ([ADR-0002](ADR-0002-preload-bridge-and-central-ipc-registration.md)), and pipelines keep their own per-run cancellation ([ADR-0005](ADR-0005-processing-outside-react-with-per-run-cancellation.md)). The run owner only knows which runs exist, which folders and files they cover, and how to cancel them.

1. **Registration.** Each pipeline run (scan, metadata, thumbnails, duplicates) registers itself with its kind, the folders it covers, and its cancel function. The run owner replaces the hand-mixed `trackWork` / `trackCacheProducer` / `isQuitting` combinations and provides the shutdown drain.
2. **One reset.** `invalidateSession()` is the only way a session is thrown away. It is used by: opening or closing a folder (`reset-loaded-directories`), clear cache, cache migration, shutdown, and renderer crash or reload. It cancels every run, bumps the generation, **lifts a user's pause**, **cancels a chosen sleep or shutdown**, and resets the loaded-folder state held by `library-registry`, so the two cannot get out of step.
3. **Targeted cancellation never resets.** `cancelRunsTouching(paths)` and the skip described below never lift a pause and never cancel a finish action.
4. **Delete, rename and move while work runs.** Only the affected videos are excluded. Queued items for those files are skipped, and everything else keeps running. The operation waits up to about 10 seconds for items already in progress. If they are still busy it reports `in-use` for those files and leaves them alone, which matches roadmap 2.1's `in-use` result and its Retry. Runs are not cancelled as a whole.
5. **Renderer crash or reload.** Main calls `invalidateSession()` on `render-process-gone` and on a reload of an already loaded page. Nothing else changes: the window is not restarted, no message is shown, and no folders are reopened. Those belong to a later "pick up where you left off" feature. The run owner is built so that adding them does not require changing it.
6. **Scheduling comes later.** Concurrency limits stay where they are until roadmap 4.1. The `processing-scheduler` is expected to ask the run owner for the runs it manages, and registration does not need to change for that.

### Sequencing

- The run owner is built early in roadmap 2.1, after `library-registry` and before `file-ops-delete`.
- The confirmed defect (duplicate detection continuing after a cache migration) did not wait for this. It was fixed together with three related problems, none of which depended on the run owner: the duplicate-detection FFmpeg calls now go through `media-process` (timeout and output cap), the JSON writes in `main.js` are atomic, and pending review saves are no longer lost silently on a folder switch or at quit.

## Rationale

- One place can answer "which runs touch these files?", which delete (2.1) and rename and move (6.1) need.
- Shutdown and reset ordering become testable with fake runs, without starting Electron. No unit test loads `main.js` today.
- Targeted skipping keeps a small delete from restarting a long thumbnail run, and it avoids a new rule that refuses deletes while anything is processing.
- Keeping pause and finish-action handling inside the single reset removes the current inconsistency between pipelines.

## Consequences and trade-offs

- **Roadmap wording.** Roadmap 2.1 ("the processing run touching those files is cancelled") and 6.1 preflight ("cancel the processing run touching the video") describe cancelling whole runs. This decision replaces that with skip-and-wait. The roadmap has not been edited; the wording is to be updated when work on 2.1 starts.
- **Roadmap rule.** The roadmap keeps pipeline handlers in `main.js` until a feature rewrites them. That stays true: only the run bookkeeping moves out.
- The pipelines need a way to skip given files and to report which files are in progress. This is new code in `processor.js` and `duplicates.js`.
- A reset also cancels a chosen sleep or shutdown after clear cache or migration. The user chooses it again once the rebuild is running. This is accepted in exchange for one rule: a finish choice belongs to the run it was set for.
- The design must stay consistent with `library-registry` (2.1) and `processing-scheduler` (4.1) so the three modules do not overlap.
- While the renderer has no restart or reopen behaviour, a crashed window stays blank, as today.

## Alternatives considered

- **Patch each site only.** Cheapest, and the drift can return. Kept for the confirmed defect, not as the whole answer.
- **One shared cancel function inside `main.js`.** Fixes the drift but cannot answer which runs touch which files.
- **Extract the whole pipeline handlers now.** Rejected as churn ([ADR-0001](ADR-0001-change-boundaries-only-with-feature-work.md)).
- **Fold run tracking into `processing-scheduler` (4.1).** Rejected for now: 2.1 needs the capability earlier, and scheduling can be added on top later.
- **Cancel every overlapping run for a delete.** Rejected: a small delete would restart a long run.
- **Refuse deletes while a run touches the files.** Rejected: processing is often running, so it would be a new restriction.
