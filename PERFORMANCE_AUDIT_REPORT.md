# VideoCull Performance Audit Report

[True] This review is based on direct source inspection of the current repository.

## Verdict Legend

- `[True]` = the statement is supported directly by the current code.
- `[Partially True/Overstated]` = the statement points at a real issue, but the severity, wording, or proposed fix is too broad.
- `[Partially True/Understated]` = the statement is directionally right, but the actual code suggests the issue may be narrower in wording or worse in one specific path.
- `[Not True/Not an issue]` = the statement is not supported by the current code, or is not a meaningful problem here.

## 1. Executive Summary

[Partially True/Overstated] The app is likely to get slow around very large libraries because it recomputes large renderer-side views, performs synchronous SQLite work in the main process, and moves large payloads across IPC. The overstated part is that all IPC channels are equally chatty; the real distinction is that `scan-progress` is too frequent, while metadata/thumbnail channels are already time-batched and are more expensive because of payload size plus renderer merge cost.

Top bottlenecks:
- `[True]` Eager full-library filtering, sorting, and many stats recomputations in [src/store.ts](src/store.ts#L38) and the mutators that call it.
- `[Partially True/Overstated]` Broad root subscriptions are a problem, but the heavier proven issue is repeated full-list aggregation in the subscribed components, especially [src/components/Sidebar.tsx](src/components/Sidebar.tsx#L302).
- `[Partially True/Overstated]` Per-file scan progress is definitely too chatty, but the ready-batch channels in [electron/main.js](electron/main.js#L1577) and [electron/main.js](electron/main.js#L1718) are already time-batched; their real issue is payload size and downstream merge cost.
- `[True]` Synchronous `better-sqlite3` reads and writes are on hot paths in [electron/cache.js](electron/cache.js#L307), [electron/cache.js](electron/cache.js#L474), and [electron/main.js](electron/main.js#L1609).
- `[Partially True/Understated]` Duplicate detection still loads fingerprint rows one video at a time and does expensive grouping/comparison work. This is real, and the visual worker is even more exposed than the original report suggests because it falls back to full pairwise comparison below a candidate threshold in [electron/visual-worker.js](electron/visual-worker.js#L99).

Biggest quick wins:
- `[True]` Throttle `scan-progress` and similar high-frequency progress IPC.
- `[True]` Replace `queue.shift()` in hot processor and duplicate backfill loops.
- `[Partially True/Overstated]` Memoize hot renderer components where it actually cuts rerenders; `VideoCard` memoization alone is not one of the top wins.
- `[Partially True/Overstated]` Split broad Zustand subscriptions, but only after reducing the heavier full-array recomputation paths.

Biggest architectural improvements:
- `[Partially True/Overstated]` Normalize the store and derive filtered/grouped views incrementally. This may help, but replacing stored `filteredVideos` with on-demand selectors is not automatically better if multiple subscribers each recompute the same full view.
- `[True]` Batch SQLite reads and writes by folder/chunk rather than one video at a time for duplicate fingerprint loading and metadata updates.
- `[Partially True/Overstated]` Reduce duplicate-detection candidate count before comparison starts. This is a valid direction, but it is the highest accuracy-risk change and should come after cheaper query-shape and payload fixes.

## 2. Performance Risk Map

| Area | Original risk | Verdict | Review note | Fix priority after review |
|---|---|---|---|---|
| Zustand derived state | Critical | `[True]` | `computeFiltered` and often `computeStats` are recomputed across many mutations in [src/store.ts](src/store.ts#L38), [src/store.ts](src/store.ts#L846), [src/store.ts](src/store.ts#L894), [src/store.ts](src/store.ts#L922), and [src/store.ts](src/store.ts#L1458). | P0 |
| Renderer subscriptions | High | `[Partially True/Overstated]` | Broad subscriptions exist, but they are not the clearest hotspot by themselves. Full-list scans inside subscribers are the stronger proven cost. | P2 |
| Sidebar aggregation | High | `[True]` | The sidebar performs repeated whole-array scans for ranges and counts in [src/components/Sidebar.tsx](src/components/Sidebar.tsx#L302), [src/components/Sidebar.tsx](src/components/Sidebar.tsx#L309), [src/components/Sidebar.tsx](src/components/Sidebar.tsx#L338), and [src/components/Sidebar.tsx](src/components/Sidebar.tsx#L374). | P1 |
| Duplicate pipeline | Critical | `[Partially True/Understated]` | The risk is real, and the current code is worse in one respect than the report states: the visual worker is fully pairwise below its bucket activation threshold in [electron/visual-worker.js](electron/visual-worker.js#L99). | P0 |
| IPC progress and payloads | High | `[Partially True/Overstated]` | `scan-progress` is too frequent at [electron/main.js](electron/main.js#L1429). Metadata/thumbnail channels are already batched; their problem is payload size and renderer merge work. | P1 |
| SQLite/cache sync work | High | `[True]` | Synchronous DB work is on real hot paths, especially metadata completion and duplicate fingerprint loading. | P1 |
| Scanner and processor loops | High | `[Partially True/Overstated]` | `queue.shift()` is a clear problem. The serial scan path is real but not yet shown to dominate over renderer/store churn. | P1 |
| Duplicate view rendering | Medium | `[True]` | [src/components/DuplicateGroupsView.tsx](src/components/DuplicateGroupsView.tsx#L72) is unwindowed and can produce a large DOM. | P2 |

## 3. Reviewed Bottlenecks

### `[True]` Eager full-library derived state in Zustand

- `[True]` `computeFiltered` copies, filters, and sorts the entire `videos` array in [src/store.ts](src/store.ts#L38).
- `[True]` It is recomputed from many mutators, including `setVideos`, `updateVideoThumbnailsBatch`, `setVideoStatus`, `setVideoRating`, `toggleFavorite`, `setDuplicateGroups`, `applyDuplicateResult`, and all filter/sort setters in [src/store.ts](src/store.ts#L846), [src/store.ts](src/store.ts#L894), [src/store.ts](src/store.ts#L922), [src/store.ts](src/store.ts#L978), [src/store.ts](src/store.ts#L992), [src/store.ts](src/store.ts#L1139), [src/store.ts](src/store.ts#L1154), and [src/store.ts](src/store.ts#L1028).
- `[True]` This means small updates can force a whole-library rebuild and sort on the renderer thread.
- `[Partially True/Overstated]` "Derive on demand with memoized selectors" is not automatically the right fix. If multiple subscribers ask for the same derived view, on-demand derivation can multiply the same work.
- `[True]` What actually needs fixing first: avoid recomputing `computeFiltered` when an update does not affect active filters/sort, and move stable aggregates into cheaper cached fields/selectors.

### `[Partially True/Overstated]` Broad root subscriptions in the renderer

- `[True]` `App` subscribes to many store slices in [src/App.tsx](src/App.tsx#L60).
- `[Partially True/Overstated]` The statement that this is a top P0 bottleneck is stronger than the code evidence supports. The bigger proven issue is the amount of O(n) work triggered inside update handlers and downstream components.
- `[True]` The media batch handler builds a fresh `Map` from all videos on each metadata/thumb batch in [src/App.tsx](src/App.tsx#L544), then calls `updateVideoThumbnailsBatch`, which itself rebuilds indexes and recomputes `filteredVideos`.
- `[True]` What actually needs fixing first: reduce full-array batch merge work before spending time splitting the shell into smaller subscribers.

### `[True]` Sidebar performs repeated O(n) scans

- `[True]` `sizeRange` scans all `videos` in [src/components/Sidebar.tsx](src/components/Sidebar.tsx#L302).
- `[True]` `durationRange` scans all `videos` in [src/components/Sidebar.tsx](src/components/Sidebar.tsx#L309).
- `[True]` Duplicate and incompatible counts rescan `videos` in [src/components/Sidebar.tsx](src/components/Sidebar.tsx#L338), [src/components/Sidebar.tsx](src/components/Sidebar.tsx#L374), and [src/components/Sidebar.tsx](src/components/Sidebar.tsx#L375).
- `[True]` These are recomputed whenever the component rerenders, so ordinary status, metadata, and progress-driven updates can repay several full-list passes.
- `[True]` The recommended fix stands: move these aggregates into cached selectors or store-maintained summary fields.

### `[Partially True/Overstated]` Grid mode rebuilds row structure on each meaningful change

- `[True]` `GridMode` derives folder sizes, groups, rows, and selection helpers from the full filtered set in [src/components/GridMode.tsx](src/components/GridMode.tsx#L214), [src/components/GridMode.tsx](src/components/GridMode.tsx#L223), and nearby code.
- `[True]` Virtualization only helps the DOM/rendered rows; it does not avoid rebuilding the row model from the full filtered list.
- `[Partially True/Overstated]` "Memoize `VideoCard`" is not the best first fix. `VideoCard` only exists for mounted rows, while the heavier current cost is row-model reconstruction plus store recomputation upstream.
- `[True]` What actually needs fixing first: reduce parent recomputation and store invalidation before micro-optimizing viewport card rerenders.

### `[True]` Review mode recomputes scope and summary passes

- `[True]` `ReviewMode` rebuilds a `Map` over all videos in [src/components/ReviewMode.tsx](src/components/ReviewMode.tsx#L69).
- `[True]` It computes summary/progress with multiple full passes over `reviewVideos` in [src/components/ReviewMode.tsx](src/components/ReviewMode.tsx#L76) and [src/components/ReviewMode.tsx](src/components/ReviewMode.tsx#L84).
- `[Partially True/Overstated]` This is a real cost, but it is lower priority than store recomputation, sidebar aggregation, and duplicate query shape.

### `[True]` Duplicate groups view lacks windowing and repeats group metrics

- `[True]` `DuplicateGroupsView` filters and sorts all groups in [src/components/DuplicateGroupsView.tsx](src/components/DuplicateGroupsView.tsx#L91).
- `[True]` It recalculates best flags per group during render and renders every group/card in gallery mode.
- `[True]` This is a real DOM scaling risk for large duplicate result sets.
- `[True]` Windowing the duplicate list/cards is justified by the current code.

### `[Partially True/Overstated]` Scan progress and ready batches are too chatty

- `[True]` Scan progress is emitted per discovered file via [electron/scanner.js](electron/scanner.js#L70) and forwarded immediately in [electron/main.js](electron/main.js#L1429).
- `[Partially True/Overstated]` Metadata and thumbnail ready channels are not equally chatty by frequency. They are flushed once per second in [electron/main.js](electron/main.js#L1577) and [electron/main.js](electron/main.js#L1718).
- `[True]` Those channels are still expensive because they ship arrays of full update objects and trigger renderer-side full-array merge work.
- `[True]` The right fix is: throttle `scan-progress`, then shrink payloads and batch-merge cost for metadata/thumb updates.

### `[True]` Main process does synchronous SQLite work in hot callbacks

- `[True]` `loadCacheVideos` reads whole tables synchronously in [electron/cache.js](electron/cache.js#L307).
- `[True]` Metadata completion performs one synchronous `UPDATE` per video in [electron/main.js](electron/main.js#L1609) using [electron/cache.js](electron/cache.js#L474).
- `[True]` Duplicate fingerprint row loading is synchronous and query-shaped badly.
- `[True]` The recommendation to batch/narrow DB work is justified.

### `[Partially True/Overstated]` Scanner and processor loops have avoidable serial overhead

- `[True]` Both thumbnail and metadata processors dequeue with `queue.shift()` in [electron/processor.js](electron/processor.js#L422) and [electron/processor.js](electron/processor.js#L476).
- `[True]` Duplicate fingerprint backfill also uses `queue.shift()` in [electron/duplicates.js](electron/duplicates.js#L284).
- `[True]` The scanner walks directories and stats files serially in [electron/scanner.js](electron/scanner.js#L30) and [electron/scanner.js](electron/scanner.js#L49).
- `[Partially True/Overstated]` The queue issue is a concrete quick win. The broader “scan is serial in the wrong places” claim is plausible, but the code alone does not prove it is a bigger cost than renderer/store churn.

### `[Partially True/Understated]` Duplicate detection still has large pairwise and data-transfer costs

- `[True]` `loadAllPHashes` and `loadAllGrayRows` call per-video row loaders in [electron/duplicates.js](electron/duplicates.js#L334) and [electron/duplicates.js](electron/duplicates.js#L344), backed by [electron/cache.js](electron/cache.js#L742) and [electron/cache.js](electron/cache.js#L769).
- `[True]` The daisy-chain/group validation code is potentially expensive in [electron/duplicates.js](electron/duplicates.js#L476), [electron/duplicates.js](electron/duplicates.js#L510), and [electron/duplicates.js](electron/duplicates.js#L536).
- `[Partially True/Understated]` The report undersells one worker path: the visual worker does a full pairwise loop when candidate count is below `BUCKET_ACTIVATION_THRESHOLD` in [electron/visual-worker.js](electron/visual-worker.js#L99) and [electron/visual-worker.js](electron/visual-worker.js#L122).
- `[Partially True/Overstated]` “Shrink candidate sets earlier” is a valid long-term idea, but query batching and payload reduction are safer first fixes.

## 4. React/Zustand Findings

- `[Partially True/Overstated]` “The biggest React problem is derived-state placement” is close, but the precise problem is not merely where `filteredVideos` lives. The real issue is how often the whole-library derivation is invalidated in [src/store.ts](src/store.ts#L846) through [src/store.ts](src/store.ts#L1458).
- `[True]` The `thumb-ready-batch` / `metadata-ready-batch` path in [src/App.tsx](src/App.tsx#L544) builds a fresh `Map` of all videos and then calls a store mutator that recomputes `filteredVideos`.
- `[True]` `Sidebar` does too much live aggregation from `videos`.
- `[True]` `GridMode` still reconstructs a full row model even though the DOM is virtualized.
- `[True]` `ReviewMode` performs several passes over review scope data, but this is a lower-priority optimization target.

## 5. Electron/IPC Findings

- `[True]` `scan-progress` is an IPC storm candidate because it fires once per discovered file.
- `[Partially True/Overstated]` The metadata and thumbnail channels are not primarily a frequency problem; they are already interval-batched. Their real issue is payload shape plus renderer-side merge/recompute cost.
- `[True]` `findDuplicates` receives the entire current scope from the renderer in [src/App.tsx](src/App.tsx#L213) and [src/App.tsx](src/App.tsx#L369), which means large structured-clone payloads before work even starts.
- `[Partially True/Overstated]` The preload layer is not the problem by itself. It amplifies bursts because it forwards events directly into state updates, but the upstream event volume and downstream merge cost are the bigger issues.

## 6. SQLite/Cache Findings

- `[True]` The cache load path is linear in rows and thumbnails because it reads the full `videos` and `thumbnails` tables in [electron/cache.js](electron/cache.js#L307).
- `[True]` `loadPHashRows` and `loadGraySampleRows` issue one query per video in [electron/cache.js](electron/cache.js#L742) and [electron/cache.js](electron/cache.js#L769).
- `[True]` `getFingerprintCounts` is already chunked, which makes the report’s contrast here correct.
- `[True]` Metadata completion still performs synchronous point updates one video at a time.
- `[Partially True/Overstated]` The indexes do not appear to be the main immediate issue; query count and point-update frequency are the stronger current findings.

## 7. Scanner/Thumbnail Pipeline Findings

- `[Partially True/Overstated]` The scanner is serial in several places, but the code alone does not prove this is one of the top two bottlenecks overall.
- `[True]` `queue.shift()` in processor loops is a concrete algorithmic inefficiency and should be fixed.
- `[Partially True/Overstated]` The thumbnail pipeline is not broadly “sequential”; it does run with bounded concurrency in [electron/processor.js](electron/processor.js#L414). The remaining issue is the queue structure, callback/update cost, and per-video cache writes.

## 8. Duplicate Detection Performance Findings

- `[Partially True/Understated]` This subsystem is a real top scaling risk, and one path is worse than the original report says because the visual worker is fully pairwise below 5,000 candidates.
- `[True]` The main process does too much work before workers start, especially one-query-per-video fingerprint loading.
- `[True]` The group-pruning logic can become expensive in dense clusters.
- `[Partially True/Overstated]` “The current guards are not enough for 21k to 50k videos” is plausible but still unmeasured from source inspection alone.

## 9. Recommended Optimization Plan

### Phase 1 - Low-risk quick wins

- `[True]` Throttle scan progress to time-based or chunk-based updates.
- `[True]` Replace `queue.shift()` in processor and duplicate-backfill loops with index-based cursors.
- `[True]` Stop recomputing `computeFiltered` for metadata/thumb patches when the active filters/sort do not depend on changed fields.
- `[True]` Move sidebar aggregate counts/ranges into cached selectors or maintained summary fields.
- `[Partially True/Overstated]` Memoize `VideoCard` if profiling still shows viewport rerender pressure after upstream fixes.
- `[Partially True/Overstated]` Split broad Zustand subscriptions after reducing heavier full-array invalidation paths first.
- `[True]` Add render-count and timing instrumentation around sidebar, grid, batch merge, and duplicate flows.

### Phase 2 - Medium changes

- `[True]` Batch `loadPHashRows` and `loadGraySampleRows` with `IN (...)` queries rather than one query per video.
- `[True]` Reduce renderer merge cost in the `applyMediaBatch` path in [src/App.tsx](src/App.tsx#L544) and [src/store.ts](src/store.ts#L856).
- `[True]` Add windowing to duplicate groups and gallery cards.
- `[True]` Reduce IPC payload shape where safe, especially duplicate startup payloads and ready-batch fields that the renderer can recover locally.
- `[Partially True/Overstated]` Split the renderer into smaller store subscribers only if profiling still shows broad rerender fan-out after the earlier fixes.

### Phase 3 - Larger architectural improvements

- `[Partially True/Overstated]` Normalize the video store and derive filtered/grouped views incrementally. This may help, but it is a larger refactor and not the safest first answer.
- `[Partially True/Overstated]` Rework duplicate candidate loading so worker inputs are smaller and more selective. Valid direction, but accuracy-sensitive.
- `[Partially True/Overstated]` Add a cache layer for precomputed library summaries and folder indexes. Useful if profiling still shows summary recomputation after easier fixes.
- `[Partially True/Overstated]` Make scan and metadata progress backpressure-aware. The more immediate need is simply to stop per-file scan updates and reduce batch merge cost.

## 10. No Concessions Guardrails

| Proposed optimization | Verdict | Review note |
|---|---|---|
| Throttle progress events | `[True]` | Safe as long as progress remains informative. |
| Memoize selectors and split subscriptions | `[True]` | Safe if selector invalidation remains correct. |
| Window duplicate views | `[True]` | Safe and justified by current code. |
| Batch SQLite reads/writes | `[True]` | Safe if transactional boundaries remain correct. |
| Shrink duplicate candidate sets earlier | `[Partially True/Overstated]` | This is the clearest duplicate-accuracy risk, but it is not the only way correctness could regress. Store invalidation mistakes can also break UI behavior. |

- `[Partially True/Overstated]` “The only optimization class that can meaningfully affect duplicate accuracy is candidate pruning” is too strong. It is the most obvious accuracy-sensitive optimization, but not the only correctness-sensitive area.

## 11. Benchmark Plan

[True] This is a sensible benchmark plan. It is planning guidance rather than a code-truth claim, but the proposed measurements align with the current hotspots.

| Dataset | What to measure | Acceptable threshold | Where to instrument |
|---|---|---|---|
| 1,000 videos | Initial load time, first progress, scroll responsiveness | First progress under 500 ms, no task over 16 ms on normal UI actions | React Profiler, `performance.mark`, scan progress timing |
| 10,000 videos | Scan wall time, sidebar update latency, thumbnail batch render cost | No main-thread stall over 50 ms during routine updates | Electron performance marks, render count logging, IPC timing |
| 21,000 videos | Full scan responsiveness, filter/sort latency, duplicate start latency | UI input latency under 100 ms, duplicate progress visible within 1 s | Main-process timers, React Profiler, IPC payload logging |
| 50,000 videos | Stability under sustained scanning and duplicate detection | No single batch, query, or render slice over 250 ms; UI remains interactive | Long-run profiling, event-loop lag checks, SQLite timing |

Compare before and after:
- `[True]` Time to first scan progress.
- `[True]` Main-thread long tasks.
- `[True]` Number and size of IPC payloads.
- `[True]` React commit duration for sidebar, grid, duplicate view, and media-batch merge paths.
- `[True]` SQLite query count and total time.
- `[True]` Duplicate worker input size and comparison count.

## 12. Suggested Tests

- `[True]` Render-performance benchmark for [src/components/GridMode.tsx](src/components/GridMode.tsx), [src/components/Sidebar.tsx](src/components/Sidebar.tsx), and [src/components/DuplicateGroupsView.tsx](src/components/DuplicateGroupsView.tsx) with a synthetic 21k-video store.
- `[True]` Store action benchmark for `setVideos`, `updateVideoThumbnailsBatch`, `setVideoStatus`, and `updateSettings` in [src/store.ts](src/store.ts).
- `[True]` Scan benchmark for the recursive traversal in [electron/scanner.js](electron/scanner.js).
- `[True]` Cache load/save benchmark for [electron/cache.js](electron/cache.js).
- `[True]` Thumbnail and metadata batch-merge benchmark for the `thumb-ready-batch` / `metadata-ready-batch` path in [electron/main.js](electron/main.js) and [src/App.tsx](src/App.tsx#L544).
- `[True]` IPC payload-size test for `scan-progress`, `findDuplicates`, and ready-batch channels.
- `[True]` Duplicate detection benchmark for dense buckets, unknown-duration videos, visual-worker sub-5k candidate behavior, and large cluster pruning.
- `[True]` Large folder-grouping benchmark for [src/components/GridMode.tsx](src/components/GridMode.tsx) and [src/components/DuplicateGroupsView.tsx](src/components/DuplicateGroupsView.tsx).

## 13. Final Prioritized Checklist

1. `[True]` Throttle `scan-progress` immediately.
2. `[True]` Replace `queue.shift()` in processor and duplicate-backfill scheduling.
3. `[True]` Reduce `computeFiltered` invalidation frequency, especially for metadata/thumb patches.
4. `[True]` Move sidebar aggregate scans out of render-time whole-library passes.
5. `[True]` Batch duplicate fingerprint row loading and reduce synchronous point-query count.
6. `[True]` Reduce media batch merge cost and payload shape for metadata/thumb updates.
7. `[True]` Window duplicate views and reduce repeated per-group metrics.
8. `[Partially True/Overstated]` Split subscriptions and memoize hot components after the higher-value recomputation fixes.
9. `[Partially True/Overstated]` Change duplicate candidate semantics only after profiling and regression coverage.
