---
title: "Migrating SQLite Tables to Postgres via Drizzle ORM"
date: 2026-04-29
category: best-practices
module: ledger
problem_type: best_practice
component: database
severity: high
applies_when:
  - Migrating SQLite tables to Postgres with Drizzle ORM
  - Creating new Drizzle-managed tables in a non-default PG schema
  - Using raw SQL queries alongside Drizzle typed queries
tags:
  - drizzle-orm
  - postgres
  - sqlite-migration
  - advisory-lock
  - double-precision
  - schema-qualification
  - regime-engine
---

# Migrating SQLite Tables to Postgres via Drizzle ORM

## Context

When migrating candle storage from SQLite to PostgreSQL in the regime-engine project, several non-obvious pitfalls emerged around Drizzle ORM's schema handling, type precision, concurrency primitives, and query patterns. SQLite's implicit conventions (8-byte REAL, implicit table-level locking via `BEGIN IMMEDIATE`, untyped result columns) don't map directly to PostgreSQL — and the gaps only surfaced during a 4-person document review. This guidance captures the specific decisions and their rationale so future migrations don't repeat the same mistakes.

## Guidance

### 1. Use `pgSchema()` for schema-qualified DDL in Drizzle

Drizzle's `pgTable()` generates tables in the default `public` schema. To get `regime_engine.candle_revisions` in migrations, define the schema separately:

```typescript
import { pgSchema, serial, varchar, bigint, doublePrecision, text, uniqueIndex, index } from "drizzle-orm/pg-core";

export const regimeEngine = pgSchema("regime_engine");

export const candleRevisions = regimeEngine.table(
  "candle_revisions",
  {
    id: serial("id").primaryKey(),
    symbol: varchar("symbol", { length: 64 }).notNull(),
    open: doublePrecision("open").notNull(),
    // ...
  },
  (table) => [
    uniqueIndex("ux_candle_revisions_slot_hash").on(
      table.symbol, table.source, table.network,
      table.poolAddress, table.timeframe, table.unixMs, table.ohlcvHash
    ),
  ]
);
```

Plain `pgTable` won't generate the `regime_engine.` prefix in migration SQL. The `pgSchema` pattern is required for any table that must live in a non-default schema.

### 2. Use `doublePrecision` (not `real`) for columns migrated from SQLite `REAL`

SQLite's `REAL` type is 8-byte IEEE 754 double. PostgreSQL's `real` is 4-byte float (~7 significant digits). Using `real` silently truncates OHLCV values, which propagates into indicator calculations and regime classification:

```typescript
// WRONG — loses precision vs SQLite
high: real("high").notNull(),

// CORRECT — matches SQLite's 8-byte REAL
high: doublePrecision("high").notNull(),
```

This applies to any financial or scientific data where precision matters. The storage cost difference (4 vs 8 bytes per column) is negligible.

### 3. Pair advisory locks with unique indexes for write concurrency

PostgreSQL has no direct equivalent of SQLite's `BEGIN IMMEDIATE`. Use `pg_advisory_xact_lock` inside a transaction for per-feed serialization, **and** add a unique index as defense-in-depth:

```typescript
// Unique index prevents duplicates even from codepaths that skip the advisory lock
// (direct SQL, migration scripts, admin endpoints, application bugs)
CREATE UNIQUE INDEX ux_candle_revisions_slot_hash
  ON regime_engine.candle_revisions (symbol, source, network, pool_address, timeframe, unix_ms, ohlcv_hash);
```

```typescript
// Advisory lock inside transaction — serializes per-feed writes
await this.db.transaction(async (tx) => {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`);
  // ... insert/idempotent/revise/reject per candle
});
```

Advisory locks alone don't prevent duplicate inserts from non-CandleStore codepaths. The unique index is the hard constraint; advisory locks reduce contention and retry waste.

### 4. Derive advisory lock keys from SHA-256, not polynomial hashing

```typescript
import { sha256Hex } from "../contract/v1/hash.js";

