# ADR-0005: Heavy processing stays outside React, with per-run cancellation and one pause authority

- **Status:** Accepted
- **Source:** [roadmap.md › Boundaries that stay as they are](../../roadmap.md#boundaries-that-stay-as-they-are), Phase 0.2 ("Cancellation stays scoped per run"), Phase 4.1; `electron/processor.js`, `electron/duplicates.js`, `electron/media-process.js`, `electron/processing-pause.js`

## Context

Libraries can hold thousands of videos. FFprobe, FFmpeg frame extraction, file hashing and visual fingerprint comparison are expensive. Some of them run on network or USB storage, where a single file can hang.

## Decision

- Scanning, FFprobe/FFmpeg, fingerprints, and the duplicate and visual workers run in the main process, in worker threads or in child processes. They never run in React.
- `processing-pause.js` is the only pause authority.
- FFmpeg and FFprobe run through `media-process.js`, which provides run tokens with SIGKILL cancellation, timeouts and a cap on output size.
- **Cancellation is scoped per run.** Each pipeline (metadata, thumbnails, duplicates, later clip export) keeps its own token. Cancelling thumbnails never kills a clip encode. Killing everything is reserved for app shutdown.
- Concurrency limits move into one scheduler when storage-aware scheduling ships (roadmap 4.1).

## Rationale

The UI stays responsive, and runaway processes can be killed. The roadmap explains per-run scoping: a global kill list would let unrelated work cancel each other.

## Consequences and trade-offs

- `duplicates.js` runs FFmpeg through `media-process.runFfmpeg` like the other pipelines, with a timeout, a cap on output size and the duplicate run as its cancellation token.
- Main has no single owner of "the current runs". The scan generation, the module-level tokens in `processor.js` and `activeDuplicateRun` are invalidated separately in several places. [ADR-0007](ADR-0007-main-process-run-ownership.md) decides to give them one owner.
- The renderer drives the order of the pipeline (scan → cache save → metadata → thumbnails → duplicates) and drops stale results by run ID.

## Alternatives considered

- One global list of active commands. Replaced by per-run tokens in roadmap 0.2.
