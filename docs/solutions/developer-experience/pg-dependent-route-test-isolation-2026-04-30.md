---
title: Graceful PG-dependent test skipping when adding routes to mixed test infrastructure
date: 2026-04-30
category: developer-experience
module: src/http
problem_type: developer_experience
component: testing_framework
severity: medium
applies_when:
  - Adding new Postgres-dependent routes or stores to a codebase with mixed PG/non-PG test infrastructure
  - Extending StoreContext or similar shared interfaces that have mock objects in tests
  - Adding OpenAPI-documented routes that are tracked by smoke tests
symptoms:
  - "TS2741 when adding a new store to StoreContext — mock objects in storeContext.test.ts missing the new property"
  - "Smoke test assertion fails after adding new OpenAPI routes — hardcoded path count is stale"
  - "E2e tests requiring Postgres fail in non-PG test runs (pnpm run test) because no graceful skip logic exists"
  - "Auth-related HTTP status tests (401/500) cannot be reached in non-PG test suite because the 503-before-auth handler returns 503 when PG is unavailable"
root_cause: incomplete_setup
resolution_type: workflow_improvement
tags: [testing, postgres, e2e, vitest, mock-propagation, openapi, skipif]
---

# Graceful PG-dependent test skipping when adding routes to mixed test infrastructure

## Context

When adding PG-dependent routes (e.g., CLMM Insight Ingestion) to a TypeScript/Fastify/Drizzle ORM/Postgres codebase that runs two test modes — a default `pnpm run test` without Postgres and a separate PG-enabled `pnpm run test:pg` — several systemic friction points emerge:

- **Mock propagation** — Adding a new store to `StoreContext` breaks every test that constructs a mock `StoreContext` object with `TS2741`.
- **Hardcoded API path counts** — OpenAPI smoke tests with `expect(paths).toHaveLength(N)` fail the moment new routes are added.
- **PG availability detection** — E2e tests that require Postgres can't simply throw in `beforeAll`; the failure crashes the entire suite instead of skipping gracefully.
- **Handler ordering implications** — When a handler short-circuits with a 503 before auth checks, auth-focused tests become unreachable in a non-PG environment.

## Guidance

### 1. StoreContext mock updates are non-negotiable after interface changes

Every mock `StoreContext` in tests must include the new store key. Use `{} as never` as a safe placeholder for stores that aren't exercised by that specific test:

```typescript
const ctx: StoreContext = {
  ledger: {
    db: {} as never,
    path: ":memory:",
    close: ledgerClose
  },
  pg: {} as never,
  pgClient: { end: pgClientEnd } as never,
  candleStore: {} as never,
  insightsStore: {} as never,
  srThesesV2Store: {} as never
};
```

### 2. OpenAPI smoke test counts must match actual routes

Update both the `.toHaveLength(N)` count and the `expect.arrayContaining()` list when routes are added, in the same commit:

```typescript
expect(paths).toHaveLength(16);
expect(paths).toEqual(
  expect.arrayContaining([
    "/health",
    "/version",
    "/v1/openapi.json",
    "/v1/plan",
    "/v1/execution-result",
    "/v1/clmm-execution-result",
    "/v1/report/weekly",
    "/v1/sr-levels",
    "/v1/sr-levels/current",
    "/v1/candles",
    "/v1/regime/current",
    "/v1/insights/sol-usdc",
    "/v1/insights/sol-usdc/current",
    "/v1/insights/sol-usdc/history",
    "/v2/sr-levels",
    "/v2/sr-levels/current"
  ])
);
```

### 3. Use synchronous module-level detection + `describe.skipIf` for PG-dependent tests

**Do NOT** use `beforeAll` with async PG verification that throws — `beforeAll` failures cause suite failure, not graceful skip. Vitest shows them as failed, not skipped, which blocks PRs in CI.

**Do** use a synchronous try/catch at module level to set a boolean, then `describe.skipIf`:

```typescript
import { createDb } from "../../ledger/pg/db.js";
import { clmmInsights } from "../../ledger/pg/schema/index.js";

const PG_CONNECTION_STRING =
  process.env.DATABASE_URL ?? "postgres://test:test@localhost:5432/regime_engine_test";

let db: Db;
let pgClient: { end: () => Promise<void> };
let pgAvailable = false;

try {
  const result = createDb(PG_CONNECTION_STRING);
  db = result.db;
  pgClient = result.client;
} catch {
  pgAvailable = false;
}

const setupPg = describe.skipIf(!pgAvailable);

afterAll(async () => {
  if (pgClient) {
    await pgClient.end();
  }
});

setupPg("POST /v1/insights/sol-usdc (PG)", () => {
  it("returns 201 with created status on first ingest", async () => {
    // PG is guaranteed available here
  });
});
```

### 4. Handler ordering determines test placement

If a route handler checks service availability (503) **before** auth (401), then auth tests require the service to be available. Place tests accordingly:

- **Non-PG suite**: only 503 / service-unavailable tests
- **PG suite**: auth (401/500), validation (400), created (201), conflict (409), read (200/404) tests

