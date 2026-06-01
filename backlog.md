# Backlog

This file is the consolidated backlog for the issues that are still real and still open from the earlier audit, verification, and code review documents.

It is written so the old report files can be deleted without losing the useful remaining work.

Only issues that are still relevant are listed here. Proven false positives and items that are already fixed are intentionally left out.

For each issue below:
- **Fully fixed by the performance audit plan?** means whether completing the plan in [PERFORMANCE_AUDIT_REPORT.md](PERFORMANCE_AUDIT_REPORT.md) should fully resolve that issue.
- `Yes` = the plan should fully resolve it.
- `Partly` = the plan helps, but extra follow-up work is still needed.
- `No` = this issue sits outside the performance plan and needs separate work.

## Critical

### 1. Permanent delete fallback is too risky
- **What the issue is**
  - When the app cannot move files to the Recycle Bin, it asks whether the files should be permanently deleted instead.
  - Right now, the warning only shows how many files failed, not which files they are.
  - In plain language: the app may ask "do you want to destroy these files forever?" without clearly showing which files it means.
- **Why this matters**
  - A user could accidentally permanently delete the wrong files.
  - This is a real data-loss risk.
- **Proposed fix**
  - Show the first few failed file paths in the warning dialog.
  - If possible, move this decision into the renderer UI so the user gets a clearer review screen instead of a sudden native dialog.
- **Worth implementing?**
  - **Yes, definitely.**
  - This is a small fix with high safety value.
- **Fully fixed by the performance audit plan?**
  - **No.**
  - This is a safety/UX fix, not part of the performance plan.

## High

### 2. The app rebuilds the full visible video list too often
- **What the issue is**
  - Many small changes, like metadata or thumbnail updates, cause the app to rebuild and re-sort the full visible library.
  - In plain language: the app keeps reorganizing the whole shelf when only one book changed.
- **Why this matters**
  - This is one of the biggest reasons the app can feel slow with large libraries.
  - It affects scrolling, filtering, and general responsiveness.
- **Proposed fix**
  - Add field-aware invalidation rules.
  - Only rebuild the full visible list when the changed field actually affects the current filter, sort, or grouping.
  - Otherwise, patch only the changed video data.
- **Worth implementing?**
  - **Yes, strongly.**
  - This is one of the highest-value performance fixes.
- **Fully fixed by the performance audit plan?**
  - **Yes.**
  - This is one of the core performance-plan items.

### 3. Scan progress updates are too frequent
- **What the issue is**
  - While scanning, the app sends a progress update for every discovered video.
  - In plain language: the app keeps interrupting itself to say "I found another one" thousands of times.
- **Why this matters**
  - Too many updates can make the UI feel busy or laggy.
- **Proposed fix**
  - Send progress updates every short time interval or after a chunk of files instead of after every file.
- **Worth implementing?**
  - **Yes.**
  - It is a cheap fix with a good responsiveness gain.
- **Fully fixed by the performance audit plan?**
  - **Yes.**
  - The plan explicitly includes throttling scan progress.

### 4. Some work queues use a slow pattern for large lists
- **What the issue is**
  - Several hot loops remove the first item from an array over and over using `queue.shift()`.
  - In plain language: instead of moving a finger along a checklist, the app keeps rewriting the checklist after each item.
- **Why this matters**
  - This wastes time on large batches.
  - It affects thumbnail generation, metadata processing, and duplicate fingerprint backfill.
- **Proposed fix**
  - Replace `queue.shift()` with a simple index cursor.
- **Worth implementing?**
  - **Yes.**
  - Small change, low risk, clear performance win.
- **Fully fixed by the performance audit plan?**
  - **Yes.**
  - The plan explicitly includes replacing `queue.shift()` in hot loops.

### 5. Duplicate fingerprint reads are still too chatty with the database
- **What the issue is**
  - Before duplicate detection starts comparing videos, it loads fingerprint rows one video at a time.
  - In plain language: instead of asking the database for a stack of records, the app keeps asking for one paper at a time.
- **Why this matters**
  - This slows down duplicate detection startup.
  - It blocks the main process more than needed.
- **Proposed fix**
  - Batch these reads with chunked `IN (...)` queries.
  - Keep duplicate matching behavior the same.
- **Worth implementing?**
  - **Yes.**
  - This is one of the best duplicate-specific performance fixes.
- **Fully fixed by the performance audit plan?**
  - **Yes.**
  - The plan explicitly includes batched fingerprint reads.

### 6. Metadata writes happen one video at a time
- **What the issue is**
  - When metadata extraction completes, the app writes one database row at a time.
  - In plain language: it saves each result separately instead of saving a bundle together.
- **Why this matters**
  - This creates extra main-process work during large scans.
- **Proposed fix**
  - Batch metadata writes in safe transactions where behavior stays the same.
