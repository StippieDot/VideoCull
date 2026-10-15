# ADR-0002: Preload bridge as the security boundary; IPC registered centrally in main.js

- **Status:** Accepted
- **Source:** [roadmap.md › Boundaries that stay as they are](../../roadmap.md#boundaries-that-stay-as-they-are), "IPC contracts that become explicitly typed", "Skipped Features"; `electron/main.js` (`webPreferences` ~347), `electron/preload.js`, `scripts/check-ipc-contract.js`, `index.html` (CSP)

## Context

The renderer shows file names, metadata and thumbnails taken from untrusted video files. The main process can delete files, open shell windows and write to the cache.

## Decision

- The window runs with `contextIsolation: true` and `nodeIntegration: false`. The renderer reaches the main process only through `preload.js` and `contextBridge`.
- `preload.js` is `// @ts-check` and annotates its exposed object as the `ElectronAPI` interface from `src/types.ts`. The compiler therefore checks the preload method set against the renderer's contract.
- `scripts/check-ipc-contract.js` runs in `test:ci`. It checks that the `ElectronAPI` keys, the preload methods and the channel registrations in `main.js` match by **name**.
- IPC handlers stay **registered in `main.js`**. As features touch them, they become one-line delegations to focused modules, so every channel stays visible in one place.
- **Types don't replace runtime validation.** Main validates every IPC payload, because the renderer is a trust boundary.
- `ipc-guard.js` wraps `ipcMain.handle` and `ipcMain.on`, so a call from anything other than the main frame of the app's own page is rejected. It also blocks navigation away from the app page and every new window. Channel registration stays in `main.js`.
- Thumbnails and videos are served through privileged `thumb:` and `video:` protocols, which allow only cache roots and known video paths. A strict CSP limits scripts to `'self'`.

## Rationale

The roadmap gives these reasons:
- A generic typed-RPC layer or per-domain registration would bring "little gain" and would require rewriting the contract check.
- Central registration keeps the full channel list in one file.

## Consequences and trade-offs

- The contract check verifies names, not argument or result shapes. Shapes are typed per feature as contracts change (`DeleteResult`, `FileOpResult` and others).
- Handlers in `main.js` are not type-checked; only preload is. See [ADR-0003](ADR-0003-checked-javascript-backend.md).
- IPC results use several shapes today (boolean, `{ok}`, `{status}`, string enums, `null`, per-item arrays). Whether to adopt one convention for new channels is an open question in [../overview.md](../overview.md#9-open-questions).

## Alternatives considered

- Generic typed RPC and per-domain `register*Ipc` functions. Rejected; listed under "Skipped Features".