```typescript
// Non-PG test — only tests reachable without the service
it("returns 503 when insights store is unavailable", async () => {
  process.env.LEDGER_DB_PATH = ":memory:";
  delete process.env.DATABASE_URL;
  const app = buildApp();

  const res = await app.inject({
    method: "POST",
    url: "/v1/insights/sol-usdc",
    payload: makePayload()
  });
  expect(res.statusCode).toBe(503);

  await app.close();
});
```

## Why This Matters

- **Mock propagation** — Without updating every mock, TypeScript errors block the build entirely. The `{} as never` pattern is a safe placeholder since tests that need real behavior use the PG suite.
- **Hardcoded counts** — Failing smoke tests on every route addition is avoidable friction. Always update counts and path lists in the same commit that adds routes.
- **Graceful skip vs crash** — A `beforeAll` throw makes the non-PG CI run **fail**, blocking all PRs. `describe.skipIf` produces a clear skip notice without failing the suite.
- **Handler ordering** — Understanding that 503-before-auth means auth tests need the service prevents writing unreachable test assertions that give false confidence. Tests that assert 401 when PG is down will see 503 instead.

## When to Apply

- Any time a new store or interface field is added to a shared context type used in test mocks
- Any time new HTTP routes are added that appear in OpenAPI docs
- Any time e2e tests are created that depend on Postgres (or any external service) in a repo where `pnpm run test` runs without that service
- Any time a route handler short-circuits on service unavailability before performing auth/validation checks
- When wiring a new store into `StoreContext` and `routes.ts`

## Examples

### Before (broken — `beforeAll` crash)

```typescript
import { createDb, verifyPgConnection } from "../../ledger/pg/db.js";

let db: Db;

beforeAll(async () => {
  const result = createDb(PG_CONNECTION_STRING);
  db = result.db;
  await verifyPgConnection(db);
  // Throws AggregateError: connect ECONNREFUSED ::1:5432
  // Entire suite FAILS, not skipped
});

it("should create an insight", async () => {
  // never reached — suite already failed
});
```

### After (fixed — graceful skip)

```typescript
let pgAvailable = false;
try {
  const result = createDb(PG_CONNECTION_STRING);
  db = result.db;
  pgClient = result.client;
} catch {
  pgAvailable = false;
}

const setupPg = describe.skipIf(!pgAvailable);

setupPg("Insights E2E (PG)", () => {
  it("should create an insight", async () => {
    // runs when PG is available, gracefully skipped when not
  });
});
```

### Before (broken — mock missing new field)

```typescript
const ctx: StoreContext = {
  ledger: { db: {} as never, path: ":memory:", close: () => {} },
  pg: {} as never,
  pgClient: { end: async () => {} } as never,
  candleStore: {} as never
  // TS2741: Property 'insightsStore' is missing in type '...'
};
```

### After (fixed)

```typescript
const ctx: StoreContext = {
  ledger: { db: {} as never, path: ":memory:", close: () => {} },
  pg: {} as never,
  pgClient: { end: async () => {} } as never,
  candleStore: {} as never,
  insightsStore: {} as never,
  srThesesV2Store: {} as never
};
```

### Before (broken — hardcoded count)

```typescript
expect(paths).toHaveLength(14); // fails: actual is 16 after adding 2 v2 routes
```

### After (fixed)

```typescript
expect(paths).toHaveLength(16);
expect(paths).toEqual(
  expect.arrayContaining([
    "/health",
    "/version",
    "/v1/openapi.json",
    "/v1/plan",
    "/v1/execution-result",
    "/v1/clmm-execution-result",
    "/v1/report/weekly",
    "/v1/sr-levels",
    "/v1/sr-levels/current",
    "/v1/candles",
    "/v1/regime/current",
    "/v1/insights/sol-usdc",
    "/v1/insights/sol-usdc/current",
    "/v1/insights/sol-usdc/history",
    "/v2/sr-levels",
    "/v2/sr-levels/current"
  ])
);
```

## Related

- [Health probe separation and coverage](../best-practices/health-probe-separation-and-coverage-2026-04-28.md) — Establishes the design decision that PG-down branches are covered by unit tests only; this doc provides the concrete `describe.skipIf` mechanism
- [Smoke tests runbook](../documentation-gaps/regime-engine-deploy-docs-smoke-tests-runbook-2026-04-19.md) — Covers OpenAPI presence assertions; this doc extends with the `toHaveLength` pitfall
- [Postgres schema isolation](../best-practices/postgres-schema-isolation-2026-04-28.md) — Defines `StoreContext` interface; this doc covers mock propagation when extending it
- [Additive v2 S/R thesis storage](../best-practices/additive-v2-sr-thesis-storage-2026-04-30.md) — The v2 routes that triggered the path count update (14→16) and StoreContext extension
- GitHub #20 — Add SOL/USDC CLMM insight ingestion and serving API
- GitHub #21 — v2 S/R Levels — Raw Thesis Storage Endpoint
