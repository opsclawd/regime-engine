---
title: HTTP Adapter Normalization — Moving src/http/ to src/adapters/http/ and Extracting Contract Errors
date: 2026-05-08
category: docs/solutions/best-practices
module: adapters/http
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - Moving adapter code from a top-level folder into the Clean Architecture adapters/ directory
  - Extracting shared error primitives from an adapter layer into a contract/ domain layer
  - Decoupling route registration from composition wiring
tags: [clean-architecture, dependency-inversion, error-taxonomy, adapters, contract-layer]
---

# HTTP Adapter Normalization

## Context

The project's `src/http/` folder lived at the top level instead of under `src/adapters/`, violating the Clean Architecture boundary documented in `architecture.md`. Additionally, contract validation error types (`ContractValidationError`, `ErrorDetail`, `ERROR_CODES`, etc.) were defined in the HTTP adapter layer (`src/http/errors.ts`), making the inner `src/contract/` layer depend on the outer HTTP adapter — a forbidden inward dependency. The route registration module also imported `ApplicationDependencies` from composition wiring, coupling the adapter to the composition root.

## Guidance

Three principle-based changes enforce the dependency rule:

1. **Extract neutral error primitives to `src/contract/errors.ts`.** The `ErrorDetail` interface (with `code: string`, not a version-specific enum), `pathToString`, `stableSortDetails`, and `zodIssueToDetails` are version-neutral helpers that both v1 and v2 produce identically. They belong in the contract layer, not HTTP.

2. **Re-home v1 error envelopes to `src/contract/v1/errors.ts`.** The `ERROR_CODES`, `ERROR_DETAIL_CODES`, `ContractValidationError`, and factory functions are v1-specific. Move them out of HTTP and into the contract version they belong to. V2 does the same with its own `src/contract/v2/errors.ts`, importing only neutral helpers from `../errors.js`.

3. **Introduce `HttpRouteDependencies` in the HTTP adapter.** Instead of importing `ApplicationDependencies` from composition, define an HTTP-owned interface that lists exactly what route registration needs. `buildApp` structurally satisfies it — no casting required.

After extraction, convert `src/http/errors.ts` into a temporary re-export shim so consumers keep working, then migrate each consumer to point at the new locations. Once all consumers are migrated, delete the shim and move the entire HTTP tree into `src/adapters/http/`.

**Dependency-cruiser rule:**

```js
{
  name: "contract-no-adapters",
  comment: "src/contract/** must not import outer adapters or composition wiring.",
  severity: "error",
  from: { path: "^src/contract/" },
  to: { path: "^src/(adapters|composition|http|ledger|workers)/|^src/(app|server)\\.ts$" }
}
```

Also exempt test files in adapters from the "no importing app.ts" rule, since e2e tests need the full app for setup:

```js
from: {
  path: "^src/adapters/(?!.*__tests__)";
}
```

## Why This Matters

When inner layers (contract, engine, application) import from outer layers (HTTP), the dependency boundary in `architecture.md` is a fiction — `npm run boundaries` would not catch future regressions. Extracting error primitives restores the inward dependency arrow so the dep-cruiser rule enforces reality. Moving HTTP under adapters aligns the filesystem with the documented architecture, making the boundary visible and enforceable.

## When to Apply

- When a new contract version needs error types — put them in `src/contract/<version>/errors.ts`
- When adding adapter code — it belongs under `src/adapters/`, never at the top level
- When a route handler needs a type from composition — define an adapter-owned interface instead
- When `npm run boundaries` shows violations — fix them by moving types inward, not by adding exceptions

## Examples

**Before (violates boundary):**

```typescript
// src/contract/v1/validation.ts
import { ContractValidationError } from "../../http/errors.js"; // inward import!
```

**After (boundary satisfied):**

```typescript
// src/contract/v1/validation.ts
import { ContractValidationError } from "./errors.js"; // same layer
```

**Before (adapter depends on composition):**

```typescript
// src/http/routes.ts
import type { ApplicationDependencies } from "../composition/buildApplication.js";
```

**After (adapter owns its dependency type):**

```typescript
// src/adapters/http/routes.ts
export interface HttpRouteDependencies {
  clock: ClockPort;
  ingestCandles: IngestCandlesUseCase;
  // ...only what routes need
}
```

## Related

- `architecture.md` — Clean Architecture boundaries and inner-layer import rules
- `.dependency-cruiser.cjs` — enforceable boundary rules
- `AGENTS.md` — project structure conventions
