# Postgres Integration Design

> Issues: #22 (foundation), #20 (v2 S/R Levels), #21 (CLMM Insights)
> Date: 2026-04-28

## Problem

Regime Engine runs on Railway alongside clmm-v2, sharing a Postgres instance. Today all
data lives in SQLite — appropriate for the append-only plan/execution receipt ledger, but a
poor fit for future features that need JSONB, native arrays, indexing, and concurrent read
access from the CLMM Autopilot app. Issues #20 and #21 both require Postgres-native tables.

## Decision: Schema Isolation

- Regime Engine gets its own `regime_engine` schema on the shared Railway Postgres.
- clmm-v2 continues using `public` schema.
- SQLite stays for the append-only receipt ledger (no joins, no contention, no cross-query).

## Dependency Chain

```
#22  Postgres schema isolation (foundation)
 ├── #20  v2 S/R Levels — needs Postgres for sr_theses_v2
 └── #21  CLMM Insights — needs Postgres for clmm_insights
```

#20 and #21 are independent of each other after #22 lands.

---

## Architecture

### StoreContext

Both SQLite and Postgres stores will be used simultaneously. Rather than threading
two separate store arguments through every handler factory, introduce a unified
context object:

```ts
// src/ledger/storeContext.ts

interface StoreContext {
  ledger: LedgerStore;     // SQLite — append-only receipts, unchanged
  pg: Db;                  // Drizzle + postgres.js — new feature tables
}
```

