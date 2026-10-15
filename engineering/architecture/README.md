# Architecture

- [overview.md](overview.md): subsystems, state ownership, invariants, direction and open questions. Start here.
- [decisions/](decisions/): architecture decision records.

| ADR | Title | Status |
|---|---|---|
| [0001](decisions/ADR-0001-change-boundaries-only-with-feature-work.md) | Change module boundaries only inside feature work | Accepted |
| [0002](decisions/ADR-0002-preload-bridge-and-central-ipc-registration.md) | Preload bridge as the security boundary; IPC registered centrally in main.js | Accepted |
| [0003](decisions/ADR-0003-checked-javascript-backend.md) | Checked JavaScript backend; real TypeScript only behind a decision gate | Accepted |
| [0004](decisions/ADR-0004-single-cache-worker-and-additive-schema.md) | All cache I/O through one cache worker; schema changes are additive | Accepted |
| [0005](decisions/ADR-0005-processing-outside-react-with-per-run-cancellation.md) | Heavy processing stays outside React, with per-run cancellation and one pause authority | Accepted |
| [0006](decisions/ADR-0006-plain-function-backend-modules.md) | New backend modules are plain functions with injected I/O | Accepted |
| [0007](decisions/ADR-0007-main-process-run-ownership.md) | Main process owns processing runs and session invalidation in one place | Accepted (not yet implemented) |

The roadmap ([roadmap.md › Architecture Rules](../roadmap.md#architecture-rules)) remains the source for planned modules and per-feature boundary changes. These documents record the decisions themselves and the current state of the code.
