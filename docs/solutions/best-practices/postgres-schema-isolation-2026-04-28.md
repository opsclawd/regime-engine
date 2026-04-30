---
title: "Postgres Schema Isolation on Shared Instance Alongside SQLite"
date: "2026-04-28"
module: "ledger"
problem_type: "best_practice"
component: "postgres-schema-isolation"
resolution_type: "refactor"
tags:
  - postgres
  - drizzle
  - schema-isolation
  - shared-database
  - search-path
  - dual-store
  - railway
related_issues:
  - 22
  - 20
  - 21
related_docs:
  - fastify-sqlite-ingestion-endpoint-patterns-2026-04-18
  - regime-engine-deploy-docs-smoke-tests-runbook-2026-04-19
---

# Postgres Schema Isolation on Shared Instance Alongside SQLite

## Context

Regime Engine added Postgres alongside SQLite to support feature tables requiring JSONB, arrays, and concurrent reads. The integration happened on Railway's shared Postgres (also used by clmm-v2), requiring schema isolation. The team chose postgres.js + Drizzle ORM to match clmm-v2's stack. Several non-obvious pitfalls surfaced around driver configuration, migration scoping, dependency placement, and health-check honesty.

## Guidance

### 1. Use `connection.search_path` config, not `onconnect` hooks

postgres.js v3.4.x has no `onconnect` hook. Blog posts and AI suggestions commonly reference it, but it doesn't exist. Set the schema via the connection config object:

```typescript
const client = postgres(connectionString, {
  connection: {
    search_path: "regime_engine"
  }
});
```

Do NOT attempt:

```typescript
// Does not exist in v3.4.x
const client = postgres(connectionString, {
  onconnect: async (conn) => {
    await conn.query("SET search_path TO regime_engine");
  }
});
```

### 2. Scope Drizzle migration metadata per-service on shared Postgres

Drizzle defaults to `public.__drizzle_migrations`. On a shared database this causes migration-history collisions between services. Override both `schema` and `table`:

```typescript
// drizzle.config.ts
migrations: {
  schema: "regime_engine",
  table: "regime_engine_migrations"
}
```

### 3. Put `drizzle-kit` in `dependencies`, not `devDependencies`

Railway's `preDeployCommand` runs `npm run db:migrate` inside the production container, where `devDependencies` are excluded. If `drizzle-kit` is a devDependency, migrations silently skip or fail.

### 4. Return both connections from your DB factory

The raw postgres.js client is needed for graceful shutdown (`client.end()`). Return it alongside the Drizzle instance:

```typescript
export function createDb(connectionString: string): {
  db: ReturnType<typeof drizzle>;
  client: ReturnType<typeof postgres>;
} {
  const client = postgres(connectionString, {
    connection: { search_path: "regime_engine" }
  });
  const db = drizzle(client);
  return { db, client };
}
```

### 5. Use a StoreContext to unify dual stores

Don't pass two stores separately through every function. Bundle them:

```typescript
export interface StoreContext {
  ledger: LedgerStore; // SQLite — append-only receipts
  pg: Db; // Postgres — feature/query tables
  pgClient: { end: () => Promise<void> }; // for shutdown
}
```

### 6. Health checks must actually probe, not assume

**Before:**

```typescript
app.get("/health", async () => {
  return { ok: true }; // lies
});
```

**After:**

```typescript
app.get("/health", async () => {
  let sqliteOk = true;
  try {
    ledger.db.prepare("SELECT 1").get();
  } catch {
    sqliteOk = false;
  }

  let postgresStatus = pg ? "ok" : "not_configured";
  if (pg) {
    try {
      await pg.execute(sql`SELECT 1`);
    } catch {
      postgresStatus = "unavailable";
    }
  }

  return {
    ok: sqliteOk && postgresStatus !== "unavailable",
    postgres: postgresStatus,
    sqlite: sqliteOk ? "ok" : "unavailable"
  };
});
```

### 7. Fail fast at startup on missing Postgres connection

In production, `DATABASE_URL` is mandatory. Don't let the server start if Postgres is unreachable:

```typescript
if (pgConnectionString) {
  try {
    const { db: pg, client } = createDb(pgConnectionString);
    await verifyPgConnection(pg);
    await client.end();
  } catch (error) {
    console.error("FATAL: Postgres connection failed at startup. Exiting.", error);
    process.exit(1);
  }
}
```

## Why This Matters

- **Schema isolation** prevents cross-service data corruption and migration collisions on shared Postgres instances — a real risk on Railway/Render where databases are shared.
- **Honest health checks** prevent orchestrators from routing traffic to degraded nodes.
- **Startup hard-fail** avoids silent partial-functionality states that are harder to debug than a crashed pod.
- **Correct driver config** avoids chasing phantom APIs that don't exist in the version you're running.
- **`drizzle-kit` in `dependencies`** prevents silent migration failures in production containers that exclude devDependencies.

## When to Apply

- Adding a second data store (especially Postgres) alongside SQLite in a Node microservice
- Deploying to shared Postgres on PaaS platforms (Railway, Render, Supabase)
- Using Drizzle ORM with postgres.js in production
- Writing health endpoints that cover multiple persistence layers
- Running migrations as a `preDeployCommand` or similar production-lifecycle hook
- Any system where migration history must not collide across services sharing one database