- **Worth implementing?**
  - **Yes.**
  - Good performance gain with manageable risk if done carefully.
- **Fully fixed by the performance audit plan?**
  - **Yes.**
  - The plan explicitly includes batched metadata writes.

### 7. Metadata and thumbnail batch merging in the renderer is heavier than it needs to be
- **What the issue is**
  - When metadata or thumbnail updates come back from the main process, the renderer rebuilds maps and merges data in a fairly expensive way.
  - In plain language: every batch arrival causes extra bookkeeping.
- **Why this matters**
  - This adds visible slowdown during scan-time updates.
- **Proposed fix**
  - Keep the current payload shape at first.
  - Optimize the renderer merge path.
  - Only slim payload fields later if measurement shows clone/serialization cost is also important.
- **Worth implementing?**
  - **Yes.**
  - Strong candidate for a noticeable scan-time speed improvement.
- **Fully fixed by the performance audit plan?**
  - **Yes.**
  - The plan explicitly includes optimizing the renderer merge path.

## Medium

### 8. Sidebar totals and ranges are recalculated too often
- **What the issue is**
  - The sidebar keeps rescanning the full library to calculate things like file-size range, duration range, duplicate count, and incompatible count.
  - In plain language: the sidebar keeps recounting the whole collection instead of reading prepared totals.
- **Why this matters**
  - It adds extra work on many normal UI updates.
- **Proposed fix**
  - Cache these values or maintain summary fields in the store.
- **Worth implementing?**
  - **Yes.**
  - Good UI responsiveness improvement, especially with large libraries.
- **Fully fixed by the performance audit plan?**
  - **Yes.**
  - The plan explicitly includes cached sidebar aggregates.

### 9. Grid view still rebuilds a lot of structure from the full filtered list
- **What the issue is**
  - Even though only visible items are rendered, the grid still rebuilds row/group structure and some selection logic from the whole filtered set.
  - In plain language: the app wisely draws only what you can see, but still spends time reorganizing the whole room first.
- **Why this matters**
  - This reduces the full benefit of virtualization.
- **Proposed fix**
  - Reduce repeated row/group reconstruction.
  - Reduce repeated list scans for selection support.
  - Keep the current UI behavior unchanged.
- **Worth implementing?**
  - **Yes, but after the higher-value store invalidation work.**
- **Fully fixed by the performance audit plan?**
  - **Yes.**
  - The plan explicitly includes reducing GridMode rebuild work.

### 10. Review mode does extra full-scope work
- **What the issue is**
  - Review mode rebuilds maps and recomputes summary/progress information with several passes.
  - In plain language: the review screen keeps recounting the review set more than necessary.
- **Why this matters**
  - It is a real cost, but smaller than the main library-view issues.
- **Proposed fix**
  - Cache review-scope lookups and reduce repeated summary/progress passes.
- **Worth implementing?**
  - **Yes, later.**
  - Useful, but not one of the first fixes.
- **Fully fixed by the performance audit plan?**
  - **Yes.**
  - The plan explicitly includes reducing ReviewMode recomputation.

### 11. Duplicate results screen can get too heavy for large result sets
- **What the issue is**
  - The duplicate groups view renders every group and every card at once.
  - In plain language: if there are lots of duplicates, the app tries to show everything at the same time.
- **Why this matters**
  - It can make the duplicate view slow or heavy.
- **Proposed fix**
  - Add windowing so only visible duplicate groups/cards are rendered.
- **Worth implementing?**
  - **Yes, if duplicate-result screens are actually slow in practice.**
  - Important, but not as urgent as the broader library-performance fixes.
- **Fully fixed by the performance audit plan?**
  - **Yes.**
  - The plan explicitly includes windowing duplicate results.

### 12. Duplicate results are not persisted between app launches
- **What the issue is**
  - If the app closes, duplicate groups are lost and must be recomputed.
  - In plain language: the app remembers the ingredients but not the finished duplicate review result.
- **Why this matters**
  - Users have to re-run duplicate detection after restart.
- **Proposed fix**
  - Persist duplicate group results in cache storage.
  - Invalidate them safely when videos change.
- **Worth implementing?**
  - **Maybe.**
  - Good UX improvement, but not required for correctness or core performance.
- **Fully fixed by the performance audit plan?**
  - **No.**
  - Persisting duplicate results is not part of the performance plan.

### 13. Orphaned fingerprint/cache data can build up after rename or move
- **What the issue is**
  - Video IDs are path-based, so renamed or moved files get new IDs.
  - Old fingerprint rows can remain behind unused.
  - In plain language: the app can leave old notes in the database after a file changes identity.
- **Why this matters**
  - This causes slow database growth over time.
