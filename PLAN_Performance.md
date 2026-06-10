# Performance Optimization Plan, Final Revision

## Summary

Optimize the current architecture in small, measured steps. The highest-value changes come first: measure, reduce event flooding, remove avoidable queue overhead, then cut unnecessary whole-library recomputation. Keep correctness-first guardrails throughout.

Implementation status as of 2026-06-09:
- Phase 0: instrumentation landed; baseline 21k-library run still required to mark complete under this plan
- Phase 1: implemented
- Phase 2A: implemented
- Phase 2B: implemented
- Phase 3: implemented (`3.1` sidebar aggregate caching, `3.2` GridMode row/selection cost reductions, `3.3` ReviewMode scope-summary caching, `3.4` media-batch merge optimization)
- Phase 4: implemented (`4.1` duplicate fingerprint DB reads use chunked `IN (...)` loads, `4.2` metadata writes are batched transactionally, `4.3` duplicate worker pHash payload is slimmer, `4.4` scan startup now loads only relevant cache rows per owner folder)
- Phase 5: implemented (`5.1` duplicate results are already windowed through virtual rows in both row and gallery layouts; `5.2` scanner file-stat batching is implemented conservatively)

Guardrails:
- Do not normalize the store in this pass.
- Do not replace the public store shape in this pass.
- Do not change duplicate matching semantics in this pass.
- Do not change component contracts unless a measured hotspot requires it.
- For invalidation logic: if it is unclear whether a change can affect the current view, recompute as before.

## Phase 0: Baseline Measurement

Add instrumentation before behavior changes.

Measure:
- `scan-progress` event count per scan
- `scan-progress` payload size
- renderer commit behavior during scan
- `computeFiltered` call count and total time
- `computeStats` call count and total time
- `updateVideoThumbnailsBatch` call count and total time
- `applyMediaBatch` per-batch and total time
- Sidebar render count and render time
- duplicate startup total time
- duplicate fingerprint query count and total DB time
- renderer long-task observations or React Profiler commits

Phase 0 is complete only after one baseline run on the 21k-video library captures all of the above.

## Phase 1: Safe Mechanical Wins

1. Throttle `scan-progress`.
- Change per-file progress emission to time-based or chunk-based updates.
- Keep progress smooth and informative.

2. Replace `queue.shift()` in hot loops.
- Apply to thumbnail processing.
- Apply to metadata processing.
- Apply to duplicate fingerprint backfill.
- Use index-based cursors.

3. Add dev-only counters around media batch handling.
- Keep payload shape unchanged in this phase.
- Use counters to distinguish merge cost from structured-clone cost.

4. Memoize viewport components only if measured.
- Only memoize `VideoCard` if props are stable or can be stabilized cheaply.
- Do not treat this as a default first-pass fix.

## Phase 2A: Field-Aware Invalidation

Reduce unnecessary `filteredVideos` rebuilds without changing store structure.

Add helper logic such as:
- `changeAffectsCurrentView(changedFields, state)`

Rules:
- Thumbnail-only changes:
  - normally patch video data only
  - do not rebuild `filteredVideos` unless a current view depends on thumbnail presence/count
- Duration changes:
  - rebuild when duration filter or duration sort is active
  - otherwise patch only
- Size changes:
  - rebuild when size filter or size sort is active
  - otherwise patch only
- Metadata date changes:
  - rebuild when `sortBy === "date"` or any active filter/grouping logic depends on `metadataDate` or fallback `date`
  - otherwise patch only
- Rating changes:
  - rebuild when rating filter or rating sort is active
  - otherwise patch only
- Favorite changes:
  - rebuild when favorites filter is active
  - otherwise patch only
- Compatibility changes:
  - rebuild when incompatible filter or compatibility-dependent view logic is active
  - otherwise patch only
- Status changes:
  - always update stats and the changed video objects
  - rebuild `filteredVideos` when `statusFilter !== "all"` or when current sort/group/view logic depends on status
  - if `statusFilter === "all"` and order/grouping does not depend on status, preserve current `filteredVideos` ID order and patch changed video data only
- Duplicate field/group changes:
  - rebuild when duplicate filter, duplicate-mode view, or duplicate-derived ordering/grouping depends on them
  - otherwise patch only

