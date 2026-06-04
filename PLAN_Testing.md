# Lean Feature-Coverage Testing Plan For Video Cull

## Summary

This plan focuses on **regression protection for the features that can actually hurt users**:
- review decisions not persisting
- duplicate-review behavior drifting across reruns
- destructive actions touching the wrong files
- settings/cache migrations breaking existing users
- Electron/renderer orchestration getting out of sync

It follows the TDD and tdd-workflow skills by:
- testing one behavior at a time in vertical slices
- preferring public interfaces over implementation-detail seams
- adding integration tests before expanding internal helper coverage
- using only a **thin, high-value E2E layer**
- treating code coverage as a blind-spot report, not a primary success metric

Locked decisions:
- **Node baseline:** `Node 24 LTS`
- **Coverage policy:** no global numeric target or gate
- **Refactor policy:** allow targeted refactors only when they unblock better public-behavior tests
- **E2E policy:** exactly `3` core Electron E2E flows in the main plan
- **Dependency policy:** add `@testing-library/react`, `jsdom`, and `@testing-library/user-event` for renderer integration; defer `@playwright/test` until the E2E phase

## Key Changes

### Phase A: make Node 24 the real tested baseline

- Standardize docs, test scripts, and CI on **Node 24 LTS**.
- Fix the current runtime mismatch:
  - repo docs should stop implying a different Node baseline than CI
  - release/test workflows should use the same supported LTS unless there is an explicit reason not to
- Audit the current test suite for Node 24 compatibility:
  - all files under `tests/`
  - Vitest config
  - test helpers/mocks
  - extracted helper modules and `__test__` seams
  - native-module paths, especially `better-sqlite3`
- Rewrite any current tests that rely on runtime quirks or outdated assumptions.
- Make persistence-critical tests reliable on the chosen baseline instead of accepting environment-specific skips.

### Phase B: add renderer integration tests where feature gaps are real

Add `jsdom` + Testing Library coverage for the renderer behaviors that currently have the most regression risk.

Cover these app-level flows:
- App event handling for:
  - scan progress
  - metadata-ready batches
  - thumbnail-ready batches
  - duplicate-progress updates
- settings persistence side effects
- drag/drop directory validation and session behavior
- duplicate-detection gating and progress display
- export-report success/failure UI behavior
- global mute and settings-driven behavior where it affects user-visible state

Rules:
- test through real renderer/store/public interfaces first
- use `user-event` when the behavior is interaction-driven, especially keyboard/settings flows
- avoid snapshot-heavy tests and low-value markup assertions

### Phase C: add only 3 high-value Electron E2E flows

Introduce Playwright Electron only for these workflows:

1. **Relaunch preserves review decisions**
   - mark keep/delete/skip
   - relaunch app
   - verify persisted decisions reload correctly

2. **Duplicate rerun preserves manual keeper and ignored pair behavior**
   - run duplicate detection
   - set a manual keeper
   - ignore a pair
   - rerun
   - verify the result stays stable

3. **Batch delete only removes intended files**
   - select videos for deletion
   - delete them
   - verify only intended files are removed
   - verify unrelated files and review state stay correct

E2E rules:
- use tiny committed fixtures plus temp working directories
- assert filesystem state, persisted state, and rendered state
- do not build a broad screenshot-based E2E suite
- run Windows-first because path handling, deletion, and packaging behavior are Windows-critical

Also add:
- one **packaged-app smoke check** on Windows release validation to prove the shipped app starts successfully

### Phase D: add migration tests for existing users

Treat backward compatibility as a feature.

Add tests for:
- legacy settings formats
- invalid old settings values
- duplicate settings migration
- recent-directory pruning behavior
- old cache path modes
- stale cached metadata
- corrupted or partially upgraded cache states

The test oracle should be:
- what the app can still load
- what gets normalized
- what gets rejected safely
- whether user data survives upgrades predictably

