# ADR-0006: New backend modules are plain functions with injected I/O

- **Status:** Accepted
- **Source:** [roadmap.md](../../roadmap.md): "Guiding constraint", Boundaries that stay as they are (`main-helpers.js` pattern), and Working Rules; `electron/main-helpers.js`, `electron/graceful-shutdown.js`, `electron/power-manager.js`, `tests/electron/*`

## Context

The handlers in `main.js` cannot be unit-tested without booting Electron, and no unit test loads `main.js`. The modules that are well tested take their filesystem, shell, cache or clock as parameters.

## Decision

- New backend modules are `// @ts-check` CommonJS modules made of plain functions. Filesystem, shell, cache, timers and Electron objects are passed in.
- No classes, DI containers or repositories. No generic transfer, persistence or processing framework. Each operation is a small, concrete function with its own tests.
- Electron-side tests go in `tests/electron`.

## Rationale

Injected functions already give a test seam. An extra interface or container layer would add files to read without adding depth.

## Consequences and trade-offs

- A module's interface is its exported functions plus the dependencies it is given. Keep that list short, or the module becomes shallow.
- Stateful lifecycle modules (`power-manager`, `graceful-shutdown`) use factory functions that return closures. That is consistent with this decision.

## Alternatives considered

- Classes, DI containers and repositories. Excluded in Working Rules.