const feedHash = (feed: Feed): bigint => {
  const combined = [feed.symbol, feed.source, feed.network, feed.poolAddress, feed.timeframe].join("\0");
  const hex = sha256Hex(combined);
  return BigInt("0x" + hex.slice(0, 15)) || 1n;
};
```

Polynomial hashes (e.g., Java's `String.hashCode()`) cluster at small bit widths. SHA-256 truncated to 60 bits (15 hex chars) provides near-uniform distribution for `int8` advisory lock keys while fitting comfortably in the positive `int8` range (0 to 2^63-1).

### 5. Raw SQL results return bigint columns as strings

Drizzle's `db.execute(sql\`...\`)` returns untyped rows. PostgreSQL bigint columns come back as strings, not numbers:

```typescript
const rows = await db.execute(sql`
  SELECT unix_ms, open, high, low, close, volume
    FROM regime_engine.candle_revisions
`);

return rows.map((row: Record<string, unknown>) => ({
  unixMs: Number(row.unix_ms),   // bigint → string → number
  open: Number(row.open),         // double precision → number (already correct, but be consistent)
  high: Number(row.high),
  low: Number(row.low),
  close: Number(row.close),
  volume: Number(row.volume),
}));
```

Always apply `Number()` coercion on any result column that might be bigint. This also applies to computed columns like `COUNT(*)` and `SUM()`.

### 6. Raw SQL bypasses Drizzle's schema qualification

When writing CTEs or subqueries with `sql` template literals, table names must be explicitly schema-qualified:

```typescript
// WRONG — Drizzle won't add schema prefix in raw SQL
FROM candle_revisions WHERE ...

// CORRECT — explicit schema qualification
FROM regime_engine.candle_revisions WHERE ...
```

Drizzle handles schema qualification for typed queries (`.from(candleRevisions)`) but not for raw SQL fragments.

### 7. Deployment-time fallback is not runtime fallback

When using optional store injection, the fallback is determined at startup:

```typescript
export function createCandlesIngestHandler(ledger: LedgerStore, candleStore?: CandleStore) {
  return async (req, res) => {
    const result = candleStore
      ? await candleStore.writeCandles(body, Date.now())   // PG path — async
      : writeCandles(ledger, body, Date.now());            // SQLite path — sync
  };
}
```

If `DATABASE_URL` is set but PG is unreachable at request time, every candle request fails with 500 — there is no runtime fallback to SQLite. Document this explicitly so operators understand the failure mode.

### 8. Export the schema object for Drizzle migration tracking

When using `pgSchema`, export the schema object from your schema index file so `drizzle-kit generate` can track it:

```typescript
// src/ledger/pg/schema/index.ts
export { candleRevisions, regimeEngine } from "./candleRevisions.js";
```

Without this export, Drizzle may generate `DROP SCHEMA` statements or fail to track the table in migration snapshots.

## Why This Matters

- **Precision loss** from `real` vs `doublePrecision` silently corrupts financial data — OHLCV values differ between SQLite and PG runs, cascading into regime misclassification.
- **Duplicate inserts** from non-advisory-lock codepaths violate the idempotency contract. The unique index is the single source of truth for uniqueness; advisory locks are a performance optimization.
- **Schema qualification** in raw SQL is a footgun because Drizzle handles it for typed queries but not for `sql` template literals. Missed qualification causes `relation does not exist` errors in production.
- **BigInt-as-string** from raw SQL queries is an easy runtime crash to miss in tests with small counts but surfaces in production with large values.
- **Deployment-time fallback** is not runtime fallback. Operators expecting graceful SQLite degradation when PG is unavailable get 500s instead.

## When to Apply

- Any new Drizzle-managed table that must live in a non-default PG schema
- Any column migrated from SQLite `REAL` to PostgreSQL — use `doublePrecision`
- Any concurrent write path needing serialization — use advisory locks **plus** unique indexes
- Any advisory lock key derivation — use SHA-256 (or similar cryptographic hash), not polynomial hashing
- Any `db.execute(sql\`...\`)` query — assume all columns are untyped; coerce accordingly
- Any raw SQL referencing schema-qualified tables — explicitly include the schema prefix
- Any handler with optional store injection — document whether fallback is runtime or deployment-time

## Examples

### Before (SQLite — implicit assumptions)

```typescript
// Schema: no explicit schema — SQLite has none
const candles = sqliteTable("candle_revisions", {
  open: real("open").notNull(),  // 8-byte double in SQLite
});

// Concurrency: BEGIN IMMEDIATE
store.db.exec("BEGIN IMMEDIATE");

// Queries: no schema prefix, no type coercion
const row = store.db.prepare("SELECT unix_ms FROM candle_revisions").get();
// row.unix_ms is a number
```

### After (PG via Drizzle — explicit everything)

```typescript
// Schema: pgSchema for schema-qualified DDL
const regimeEngine = pgSchema("regime_engine");
const candleRevisions = regimeEngine.table("candle_revisions", {
  open: doublePrecision("open").notNull(),  // matches SQLite's 8-byte REAL
});

// Concurrency: advisory lock + unique index
await db.transaction(async (tx) => {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`);
  // ...
});

// Queries: schema-qualified, type-coerced
const rows = await db.execute(sql`
  SELECT unix_ms FROM regime_engine.candle_revisions
`);
const unixMs = Number(rows[0].unix_ms);
```

## Related

- `docs/solutions/best-practices/postgres-schema-isolation-2026-04-28.md` — PG schema isolation pattern, StoreContext, Drizzle migration setup, and connection configuration
- `docs/solutions/best-practices/fastify-sqlite-ingestion-endpoint-patterns-2026-04-18.md` — SQLite transaction patterns being replaced (receipts remain on SQLite)
- Issue #23: Migrate candle storage from SQLite to Railway Postgres
- [Drizzle ORM schemas](https://orm.drizzle.team/docs/schemas)
- [PostgreSQL advisory locks](https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS)