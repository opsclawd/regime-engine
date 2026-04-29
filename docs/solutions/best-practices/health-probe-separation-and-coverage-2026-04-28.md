---
title: Health probe separation, test coverage for degraded states, and connection hardening for dual-store microservices
date: 2026-04-28
category: best-practices
module: ledger
problem_type: best_practice
component: database
severity: medium
applies_when:
  - Adding or refactoring health endpoints that probe multiple storage backends
  - Setting up SQLite for production workloads with concurrent access
  - Connecting to a managed Postgres with schema isolation
  - Testing degraded-state branches in services with dual stores
tags: [health-check, test-coverage, separation-of-concerns, postgres, sqlite, busy-timeout, schema-verification]
---

# Health probe separation, test coverage for degraded states, and connection hardening

## Context

After integrating Postgres as a storage backend alongside SQLite in the regime-engine microservice (Issue #22, PR #24), several residual issues emerged that are common to any dual-store setup:

1. **No test coverage for degraded health states** — what happens when postgres is unavailable? When sqlite is unavailable?
2. **Inline SQL in HTTP route handler** — violates the architecture boundary per AGENTS.md (no DB logic in `src/http/`)
3. **No schema existence verification** — `SELECT 1` succeeds even if the `regime_engine` schema is missing, giving a false "healthy" signal
4. **No SQLite `busy_timeout`** — under contention, SQLite returns `SQLITE_BUSY` immediately rather than waiting, causing transient failures

These issues are insidious because they only manifest in edge cases: degraded stores, contended workloads, and misconfigured databases.

## Guidance

### 1. Extract health probes into a dedicated storage-layer module

Health checks are storage-layer concerns. Put them in a single module alongside your other ledger code, not in HTTP handlers.

```typescript
// src/ledger/health.ts
import { sql } from "drizzle-orm/sql";
import type { LedgerStore } from "./store.js";
import type { Db } from "./pg/db.js";

export interface SqliteHealthResult {
  ok: boolean;
  status: "ok" | "unavailable";
}

export interface PgHealthResult {
  ok: boolean;
  status: "ok" | "unavailable" | "not_configured";
}

export const checkSqliteHealth = (ledger: LedgerStore): SqliteHealthResult => {
  try {
    ledger.db.prepare("SELECT 1").get();
    return { ok: true, status: "ok" };
  } catch {
    return { ok: false, status: "unavailable" };
  }
};

export const checkPgHealth = async (pg: Db | null): Promise<PgHealthResult> => {
  if (pg === null) {
    return { ok: true, status: "not_configured" };
  }
  try {
    await pg.execute(sql`SELECT 1`);
    return { ok: true, status: "ok" };
  } catch {
    return { ok: false, status: "unavailable" };
  }
};
```

**Why a single module:** Both checks are storage-layer concerns. `src/ledger/` is already authoritative for storage. Putting both probes here keeps the boundary clean and makes it easy to add more stores later.

### 2. Keep the HTTP handler thin

The `/health` handler calls the health module — no SQL, no try/catch, no database imports:

```typescript
// src/http/routes.ts
import { checkSqliteHealth, checkPgHealth } from "../ledger/health.js";

app.get("/health", async (_req, reply: FastifyReply) => {
  const sqlite = checkSqliteHealth(ledger);
  const postgres = await checkPgHealth(pg);

  const ok = sqlite.ok && postgres.ok;
  if (!ok) {
    reply.code(503);
  }

  return { ok, postgres: postgres.status, sqlite: sqlite.status };
});
```

### 3. Add `busy_timeout` at database creation time

Set `PRAGMA busy_timeout` immediately after creating the SQLite connection — in `createLedgerStore`, not just in `StoreContext`. This ensures the timeout applies in all code paths.

```typescript
// src/ledger/store.ts
export const createLedgerStore = (databasePath: string): LedgerStore => {
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA busy_timeout = 2000");
  db.exec(resolveSchemaSql());
  return { db, path: databasePath, close: () => { db.close(); } };
};
```

**Why 2000ms:** Enough for brief write contention; short enough to fail fast under genuine lock starvation. Pragmatic default — tune per-workload.

### 4. Verify the Postgres schema exists at startup

A working connection doesn't mean the schema exists. Add a dedicated `verifyPgSchema` function that checks `pg_namespace` and exits fatally if missing.

```typescript
// src/ledger/pg/db.ts
export const verifyPgSchema = async (db: Db): Promise<void> => {
  const result = await db.execute(
    sql`SELECT nspname FROM pg_namespace WHERE nspname = 'regime_engine'`
  );
  if (result.length === 0) {
    throw new Error("FATAL: regime_engine schema not found in Postgres");
  }
};
```

Wire into `server.ts` after `verifyPgConnection`:

```typescript
await verifyPgConnection(pg);
await verifyPgSchema(pg);
```

**Why a separate function:** `verifyPgConnection` confirms the database is reachable; `verifyPgSchema` confirms it's correctly configured. They test different things and fail for different reasons. Merge them and you lose the ability to report which specific problem occurred.

**Why fatal exit:** A schema-missing state means the service can't function. Better to fail loudly at startup than to serve degraded responses silently.

### 5. Rely on connection timeouts for PG health probes

Don't wrap PG health probes in `Promise.race` with a custom timeout. Instead, configure `connect_timeout` on the postgres.js client:

```typescript
const client = postgres(connectionString, {
  connect_timeout: 10,
  // ...
});
```

This keeps the health probe synchronous and simple. The connection timeout handles the "PG is unreachable" case without racing promises.

### 6. Test all health branches — unit tests for logic, HTTP tests for integration

**Unit tests** cover all 5 branches (sqlite-ok, sqlite-unavailable, pg-ok, pg-unavailable, pg-not_configured) using mocked stores:

```typescript
// src/ledger/__tests__/health.test.ts
describe("checkSqliteHealth", () => {
  it("returns ok when SELECT 1 succeeds", () => { /* mock */ });
  it("returns unavailable when SELECT 1 throws", () => { /* mock */ });
});

describe("checkPgHealth", () => {
  it("returns not_configured when pg is null", async () => { /* null */ });
  it("returns ok when pg.execute succeeds", async () => { /* mock */ });
  it("returns unavailable when pg.execute rejects", async () => { /* mock */ });
});
```

**HTTP-level integration test** for SQLite branches using Fastify `inject()` with real in-memory SQLite:

```typescript
// src/http/__tests__/health.probe.test.ts
it("returns 200 with postgres=not_configured, sqlite=ok", async () => {
  process.env.LEDGER_DB_PATH = ":memory:";
  delete process.env.DATABASE_URL;
  const app = Fastify({ logger: false });
  registerRoutes(app);
  const response = await app.inject({ method: "GET", url: "/health" });
  expect(response.json()).toEqual({ ok: true, postgres: "not_configured", sqlite: "ok" });
});
```

**Design decision:** PG-down branches are covered by unit tests only. Real in-memory SQLite covers the sqlite branches at both unit and HTTP level. This avoids requiring a running Postgres for CI while still testing all logic.

### 7. Test try/finally cleanup in StoreContext

```typescript
// src/ledger/__tests__/storeContext.test.ts
it("closeStoreContext closes pgClient even if ledger.close throws", async () => {
  const ledgerClose = vi.fn(() => { throw new Error("ledger close failed"); });
  const pgClientEnd = vi.fn();
  const ctx = { ledger: { db: {} as never, path: ":memory:", close: ledgerClose },
                pg: {} as never, pgClient: { end: pgClientEnd } as never };
  await expect(closeStoreContext(ctx)).rejects.toThrow("ledger close failed");
  expect(pgClientEnd).toHaveBeenCalledOnce();
});
```

## Why This Matters

| Issue | Impact | Mitigation |
|-------|--------|------------|
| Inline SQL in route handler | Violates architecture boundary; makes health logic untestable in isolation | Extract to `src/ledger/health.ts` |
| Missing `busy_timeout` | `SQLITE_BUSY` under any write contention → transient 500s | `PRAGMA busy_timeout = 2000` |
| No schema verification | Service appears healthy but can't actually read/write data | `verifyPgSchema` at startup → fatal |
| Untested health branches | Degraded states only discovered in production | Unit tests for all 5 branches + HTTP integration test |
| Missing cleanup on error | Database connections leak on exceptions | `try/finally` in `closeStoreContext` with test |

These patterns compound: a health endpoint that can't detect a missing schema gives false confidence, and missing `busy_timeout` makes the "healthy" database fail under load. Each gap is small in isolation but together they create a service that appears healthy while being functionally broken.

## When to Apply

- **Any microservice with multiple storage backends** — the dual-path health check pattern applies whenever you have more than one data store
- **SQLite in production** — always set `busy_timeout` before any queries; 2000ms is a reasonable default
- **Managed Postgres with schema isolation** — always verify schema existence at startup; managed databases can be recreated empty
- **Thin HTTP handlers** — whenever you see SQL or store-specific logic in a route handler, extract it to the storage layer
- **Health endpoints that matter** — if `/health` drives load balancer decisions or Kubernetes probes, every branch must be tested

## Examples

### Before: Inline SQL in route handler

```typescript
// src/http/routes.ts — SQL embedded in HTTP layer, untested branches
app.get("/health", async (_req, reply) => {
  let sqliteOk = true;
  try { ledger.db.prepare("SELECT 1").get(); } catch { sqliteOk = false; }
  let postgresStatus = pg ? "ok" : "not_configured";
  if (pg) { try { await pg.execute(sql`SELECT 1`); } catch { postgresStatus = "unavailable"; } }
  return { ok: sqliteOk && postgresStatus !== "unavailable", postgres: postgresStatus, sqlite: sqliteOk ? "ok" : "unavailable" };
});
```

Problems: SQL in HTTP layer, no `busy_timeout`, no schema check, untested branches.

### After: Clean architecture with full coverage

```typescript
// src/ledger/health.ts — single module, both probes
export const checkSqliteHealth = (ledger: LedgerStore): SqliteHealthResult => { /* ... */ };
export const checkPgHealth = async (pg: Db | null): Promise<PgHealthResult> => { /* ... */ };

// src/ledger/store.ts — busy_timeout at creation
const db = new DatabaseSync(databasePath);
db.exec("PRAGMA busy_timeout = 2000");

// src/ledger/pg/db.ts — schema verification
export const verifyPgSchema = async (db: Db): Promise<void> => { /* ... */ };

// src/http/routes.ts — thin handler, no SQL
app.get("/health", async (_req, reply) => {
  const sqlite = checkSqliteHealth(ledger);
  const postgres = await checkPgHealth(pg);
  const ok = sqlite.ok && postgres.ok;
  if (!ok) { reply.code(503); }
  return { ok, postgres: postgres.status, sqlite: sqlite.status };
});
```

Result: architecture boundary respected, all 5 branches tested, connection-hardened, schema-verified at startup.

## Related

- [Postgres schema isolation pattern](./postgres-schema-isolation-2026-04-28.md) — the precursor that created the dual-store architecture this solution hardens
- GitHub Issue [#25](https://github.com/opsclawd/regime-engine/issues/25) — Health probe refactor, test coverage for degraded states, and connection hardening
- GitHub Issue [#22](https://github.com/opsclawd/regime-engine/issues/22) — Postgres schema isolation (closed, implemented in PR #24)