- **Proposed fix**
  - Add cleanup for old video IDs and their fingerprint rows after full rescans or other safe maintenance points.
- **Worth implementing?**
  - **Yes, eventually.**
  - More of a long-term maintenance fix than a current blocker.
- **Fully fixed by the performance audit plan?**
  - **No.**
  - Database cleanup for renamed/moved files is not included in the performance plan.

### 14. Scanner throughput is conservative
- **What the issue is**
  - Folder scanning walks directories and stats files fairly serially.
  - In plain language: the scanner is safe and simple, but not especially aggressive on huge libraries.
- **Why this matters**
  - It can increase scan wall-clock time.
- **Proposed fix**
  - Make conservative throughput improvements without changing what files are found.
  - Avoid turning this into a big rewrite.
- **Worth implementing?**
  - **Yes, but later.**
  - Good follow-up once renderer and DB hot paths are improved.
- **Fully fixed by the performance audit plan?**
  - **Yes.**
  - The plan includes conservative scanner throughput improvements.

## Low

### 15. Duplicate defaults are duplicated in multiple files
- **What the issue is**
  - The same default duplicate settings are defined in more than one place.
  - In plain language: there are two copies of the same settings, so one could drift away from the other.
- **Why this matters**
  - This is mainly a maintenance risk.
- **Proposed fix**
  - Move duplicate defaults to a shared source, or keep the duplication but document it clearly and test it.
- **Worth implementing?**
  - **Maybe.**
  - Good cleanup, but not urgent if the copies stay in sync.
- **Fully fixed by the performance audit plan?**
  - **No.**
  - This is maintenance cleanup, not part of the performance plan.

### 16. Keeper-selection logic is duplicated in frontend and backend
- **What the issue is**
  - The code that decides the "suggested keeper" exists in both the renderer and the main process.
  - In plain language: the same decision recipe lives in two kitchens.
- **Why this matters**
  - If one copy changes and the other does not, they can disagree.
- **Proposed fix**
  - Extract it to a shared helper, or at minimum keep strong comments/tests tying the two copies together.
- **Worth implementing?**
  - **Maybe.**
  - Useful cleanup, but secondary to real correctness and performance issues.
- **Fully fixed by the performance audit plan?**
  - **No.**
  - Shared keeper logic is not part of the performance plan.

### 17. Duplicate scroll position is stored in a module-level variable
- **What the issue is**
  - The duplicate screen stores scroll position in a top-level variable.
  - In plain language: it remembers the scroll position in a fragile sticky note instead of in a safer state container.
- **Why this matters**
  - It can behave oddly with hot reload or future refactors.
- **Proposed fix**
  - Move it to a ref or store-managed state.
- **Worth implementing?**
  - **Low priority.**
  - Nice cleanup, not an important user-facing problem today.
- **Fully fixed by the performance audit plan?**
  - **No.**
  - Scroll-state cleanup is not included in the performance plan.

### 18. Ignored pairs have only a short undo window
- **What the issue is**
  - If a user dismisses a duplicate pair and misses the short undo toast, there is no proper UI for managing ignored pairs later.
  - In plain language: there is an undo, but only for a few seconds.
- **Why this matters**
  - This can confuse users.
- **Proposed fix**
  - Add an "ignored pairs" manager or a "clear ignored pairs" control in settings.
- **Worth implementing?**
  - **Yes, if duplicate review becomes a major workflow.**
  - It is more UX polish than a correctness issue.
- **Fully fixed by the performance audit plan?**
  - **No.**
  - Ignored-pairs management is a UX feature outside the performance plan.

### 19. The current duplicate algorithm is weak for trimmed clips
- **What the issue is**
  - The duplicate engine compares evenly spaced frames and uses duration tolerance.
  - In plain language: it is good at finding re-encodes and very similar full-length copies, but not good at detecting trimmed versions of the same clip.
- **Why this matters**
  - Users may expect "visual duplicate detection" to catch more than it currently can.
- **Proposed fix**
  - Short term: document the limitation clearly.
  - Long term: use a more advanced approach like sliding-window comparison or audio fingerprints.
- **Worth implementing?**
  - **Not now.**
  - This is a larger product/algorithm improvement, not a quick branch fix.
- **Fully fixed by the performance audit plan?**
  - **No.**
  - The performance plan intentionally avoids changing duplicate-detection semantics.

## Recommended Next Implementation Order

1. Permanent delete fallback dialog
2. Scan progress throttling
3. `queue.shift()` replacement
4. Field-aware invalidation for `filteredVideos`
5. Sidebar aggregate caching
6. Duplicate fingerprint DB batching
7. Metadata/thumb batch merge optimization
8. Metadata write batching
9. Grid and review recomputation cleanup
10. Duplicate results windowing
11. Scanner throughput improvements
12. Lower-priority cleanup items
