# ADR-0004: All cache I/O through one cache worker; schema changes are additive

- **Status:** Accepted
- **Source:** [roadmap.md › Boundaries that stay as they are](../../roadmap.md#boundaries-that-stay-as-they-are), "Each Version Must Work Standalone"; `electron/cache-service.js`, `electron/cache-worker.js`, `electron/cache-worker-operations.js`, `electron/cache.js`

## Context

Each loaded folder has a SQLite database (better-sqlite3, WAL). Depending on the cache mode, it lives in a central location or next to the videos. Review decisions, metadata, fingerprints and thumbnail rows all live there. Several pipelines write to these databases at the same time, and both editions and older versions may open the same profile.

## Decision

- Every database access goes through `cache-service` → `cache-worker` (one worker thread that owns the connections) → `cache-worker-operations`. A new cache operation becomes a new `case` in `cache-worker-operations.js`, following the pattern of `moveVideos`.
- `cache-service` rejects requests while a cache transition (migration or clear) is active, while shutting down, and for blocked folder scopes.
- Schema changes are **additive only**: new tables and new columns with defaults. `saveCache` upserts explicit columns, so a row written by an older version keeps the columns that version doesn't know about.

## Rationale

One owner of the connections serializes writes per folder and keeps SQLite off the main thread. The scope and transition gate gives one place to refuse writes during destructive maintenance. Additive schema keeps data intact across editions and downgrades. (Keeping the data is not the same as keeping its meaning; see the roadmap's Downgrading default.)

## Consequences and trade-offs

- The gate is the last line of defence against stale work. A duplicate-detection run caught by a reset, a cache clear or a migration has every write refused with `CACHE_UNAVAILABLE`; the run now stops on that refusal instead of counting it as a fingerprint failure.
- SQLite-corruption recovery (quarantine and retry once) is currently repeated by callers in `main.js` instead of living behind this seam.
- Full-record upserts (`saveCache` and `saveCacheChunked`, which share one batch writer) leave `status`, `rating`, `favorite` and `bookmarks` alone on conflict. `updateVideoReviewStateBatch` is therefore the only writer of review decisions on an existing row. Extracting the renderer's save queue as `review-persistence` is roadmap 3.3.

## Alternatives considered

None recorded.
