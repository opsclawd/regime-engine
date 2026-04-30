# Health Probe Refactor, Test Coverage, and Connection Hardening

**Issue:** #25
**Date:** 2026-04-28
**Status:** Approved

## Problem

After the m022 Postgres integration, several residual issues exist in the `/health` endpoint and store initialization:

1. **No test coverage** for `postgres:"unavailable"` or `sqlite:"unavailable"` health branches — a refactoring that changes health logic could silently break them.
2. **No query timeout on PG health probe** — if Postgres is slow (not down), the health check hangs indefinitely.
3. **Inline SQL in routes.ts** — PG and SQLite health checks are DB-layer concerns that belong in `src/ledger/`, not the HTTP handler (violates AGENTS.md boundaries).
4. **No schema existence verification** — `SELECT 1` succeeds against the default schema even if `regime_engine` doesn't exist. The service would start healthy but all queries would fail with "relation not found".
5. **No SQLite `busy_timeout`** — under concurrent access, SQLite returns `SQLITE_BUSY` immediately instead of retrying.

## Design Decisions

| Decision                 | Choice                                                       | Rationale                                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where health probes live | `src/ledger/health.ts` (single module)                       | Both are storage-layer concerns; neither is complex enough for its own file. Routes imports from one place.                                                           |
| `busy_timeout` location  | `createLedgerStore` in `store.ts`                            | Must apply regardless of standalone vs StoreContext usage. Set immediately after `new DatabaseSync()`.                                                                |
| PG health probe timeout  | Rely on postgres.js `connect_timeout: 10`                    | Already configured in `createDb`. No extra `Promise.race` complexity needed — health check inherits the same timeout semantics as every other query.                  |
| Schema verification      | Separate `verifyPgSchema` function                           | Clear separation: `verifyPgConnection` = "can I talk to Postgres?", `verifyPgSchema` = "does our schema exist?". Startup fails fast with a specific error if missing. |
| Test strategy            | HTTP-level tests with mocked stores using Fastify `inject()` | Consistent with existing test pattern. Tests the full HTTP + health logic path without needing real DB connections.                                                   |

## Specification

### 1. Health probe extraction — `src/ledger/health.ts`

New module with two functions:

```ts
export const checkSqliteHealth = (
  ledger: LedgerStore
): { ok: boolean; status: "ok" | "unavailable" }

export const checkPgHealth = async (
  pg: Db | null
): Promise<{ ok: boolean; status: "ok" | "unavailable" | "not_configured" }>
```

- `checkSqliteHealth` wraps `ledger.db.prepare("SELECT 1").get()` in try/catch. Returns `{ ok: true, status: "ok" }` on success, `{ ok: false, status: "unavailable" }` on error.
- `checkPgHealth` takes a nullable `Db`. If null, returns `{ ok: true, status: "not_configured" }`. If present, wraps `pg.execute(sql\`SELECT 1\`)`in try/catch, returning`{ ok: true, status: "ok" }`or`{ ok: false, status: "unavailable" }`.
- Timeout protection comes from postgres.js's `connect_timeout: 10` already configured in `createDb` — no additional `Promise.race` needed.

**Change in `routes.ts`:** The `/health` handler calls `checkSqliteHealth(ledger)` and `await checkPgHealth(pg)`, removing all inline SQL from the HTTP layer.

### 2. Schema existence verification — `src/ledger/pg/db.ts`

New exported function:

```ts
export const verifyPgSchema = async (db: Db): Promise<void>
```

- Queries `SELECT nspname FROM pg_namespace WHERE nspname = 'regime_engine'`.
- Throws an `Error` with message `"FATAL: regime_engine schema not found in Postgres"` if no row returned.
- Returns void on success.

**Change in `server.ts`:** Startup sequence becomes:

1. `verifyPgConnection(pg)` — can I talk to Postgres?
2. `verifyPgSchema(pg)` — does our schema exist?
3. Close the verification client
4. Start the app

### 3. SQLite `busy_timeout` — `src/ledger/store.ts`

Add `PRAGMA busy_timeout = 2000` immediately after `new DatabaseSync(databasePath)` and before the schema init:

```ts
const db = new DatabaseSync(databasePath);
db.exec("PRAGMA busy_timeout = 2000");
db.exec(resolveSchemaSql());
```

The 2000ms value gives concurrent access a reasonable retry window instead of failing immediately with `SQLITE_BUSY`.

### 4. Test coverage — `src/http/__tests__/health.probe.test.ts`

Tests use Fastify `inject()` with mocked store dependencies:

| Test case                   | Setup                                  | Expected response                                               | Expected status |
| --------------------------- | -------------------------------------- | --------------------------------------------------------------- | --------------- |
| Both healthy                | Normal stores                          | `{ ok: true, postgres: "ok", sqlite: "ok" }`                    | 200             |
| SQLite down                 | `ledger.db.prepare` throws             | `{ ok: false, postgres: "ok", sqlite: "unavailable" }`          | 503             |
| PG down                     | `pg.execute` rejects                   | `{ ok: false, postgres: "unavailable", sqlite: "ok" }`          | 503             |
| PG not configured           | No DATABASE_URL                        | `{ ok: true, postgres: "not_configured", sqlite: "ok" }`        | 200             |
| Both down                   | Both probes fail                       | `{ ok: false, postgres: "unavailable", sqlite: "unavailable" }` | 503             |
| `closeStoreContext` cleanup | Mock `ledger.close` and `pgClient.end` | Both called, even if one throws                                 | n/a             |

Mocking approach: spy on `ledger.db.prepare` to throw for SQLite failures; use a mock `Db` object with an `execute` method that rejects for PG failures.

### 5. What stays the same

- `/health` response shape: `{ ok, postgres, sqlite }` — no contract changes
- HTTP 503 when `ok === false`, 200 otherwise — already implemented
- `StoreContext` interface — unchanged
- `verifyPgConnection` — unchanged (new `verifyPgSchema` is additive)
- `closeStoreContext` — already has try/finally, just needs the test
- Existing happy-path `/health` tests — unchanged

## Out of scope

- Startup connection reuse (deferred until #20/#21 land)
- PG health probe `Promise.race` timeout (postgres.js `connect_timeout` is sufficient)
- Changes to engine, contract, or handler layers

## Acceptance criteria

- [ ] All four health branches (sqlite ok/unavailable × pg ok/unavailable/not_configured) have test coverage
- [ ] `closeStoreContext` test verifies both stores are cleaned up
- [ ] PG health probe relies on postgres.js `connect_timeout` (no extra timeout wrapper)
- [ ] SQLite has `PRAGMA busy_timeout = 2000` set on connection
- [ ] `verifyPgSchema` checks that `regime_engine` schema exists
- [ ] No inline SQL in `/health` route handler — probes delegated to `src/ledger/health.ts`
- [ ] `npm run typecheck && npm run test && npm run lint && npm run build` all pass