Rules:
- If unsure, recompute as before.
- Do not introduce selector architecture changes yet.
- Preserve current visible ordering whenever a patch-only path is chosen.

## Phase 2B: Subscription Cleanup

After 2A is correct, reduce rerender fan-out.

- Narrow broad subscriptions in the hottest surfaces.
- Move broad state reads out of components that do not need them.
- Memoize only where profiling still shows rerender pressure after 2A.
- Keep this separate from aggregate caching.

## Phase 3: Aggregates and View-Model Cost

1. Sidebar aggregate caching.
- Cache or maintain size range, duration range, duplicate count, incompatible count, and similar totals.
- Stop recomputing them from the full library inside render.

2. GridMode row/group rebuild reduction.
- Reduce repeated folder/group/row reconstruction cost.
- Reduce repeated selection-related full-list scans where possible.
- Preserve virtualization behavior and UX.

3. ReviewMode recomputation reduction.
- Reduce repeated all-video map rebuilds.
- Reduce repeated review-scope summary/progress passes.
- Keep behavior unchanged.

4. Media batch merge optimization.
- First optimize renderer merge cost with the current payload shape.
- Only slim metadata/thumb payload fields if measurement proves serialization/cloning is material.

## Phase 4: Main Process and Cache Improvements

1. Batch duplicate fingerprint reads.
- Replace one-query-per-video pHash loads with chunked `IN (...)` queries.
- Replace one-query-per-video gray-sample loads with chunked `IN (...)` queries.
- Keep duplicate results identical.

2. Batch metadata writes transactionally.
- Replace one-row-at-a-time metadata completion updates where correctness allows.
- Preserve failure tracking and retry behavior.

3. Reduce duplicate worker payload size where safe.
- Remove redundant fields first.
- Keep duplicate semantics unchanged.

4. Explicit cache-load-path review.
- Measure whether full-table cache loading remains a significant startup cost after earlier phases.
- Optimize only if still material.

## Phase 5: Lower-ROI or Context-Specific Fixes

1. Window duplicate results.
- Apply visible-only rendering to duplicate groups/cards.
- Preserve selection, dismiss, play, and scroll behavior.

2. Conservative scanner throughput improvements.
- Improve traversal throughput without changing file discovery behavior.
- Avoid aggressive concurrency unless profiling proves it is beneficial.

## Deferred on Purpose

- full normalized-store redesign
- duplicate candidate-pruning or threshold/comparison semantic changes
- major duplicate worker algorithm rewrite
- preload redesign unless earlier phases prove event fan-out is still a primary bottleneck

## Test Plan

Invalidation correctness tests:
- thumbnail update should not rebuild filtered/sorted list when sorting by name
- duration update should rebuild when sorting/filtering by duration
- size update should rebuild when sorting/filtering by size
- metadata date update should rebuild when sorting by date
- rating update should rebuild when rating filter or rating sort is active
- favorite update should rebuild when favorites filter is active
- compatibility update should rebuild when incompatible filter is active
- status update should rebuild when `statusFilter !== "all"`
- status update should not rebuild full `filteredVideos` when `statusFilter === "all"` and order/grouping is status-independent
- status update should still update stats and visible card data in patch-only mode
- duplicate field changes should rebuild only when duplicate-driven filters/views require it

Behavior/integration tests:
- scan still finds the same files before/after throttling
- queue refactor does not change thumbnail or metadata completion results
- sidebar counts/ranges stay correct under live updates
- GridMode grouping, selection, and scrolling remain correct
- ReviewMode navigation, summary, and playback remain correct
- duplicate results remain unchanged after batched DB reads and safer payload reductions
- duplicate results UI remains usable after windowing

Performance acceptance checks:
- lower `scan-progress` event count
- lower `computeFiltered` call count/time
- lower media batch merge cost
- lower duplicate startup DB query count/time
- improved responsiveness on the 21k-video baseline scenario

## Assumptions

- This round optimizes the current architecture rather than replacing it.
- Correctness takes precedence over avoiding recomputation; fallback is always “recompute as before.”
- Duplicate matching behavior must remain stable in this round.
- Payload slimming is conditional on measurement; merge optimization comes first.
