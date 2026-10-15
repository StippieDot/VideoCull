# ADR-0001: Change module boundaries only inside feature work

- **Status:** Accepted
- **Source:** [roadmap.md › Architecture Rules](../../roadmap.md#architecture-rules), "How refactors are proven not to change behaviour", and "Working Rules"

## Context

VideoCull ships continuously from `main`; every merged version must work on its own. The biggest coordination files are `electron/main.js` (about 3,150 lines, 53 IPC registrations), `src/store.ts` and `src/App.tsx`. A standalone refactoring phase would move a lot of working code without any user-visible gain, and each such move risks breaking something.

## Decision

A boundary changes only when a roadmap item already touches that code, and only if the change removes duplication, an implicit shared state or an untestable block. Each change is attached to the feature that causes it and states **what moves**, **why**, and **how we know it's done**.

Refactors follow a fixed procedure:

1. Write characterization tests of the current behaviour first, using injected fakes in the `main-helpers` style.
2. Move code verbatim in one commit. Change behaviour in a separate commit.
3. Keep `check:ipc`, the electron type check, the unit tests and the relevant e2e specs green.
4. Write grep-able completion criteria. For example, "`main.js` contains no `knownVideoPaths`".

## Rationale

The roadmap gives this reason: moving pipeline handlers, the updater and the HTML report "would be churn" while the roadmap changes them only slightly. Tying each move to a feature means it pays for itself straight away and gets tested by the feature's own work.

## Consequences and trade-offs

- `main.js` shrinks gradually, not on a schedule. Known problems, such as the implicit known-video maps and the direct settings reads, wait for the feature that fixes them (roadmap 2.1 and 3.2).
- A cross-cutting problem that no single feature "owns" can wait indefinitely. Ownership of processing runs and their cancellation is one such case. [ADR-0007](ADR-0007-main-process-run-ownership.md) ties it to the delete work in roadmap 2.1.
- Correctness fixes are not refactors and can ship as patch releases at any time.

## Alternatives considered

- A dedicated refactoring phase. Rejected in the roadmap as churn.
- Per-domain IPC registration modules. Rejected; see [ADR-0002](ADR-0002-preload-bridge-and-central-ipc-registration.md).
