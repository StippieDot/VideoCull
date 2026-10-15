# ADR-0003: Checked JavaScript backend; real TypeScript only behind a decision gate

- **Status:** Accepted (the decision gate itself is still open)
- **Source:** [roadmap.md › Backend type safety](../../roadmap.md#backend-type-safety-checked-js-first-real-ts-only-behind-a-decision-gate), Phase 0.1, "Skipped Features"; `config/tsconfig.electron.json`

## Context

`electron/` is plain CommonJS run directly by Electron (`"main": "electron/bootstrap.js"`), with no build step. The renderer is TypeScript built by Vite. Moving the backend to real TypeScript would mean an emit step for `electron/`, changes to the dev scripts and to electron-builder, validation of the Store package, and test runners that understand TypeScript.

## Decision

- `config/tsconfig.electron.json` type-checks the backend without emitting anything. It uses `allowJs`, `checkJs: false`, `strict` and `noEmit`, includes `electron/**/*.js` and `src/types.ts`, and runs in CI.
- Files opt in with `// @ts-check`. They use JSDoc types that import shared types from `src/types.ts`.
- New backend modules start as `@ts-check`. Existing files opt in when a feature substantially rewrites them. `main.js` never opts in as a whole; it shrinks instead.
- **Decision gate D-TS** comes at the file-operation journal (roadmap 6.1), before rename. Real `.ts` backend modules go ahead only if checked JS proved insufficient for that module.

## Rationale

Checked JS gives compile-time checking of the contract and of the new modules without changing how the app runs or is packaged.

## Consequences and trade-offs

- Coverage at `1dcc13f`: 8 of 40 `electron/*.js` files are `@ts-check`. They are `app-menu`, `legal-files`, `media-process`, `media-tools`, `power-manager`, `preload`, `renderer-save-flush` and `system-power`. `main.js`, `main-helpers.js`, `ipc-guard.js`, `cache*.js` and `duplicates.js` are not checked.
- The main gain in type coverage comes from extracting modules out of `main.js`, since each new module is `@ts-check`. Turning `checkJs` on globally is not part of this decision.
- Shared types flow from renderer to backend only (`src/types.ts`). Nothing at runtime is shared across the seam.

## Alternatives considered

- Real TypeScript for `electron/` now. Deferred to the gate; listed under "Skipped Features".
