# HTTP Adapter Normalization Design

**Issue:** #49
**Date:** 2026-05-08
**Status:** Approved

## Problem

The Clean Architecture refactor now has `src/composition/**` as the runtime
wiring owner, but the HTTP adapter still lives in `src/http/**` while
`architecture.md` names `src/adapters/http/**` as the target outer-layer
location. Leaving both the documentation and code in disagreement would preserve
the ambiguity that #49 is meant to close.

The move also exposes two dependency-direction issues that must be fixed as
part of the design:

- Route registration currently imports `ApplicationDependencies` from
  `src/composition/**`.
- Contract validation modules currently import validation error primitives from
  the HTTP layer.

## Goals

- Move the full `src/http/**` tree to `src/adapters/http/**`.
- Keep Fastify route registration, handlers, auth helpers, HTTP error mapping,
  OpenAPI generation, and HTTP-focused tests in the HTTP adapter layer.
- Split contract validation error primitives out of HTTP before moving the HTTP
  tree.
- Define an HTTP-owned route dependency type near route registration.
- Make `architecture.md`, dependency-cruiser rules, and the source tree agree on
  the final HTTP adapter location.
- Preserve public behavior exactly.

## Non-Goals

- Do not change route paths or methods.
- Do not change response bodies, status codes, error codes, messages, details,
  or idempotency behavior.
- Do not change auth headers, token environment variables, or auth failure
  behavior.
- Do not change OpenAPI public API content.
- Do not change health, version, SQLite/Postgres runtime selection, Railway
  startup, or graceful shutdown behavior.
- Do not change engine, application, or domain logic except for import updates
  required by the error split.
- Do not redesign the v2 contract error model.
- Do not add new features or broad unrelated cleanup.

## Architecture

HTTP becomes a normal outer adapter by moving `src/http/**` to
`src/adapters/http/**`. The moved folder remains responsible for Fastify route
registration, handlers, auth helpers, HTTP error mapping, OpenAPI generation,
and HTTP-focused tests. This is a path and boundary refactor, not a behavior or
contract refactor.

Dependency direction:

- `src/composition/**` may import adapters and construct runtime dependencies.
- `src/adapters/http/**` may import application use-case interfaces, contract
  parsers/errors/types, and HTTP-local helpers.
- `src/adapters/http/**` may temporarily import or receive ledger store types
  only for handlers not yet converted to use cases, such as S/R and insights.
- `src/adapters/http/**` should not import storage adapter implementation
  internals directly unless required by existing unconverted handlers. Prefer
  receiving dependencies from `src/composition/**`.
- `src/adapters/http/**` must not import `src/composition/**`.

To enforce the last rule, the moved route file defines an HTTP-owned dependency
interface named `HttpRouteDependencies`, containing exactly what route
registration needs: use cases, health/version functions, clock, and temporary
direct store dependencies still used by handlers that have not yet been
converted to application use cases. `buildApplication()` can return extra fields
and structurally satisfy the interface. `buildApp()` passes that object to
`registerRoutes()`.

## Contract Error Ownership

Contract validation errors move out of HTTP before the folder move so
`src/contract/**` never imports an adapter.

Target ownership:

- `src/contract/errors.ts`
  - Contains only truly version-neutral primitives/helpers, such as
    `pathToString` and `stableSortDetails`.
  - Generic detail-shape helpers belong here only when both v1 and v2 consume
    them with identical semantics.
  - Does not automatically own detail-code enums. Keep detail-code enums
    version-specific unless the implementation verifies they are identical and
    intentionally version-neutral.
- `src/contract/v1/errors.ts`
  - Owns v1-specific public envelopes and helpers, including `ERROR_CODES`,
    `ErrorCode`, v1 detail codes if they remain version-specific,
    `ErrorEnvelope`, `ContractValidationError`,
    `unsupportedSchemaVersionError`, `validationErrorFromZod`, and the v1 helper
    factories currently used by v1 validation and handlers.
- `src/contract/v2/errors.ts`
  - Remains the v2-specific envelope module.
  - May import neutral helpers from `src/contract/errors.ts` only if it already
    duplicates helpers moved there or if imports break mechanically.
  - Must not change v2 codes, envelopes, messages, statuses, or behavior.

No contract module should import HTTP. v1 must not import v2, and v2 must not
import v1.

## Migration Order

1. Split contract errors out of HTTP.
2. Verify `src/contract/**` no longer imports HTTP.
3. Introduce HTTP-owned `HttpRouteDependencies`.
4. Verify HTTP no longer imports composition.
5. Move `src/http/**` to `src/adapters/http/**`.
6. Update imports, docs, and boundaries.
7. Run full validation.

This order keeps each intermediate state easy to validate and avoids creating a
temporary architecture where contract points at `src/adapters/http/**`.

## Boundary Rules

Update `.dependency-cruiser.cjs` and `architecture.md` so the final layout is
enforced and documented.

Required policy:

- Remove `src/http/**` as a live outer-layer path from the target architecture.
- Inner layers must not import `src/adapters/**`, including
  `src/adapters/http/**`.
- `src/adapters/**` must not import `src/composition/**` or runtime entry
  points.
- `src/contract/**` must not import `src/adapters/**`.
- `src/composition/**` remains the runtime wiring owner and may import adapters,
  application ports/use cases, and infrastructure needed to construct the
  runtime graph.

The boundary rules should continue to allow existing outer-layer adapters to
import the storage/framework packages they own.

## Behavior Parity

The migration must preserve:

- HTTP route paths and methods.
- Response status codes.
- Response envelope shapes, codes, messages, detail ordering, and idempotency
  fields.
- Auth headers, token environment variables, missing-token behavior,
  invalid-token behavior, and unset-env behavior.
- OpenAPI public API content: paths, methods, schemas, response shapes, status
  codes, and auth metadata. Any diff must be explained and must not reflect
  behavior change.
- `/health` response shape and status logic.
- `/version` response shape.
- SQLite/Postgres runtime selection behavior.
- Railway startup verification behavior.
- Graceful shutdown behavior.
- Existing test semantics and assertion strength.

Handlers should change only as needed for import paths and contract error module
locations.

## Validation

Targeted checks during implementation:

- After the contract error split, verify with `rg` that `src/contract/**` does
  not import `src/http/**` or `src/adapters/http/**`.
- After introducing `HttpRouteDependencies`, verify with `rg` that the HTTP
  adapter does not import `src/composition/**`.
- After the move, confirm no tracked source/test files remain under
  `src/http/**`.
- Confirm `architecture.md` and `.dependency-cruiser.cjs` name
  `src/adapters/http/**` as the final HTTP adapter location.

Required validation:

```bash
npm run typecheck
npm run lint
npm run test
npm run test:pg
npm run build
npm run boundaries
```

If `npm run test:pg` cannot run locally because Postgres is unavailable, the PR
must explicitly say why and identify the PG-sensitive behavior left for CI or an
environment with the test database.

If OpenAPI-generating code changes beyond import paths, compare OpenAPI output
before and after the migration. Any diff must be explained as non-behavioral.

## Risks

- Moving the full HTTP tree will touch many import paths. Keep changes
  mechanical and avoid opportunistic cleanup.
- Contract error extraction could accidentally change response detail order or
  message text. Snapshot and handler tests should catch this; implementation
  should preserve helper behavior exactly.
- Existing S/R and insights handlers still receive direct stores. The design
  permits that temporarily, but route dependencies should make the direct
  dependencies explicit and keep them supplied by composition.
