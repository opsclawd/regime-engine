# Architecture Boundary Guardrails Design

**Issue:** #37
**Date:** 2026-05-08
**Status:** Approved

## Problem

Regime Engine already has a deterministic functional core, but the repo does not
yet enforce architectural boundaries. Today, core engine code could accidentally
import HTTP handlers, storage adapters, workers, database packages, process
imports, or `process.env` usage without any dedicated check failing.

#37 is a guardrail and refactor-prep PR. It is not the Clean Architecture
migration itself. The later extraction work happens in #38, #39, and #40.

## Goals

- Add an architecture document update that describes the intended internal
  structure:
  - `src/domain`
  - `src/application`
  - `src/application/ports`
  - `src/application/use-cases`
  - `src/adapters/http`
  - `src/adapters/postgres`
  - `src/adapters/sqlite`
  - `src/composition`
- Add `npm run boundaries` as the dedicated architecture policy gate.
- Use dependency-cruiser for import boundary checks.
- Add a small `process.env` scan inside `npm run boundaries` for pure/future
  inner-layer folders.
- Make the boundary gate pass against the current repo.
- Protect existing `src/engine/**` and future target folders without broad
  legacy exceptions.

## Non-Goals

- No runtime behavior changes.
- No handler rewrites.
- No store rewrites.
- No route movement.
- No composition movement.
- No full final Clean Architecture graph enforcement against legacy folders.
- No mixing architecture policy into `npm run lint`.

## Design Decisions

| Decision              | Choice                                                                                               | Rationale                                                                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Boundary tool         | dependency-cruiser                                                                                   | It directly supports forbidden dependency rules, CI-failing severities, and TypeScript path resolution through `tsconfig.json`.                    |
| Script surface        | `npm run boundaries`                                                                                 | Keeps architecture policy explicit and separate from regular lint.                                                                                 |
| Current enforcement   | Protect `src/engine/**` only among existing inner folders                                            | This gives a real guarantee today without noisy exceptions for legacy `src/http/**` and `src/ledger/**`.                                           |
| Future enforcement    | Add rules for `src/domain/**`, `src/application/**`, `src/adapters/**`, and `src/composition/**` now | New files in the target structure are protected from day one. Missing future directories are harmless.                                             |
| Worker classification | Treat `src/workers/**` as outer-layer runtime code                                                   | Workers may read env, run loops, call external APIs, and later invoke application use cases, but engine/domain/application must never import them. |
| Env guard             | Separate shell script for `process.env` scan                                                         | dependency-cruiser catches imports, not global usage. The env check stays under the same `boundaries` gate.                                        |

## Boundary Rules

### Package Groups

The dependency-cruiser config will use exact package and repo path groups.

Forbidden HTTP/framework packages for inner layers:

- `fastify`

Forbidden database/storage packages for inner layers:

- `drizzle-orm`
- `drizzle-orm/sql`
- `drizzle-orm/postgres-js`
- `drizzle-orm/pg-core`
- `postgres`
- `node:sqlite`

Forbidden runtime process import for inner layers:

- `node:process`
- `process`

Forbidden repo paths for inner layers:

- `src/http/**`
- `src/ledger/**`
- `src/workers/**`
- `src/adapters/**` where applicable
- `src/application/**` where applicable
- `src/composition/**` where applicable
- `src/app.ts`
- `src/server.ts`

### `src/engine/**`

`src/engine/**` is existing pure/core code. It must not import:

- `src/http/**`
- `src/ledger/**`
- `src/workers/**`
- `src/adapters/**`
- `src/composition/**`
- `src/app.ts`
- `src/server.ts`
- `fastify`
- `drizzle-orm`
- `drizzle-orm/sql`
- `drizzle-orm/postgres-js`
- `drizzle-orm/pg-core`
- `postgres`
- `node:sqlite`
- `node:process`
- `process`

`src/engine/**` may continue to import contract types and pure contract helpers
where the current code already does so. #37 does not decouple engine types from
contracts.

### `src/domain/**`

`src/domain/**` is future inner domain code. It must not import:

- `src/application/**`
- `src/adapters/**`
- `src/composition/**`
- `src/http/**`
- `src/ledger/**`
- `src/workers/**`
- `src/app.ts`
- `src/server.ts`
- `fastify`
- `drizzle-orm`
- `drizzle-orm/sql`
- `drizzle-orm/postgres-js`
- `drizzle-orm/pg-core`
- `postgres`
- `node:sqlite`
- `node:process`
- `process`

Domain code may import other domain modules and pure shared contract/value types
when needed.

### `src/application/**`

`src/application/**` is future use-case orchestration code. It may import:

