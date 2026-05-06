---
title: TypeScript Strict Mode and ESLint Zero-Tolerance Friction Patterns
date: 2026-05-01
category: developer-experience
module: src/workers/gecko
problem_type: developer_experience
component: tooling
severity: medium
applies_when:
  - Adding modules that consume external API JSON with unknown payloads
  - Writing test mocks for injected logger/service interfaces under zero-tolerance lint
  - Implementing callbacks or retry functions where some args aren't used
  - Creating test fixtures for code with threshold/guard logic
  - Working with AbortSignal in tests
tags:
  [
    typescript,
    strict-mode,
    type-guards,
    eslint,
    no-explicit-any,
    no-unused-vars,
    import-resolution,
    test-fixtures,
    abort-controller
  ]
---

# TypeScript Strict Mode and ESLint Zero-Tolerance Friction Patterns

## Context

While implementing the GeckoTerminal Candle Collector worker for regime-engine, several recurring TypeScript and ESLint patterns caused build and lint failures. These issues are non-obvious, often only surface at typecheck or lint time (not in IDE autocomplete), and tend to cascade — a single `unknown` payload or wrong import path can produce 5-10 downstream type errors. This guidance captures the solutions as reusable patterns for any project using `@typescript-eslint/recommended` with zero-tolerance lint (`--max-warnings 0`).

## Guidance

### 1. Type-Safe Narrowing of `unknown` API Payloads

When consuming external APIs, response payloads arrive as `unknown`. Casting with `as Record<string, unknown>` and then accessing nested properties fails typecheck because TypeScript still sees the base type as `unknown`.

**Fix:** Introduce type guard functions:

```typescript
function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// Usage — chain guards for nested access:
if (!isObject(payload) || !isObject(payload.data) || !isObject(payload.data.attributes)) {
  throw new ProtocolError("Invalid envelope");
}
const ohlcvList = payload.data.attributes.ohlcv_list;
```

### 2. Avoid `as any` for Test Mocks — Use Interface Types

`@typescript-eslint/no-explicit-any` (enabled in `recommended`) rejects `as any` casts. For mock objects in tests, import the interface and cast to that type instead.

```typescript
// Before (broken):
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;

// After (fixed):
import type { WorkerLogger } from "./logger.js";
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as WorkerLogger;
```

### 3. `@typescript-eslint/no-unused-vars` Doesn't Honor Underscore Prefix

Unlike vanilla ESLint's `no-unused-vars`, the TypeScript variant under `@typescript-eslint/recommended` does **not** ignore `_`-prefixed parameters. Solutions:

- **Remove unused parameters entirely** when possible (e.g., drop the second arg from `nonNegativeInteger`).
- **Type assertion for callback signatures** that must accept but don't use args:

```typescript
// Before (broken): _attempt triggers no-unused-vars
(attempt) =>
  fetchGeckoOhlcv(
    config,
    deps
  )(
    // After (fixed): type assertion on the implementation
    () => fetchGeckoOhlcv(config, deps)
  ) as (attempt: number) => Promise<unknown>;
```

- Or configure the ESLint rule with `"argsIgnorePattern": "^_"` if the project prefers keeping params for documentation.

### 4. Verify Relative Import Paths at Typecheck Time

IDEs may not catch wrong relative paths. A common mistake: counting `../` segments incorrectly for nested files. From `src/workers/geckoCollector.ts`, `../../contract/v1/types.js` resolves _above_ `src/` — the correct path is `../contract/v1/types.js`.

Always run `pnpm run typecheck` after adding new imports.

### 5. Align Test Fixtures with Business Logic Guards

When production code has threshold guards (e.g., "block ingest if `lookback >= 50` and `validCount < 50`"), test data must satisfy those guards or tests silently skip the code under test. The `shouldPostNormalizedBatch` guard blocked all happy-path tests when `geckoLookback` was 200 but only 1 valid candle was provided.

**Fix:** Use realistic fixture data or adjust test config defaults to match the test scenario:

```typescript
// Test config with lookback below threshold:
const BASE_CONFIG = { geckoLookback: 10, ... };
```

### 6. Don't Mutate `AbortSignal.aborted` — Use `AbortController`

`AbortSignal.aborted` is a readonly property. Assigning to it throws in strict mode.

```typescript
// Before (broken):
const signal = AbortSignal.abort; // or: signal.aborted = true; ← runtime error

// After (fixed):
const controller = new AbortController();
controller.abort();
const signal = controller.signal; // signal.aborted === true
```

### 7. Remove All Unused Imports/Exports Under Zero-Tolerance Lint

With `@typescript-eslint/no-unused-vars` set to error with no exceptions, every unused import, unused export, unused destructured variable, and unused function parameter is a lint failure. Remove them proactively — this includes type-only imports used only in tests, helper functions never called, and destructured fields not referenced.

## Why This Matters

- **CI gate is real**: `pnpm run typecheck && pnpm run test && pnpm run lint && pnpm run build` must all pass. Any one of these patterns blocks PRs.
- **Feedback loop is slow**: These failures often don't surface in IDE autocomplete — they only appear at typecheck/lint time.
- **Cascade effect**: A single `unknown` payload or wrong import path can produce 5-10 downstream type errors, masking the root cause.
- **Silent test vacuum**: Test data that doesn't satisfy business guards doesn't fail — it silently exercises no meaningful code path, creating false confidence.

## When to Apply

- Adding a new module that consumes external API JSON (`unknown` payloads)
- Writing test mocks for injected logger/service interfaces
- Implementing callbacks or retry functions where some args aren't used
- Adding imports from another module — always typecheck after
- Creating test fixtures for code that has threshold/guard logic
- Writing tests involving `AbortSignal` or `AbortController`
- Working in a project with `@typescript-eslint/recommended` or stricter config

## Related

- GitHub Issue #18: GeckoTerminal candle collector feature
- `docs/solutions/developer-experience/pg-dependent-route-test-isolation-2026-04-30.md` — related DX friction (test isolation), different problem space