### Phase E: fill specific risky holes in Electron and workers only where needed

Do **not** do a broad “split everything out of `main.js`” effort.

Extract and test only the safety-critical pieces that are currently hard to cover or directly dangerous:
- path validation for open/stream/delete
- save-cache payload validation
- batch-delete safety checks
- protocol/range handling where wrong behavior could expose or touch the wrong file

Workers and duplicate internals:
- do not start with another big duplicate-testing expansion
- only deepen worker/duplicate coverage now if:
  - a real bug is found
  - the renderer/E2E work exposes an unprotected risky path
  - the worker boundary is actively blocking trustworthy regression tests

Keep existing `__test__` seams unless they are actively blocking better public-interface coverage. No repo-wide anti-`__test__` cleanup campaign.

### Phase F: final important-feature gap audit

After Phases A–E are implemented, do one explicit final audit of the app’s user-facing features.

For each meaningful feature, classify it as:
- protected by unit/integration tests
- protected by E2E
- intentionally lightly covered because it is low-risk
- still missing important regression protection

Use the real app surface as the checklist, including:
- session loading and scanning
- metadata/thumbnails update flow
- review decisions
- undo
- duplicate review behavior
- relaunch persistence
- delete/export/settings flows
- drag/drop and key app-level interactions
- migration/upgrade behavior

Rules for this audit:
- no ownership matrix bureaucracy
- no percentage target
- no requirement to deeply test every tiny feature
- only add follow-up tests for features that are both:
  - user-facing and important
  - still insufficiently protected after the earlier phases

The purpose of this phase is to catch important missed gaps before calling the testing effort “good enough.”

## Test Plan

### Phase A acceptance

- Local and CI tests both run on Node 24 LTS.
- No critical test depends on a different Node runtime assumption.
- Native-module persistence tests are reliable on the baseline.

### Phase B acceptance

- Renderer integration tests exist for App-level event flows, settings persistence side effects, drag/drop behavior, and duplicate-progress handling.
- Major renderer regressions can be caught without relying on E2E.

### Phase C acceptance

- The 3 Electron E2E flows are green and stable on Windows.
- The packaged-app smoke check runs in release validation.

### Phase D acceptance

- Legacy settings and cache migration behavior has regression tests.
- Old or malformed persisted data fails safely and predictably.

### Phase E acceptance

- Dangerous Electron file/path/delete behavior has direct regression coverage.
- `main.js` extraction only happened where it improved testing of risky behavior.
- No large speculative refactor was done just to increase coverage.

### Phase F acceptance

- Every important user-facing feature has been reviewed once explicitly.
- Any feature that is still high-risk and under-protected has a concrete follow-up test added.
- The app is not declared “well covered” until this audit is complete.

### End-state success criteria

The plan is successful when:
- the highest-risk user features have direct regression ownership
- the 3 end-to-end flows protect the most dangerous full-app regressions
- no critical runtime surface remains effectively untested
- coverage rises as a consequence of feature protection, not because low-value tests were added
- the final feature-gap audit does not reveal any major uncovered important feature

Critical features that must be protected by the end of the plan:
- session loading and scan/update event handling
- review decisions and relaunch persistence
- duplicate rerun stability with manual keeper and ignored pairs
- destructive delete safety
- settings/cache migration compatibility
- export and settings side effects that affect user trust

## Assumptions

- Node 24 LTS is the supported baseline for local testing, CI, and test-related tooling.
- The shipped app still runs on Electron’s embedded runtime; the Node baseline is about consistent testing and tooling behavior.
- Coverage is measured and reviewed, but there is **no overall percentage target or CI gate** in this plan.
- `@testing-library/react`, `jsdom`, and `@testing-library/user-event` are included for renderer integration work.
- `@playwright/test` is added only when Phase C starts.
- Broad ownership matrices, feature bureaucracy, and repo-wide seam cleanup are intentionally out of scope.