- `src/domain/**`
- `src/engine/**`
- `src/contract/**`
- `src/application/ports/**`
- `src/application/use-cases/**`

It must not import:

- `src/http/**`
- `src/ledger/**`
- `src/adapters/**`
- `src/composition/**`
- `src/workers/**`
- `src/app.ts`
- `src/server.ts`
- `fastify`
- `drizzle-orm`
- `drizzle-orm/sql`
- `drizzle-orm/postgres-js`
- `drizzle-orm/pg-core`
- `postgres`
- `node:sqlite`
- `node:process`
- `process`

Application code depends on ports, not concrete storage or HTTP adapters.

### `src/adapters/**`

`src/adapters/**` is future outer adapter code. It may depend inward on:

- `src/application/**`
- `src/domain/**`
- `src/engine/**`
- `src/contract/**`

It may also use framework and storage packages according to its adapter
responsibility. #37 will not add a broad "adapters may import everything" graph;
the important guarantee is that inner layers cannot import adapters.

### `src/composition/**`

`src/composition/**` is future dependency wiring. It may import across layers to
construct runtime objects and select infrastructure. Inner layers cannot import
composition.

### `src/workers/**`

`src/workers/**` is existing outer-layer runtime code. Workers may:

- read env
- run loops
- expose health probes
- call external clients
- invoke application use cases once they exist

The guardrail is directional: `src/engine/**`, `src/domain/**`, and
`src/application/**` must never import `src/workers/**`.

## Implementation Shape

Add dependency-cruiser as a dev dependency and create a repo-local config, for
example `.dependency-cruiser.cjs`.

`package.json` gains:

```json
{
  "scripts": {
    "boundaries": "depcruise --config .dependency-cruiser.cjs --output-type err \"src/**/*.ts\" && sh scripts/check-boundary-env.sh"
  }
}
```

Add `scripts/check-boundary-env.sh`:

```sh
#!/usr/bin/env sh
set -eu

status=0
for dir in src/engine src/domain src/application; do
  if [ -d "$dir" ]; then
    if rg --line-number --fixed-strings "process.env" "$dir"; then
      status=1
    fi
  fi
done

if [ "$status" -ne 0 ]; then
  echo "Forbidden process.env usage found in inner-layer boundary folders." >&2
fi

exit "$status"
```

The script deliberately skips missing future directories.

Optional `.gitkeep` files may be added only if useful to make future target
folders visible. They must not imply code has already moved.

## Architecture Documentation

Update `architecture.md` with a section that states:

- Regime Engine is moving toward internal Clean Architecture seams.
- #37 adds guardrails and target structure documentation only.
- The migration is not a CLMM-style monorepo rewrite.
- Current legacy folders remain in place for #37.
- Future extraction work belongs to #38, #39, and #40.
- Workers are outer-layer runtime/adapter code.

## Negative Test

The intentional-illegal-import verification must not commit broken source. The
PR description should document the negative test as a local temporary check:

1. Temporarily add an illegal import, such as importing `../../http/routes.js`
   from a file under `src/engine/**`, or create a temporary file under
   `src/domain/**` that imports `fastify`.
2. Run `npm run boundaries` and confirm it fails with the expected
   dependency-cruiser rule.
3. Remove the temporary illegal import.
4. Run `npm run boundaries` again and confirm it passes.

For the env scan, temporarily add `process.env.TEST_BOUNDARY` under
`src/engine/**`, run `npm run boundaries`, confirm it fails, remove the line,
and rerun successfully.

## Testing

Required validation for #37:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
npm run boundaries
```

If any command is not run, the PR must explicitly say why.

## Acceptance Criteria

- `npm run boundaries` exists.
- `npm run boundaries` passes against the current repo.
- `src/engine/**` is protected from `src/http/**`, `src/ledger/**`,
  `src/workers/**`, `src/adapters/**`, `src/composition/**`, `src/app.ts`,
  `src/server.ts`, `fastify`, `drizzle-orm`, `drizzle-orm/sql`,
  `drizzle-orm/postgres-js`, `drizzle-orm/pg-core`, `postgres`, `node:sqlite`,
  `node:process`, and `process` imports.
- Future `src/domain/**`, `src/application/**`, `src/adapters/**`, and
  `src/composition/**` paths are represented in the boundary policy.
- `src/workers/**` is documented and enforced as outer-layer runtime code from
  the perspective of engine/domain/application.
- `process.env` is rejected in `src/engine/**`, `src/domain/**`, and
  `src/application/**`; missing future directories are skipped.
- Architecture docs clearly state #37 is guardrail/refactor prep, not the
  migration itself.
- No handlers, stores, routes, or runtime wiring are moved.
- PR description documents the intentional-illegal-import negative test.