Handler factories that only need SQLite (plan, execution-result, report) continue
accepting `LedgerStore`. New Postgres-backed handlers (#20, #21) accept
`StoreContext` or just `Db` depending on scope.

Migration path: `routes.ts` creates both stores, wraps them in `StoreContext`, and
passes the appropriate slice to each handler.

### Driver and ORM

**Parity with clmm-v2:**

- `postgres.js` (not `node-postgres/pg`) as the driver
- `drizzle-orm` with `drizzle-orm/postgres-js` adapter
- `drizzle-kit` for migrations

clmm-v2 uses this stack in `packages/adapters/src/outbound/storage/db.ts`:

```ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres = require('postgres');

export function createDb(connectionString: string) {
  const client = postgres(connectionString);
  return drizzle(client, { schema: { ... } });
}
```

Regime Engine will follow the same pattern.

### Schema File Organization

One Drizzle schema file per feature domain, not a monolithic file:

```
src/ledger/pg/
  db.ts                  # createDb() + Db type
  schema/
    index.ts             # re-exports all schema modules
    srThesesV2.ts        # #20 — sr_theses_v2 table
    clmmInsights.ts      # #21 — clmm_insights table
```

### Schema Isolation Config

**Decision: On-connect `SET search_path=regime_engine`, not URL params.**

URL query params for `search_path` are fragile — different drivers and URL parsers may
strip or ignore them. An explicit `SET search_path=regime_engine` on every new
connection is unambiguous, testable, and driver-agnostic.

`postgres.js` supports an `onconnect` callback. Run the SET there:

```ts
const client = postgres(connectionString, {
  onconnect: async (conn) => {
    await conn.unsafe('SET search_path=regime_engine');
  },
});
```

Fallback if `onconnect` isn't available: run `SET search_path=regime_engine` as the
first query after `createDb()` in the factory function.

The initial migration creates the schema itself:

```sql
CREATE SCHEMA IF NOT EXISTS regime_engine;
```

### Drizzle Config

```ts
// drizzle.config.ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/ledger/pg/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
    ssl: { rejectUnauthorized: false }, // Railway requires SSL
  },
});
```

### Migration Execution

**Decision: Separate `npm run db:migrate` command, not app-startup auto-migrate.**

Rationale:
- Explicit migration step is safer for production deploys.
- Matches Railway's pre-deploy hook pattern.
- Avoids race conditions if multiple instances start simultaneously.

Add to `railway.toml`:

```toml
[deploy]
preDeployCommand = "npm run db:migrate"
```

New scripts in `package.json`:

```json
{
  "db:migrate": "drizzle-kit migrate",
  "db:generate": "drizzle-kit generate",
  "db:push": "drizzle-kit push"
}
```

---

## Health Check and Degradation

### Health Endpoint Enhancement

`GET /health` should verify both stores are reachable:

```json
{
  "ok": true,
  "postgres": "ok",
  "sqlite": "ok"
}
```

On Postgres connection failure:

```json
{
  "ok": false,
  "postgres": "unavailable",
  "sqlite": "ok"
}
```

### Startup Behavior

**Decision: Hard fail on Postgres unreachable at startup.**

Rationale:
- Regime Engine is moving toward Postgres as a primary data store.
- Serving degraded responses silently is worse than failing loudly.
- Railway will restart the container; transient connection issues self-heal.
- A `HEALTHCHECK` + Railway restart policy handles recovery.

---

## Environment Variables

| Variable | Purpose | Example |
|---|---|---|
| `DATABASE_URL` | Postgres connection string (Railway provides this) | `postgres://user:pass@host:5432/railway` |
| `LEDGER_DB_PATH` | SQLite path (existing, unchanged) | `/data/ledger.sqlite` |
| `INSIGHT_INGEST_TOKEN` | Auth token for CLMM insights ingestion (#21) | (secret) |
| `OPENCLAW_INGEST_TOKEN` | Auth token for S/R levels ingestion (existing) | (secret) |
| `CLMM_INTERNAL_TOKEN` | Auth token for CLMM execution events (existing) | (secret) |

---

## Issue #22 Scope Boundary

#22 must be strictly limited to infrastructure. No endpoint logic.

Deliverables:
1. `src/ledger/pg/db.ts` — `createDb()` + `Db` type
2. `src/ledger/pg/schema/index.ts` — empty schema shell (re-exports nothing yet)
3. `src/ledger/storeContext.ts` — `StoreContext` type + factory
4. `drizzle.config.ts` — Drizzle Kit config
5. `drizzle/` — initial migration creating `regime_engine` schema
6. `package.json` — new deps (`drizzle-orm`, `postgres`, `drizzle-kit` devDep) + scripts
7. `routes.ts` — updated to create `StoreContext`
8. `GET /health` — enhanced with Postgres connectivity check
9. Startup hard-fail if Postgres unreachable
10. `railway.toml` — pre-deploy migration hook
11. README section on multi-schema architecture

NOT in scope for #22:
- `sr_theses_v2` table or `/v2/sr-levels` endpoints (#20)
- `clmm_insights` table or `/internal/insights/*` endpoints (#21)
- Any SQLite data migration

---

## Issue #20 Notes: v2 S/R Levels

- Postgres table `sr_theses_v2` in `regime_engine` schema (single flat table, one row per thesis)
- Native `TEXT[]` arrays for support_levels, resistance_levels, targets
- `pgTable()` definitions in `src/ledger/pg/schema/srThesesV2.ts`
- Idempotency: `(source, symbol, brief_id, asset, source_handle)` composite unique
- v1 `/v1/sr-levels` endpoint and SQLite tables remain unchanged
- Reuse `toCanonicalJson()` + `sha256Hex()` from `src/contract/v1/` for payload hashing

---

## Issue #21 Notes: CLMM Insights

- Postgres table `clmm_insights` in `regime_engine` schema (append-only, versioned)
- JSONB columns for `clmm_policy_json`, `levels_json`, `reasoning_json`, `source_refs_json`
- `pgTable()` definitions in `src/ledger/pg/schema/clmmInsights.ts`
- Idempotency by `run_id` — same as v1 pattern (200 idempotent, 409 conflict)
- Stale handling: explicit `{ status: "STALE", freshness: { stale: true } }` in GET response
- Auth: `X-Insight-Ingest-Token` header / `INSIGHT_INGEST_TOKEN` env var

---

## Connection Pooling

**Decision: Use postgres.js defaults (10 connections). Don't tune yet.**

Rationale:
- `postgres.js` built-in pooling defaults to 10, adequate for Railway's 1-2 vCPU.
- Regime Engine is a lightweight service — not a high-throughput API gateway.
- Add `PG_MAX_CONNECTIONS` env var as an escape hatch, but don't wire it up
  until there's evidence of pool starvation. YAGNI.

---

## Testing Strategy

| Layer | Approach |
|---|---|
| Contract/validation | Unit tests with Vitest, no DB needed |
| SQLite ledger | In-memory `:memory:` (existing pattern) |
| Postgres integration | Real Postgres via `docker-compose.test.yml` in CI |
| Drizzle schema | Drizzle's own `db:push` for dev; `db:migrate` for CI/prod |

**No in-memory Postgres substitute.** Array operators (`@>`) and JSONB queries must be
tested against a real Postgres to be trustworthy.

**Decision: docker-compose.test.yml, not testcontainers.**

Rationale:
- `testcontainers` introduces Docker-in-Docker complexity on some CI runners.
- A `docker-compose.test.yml` is dead simple: start, wait, test, tear down.
- Matches clmm-v2's approach.
- No extra Node dependency.

Add `docker-compose.test.yml`:

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: regime_engine_test
      POSTGRES_USER: test
      POSTGRES_PASSWORD: test
    ports:
      - "5432:5432"
```

Add `npm run test:pg` script that handles the lifecycle (start Postgres, run
`db:push`, run Vitest, tear down). This is separate from `npm run test` so the
default zero-dependency unit test story stays clean.

CI flow: `docker compose -f docker-compose.test.yml up -d` -> `npm run db:push`
-> `npm run test:pg` -> `docker compose -f docker-compose.test.yml down`.

---

## New Dependencies

| Package | Type | Version | Purpose |
|---|---|---|---|
| `drizzle-orm` | runtime | `^0.36.0` | ORM (parity with clmm-v2) |
| `postgres` | runtime | `^3.4.0` | postgres.js driver (parity with clmm-v2) |
| `drizzle-kit` | dev | `^0.31.10` | Migration tooling (parity with clmm-v2) |

No new runtime dependencies beyond these two.

---

## Resolved Questions

1. ~~**search_path reliability**~~: Resolved. Use on-connect `SET search_path=regime_engine`,
   not URL params. Explicit, testable, driver-agnostic.

2. ~~**Connection pooling**~~: Resolved. Use postgres.js defaults (10 connections).
   Don't tune until there's evidence of starvation. Add `PG_MAX_CONNECTIONS` env var
   as escape hatch only.

3. ~~**Testcontainers vs Docker Compose**~~: Resolved. Use `docker-compose.test.yml`,
   not testcontainers. Simpler, no extra dependency, no Docker-in-Docker issues.
   Add `npm run test:pg` separate from `npm run test`.