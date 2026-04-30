# Design: Migrate Candle Storage from SQLite to Postgres

**Date:** 2026-04-28
**Status:** Reviewed — updated per document review
**Origin:** GitHub issue #23 — _Migrate candle storage from SQLite to Postgres_
**Target repo:** `regime-engine`

---

## 1. Problem

Candle data (`candle_revisions` table) is stored in SQLite alongside receipt/audit tables (`plan_requests`, `plans`, `execution_results`). SQLite's single-writer `BEGIN IMMEDIATE` lock serializes all candle writes for the entire database, blocking concurrent feeds. As the system scales to multiple feeds, SQLite becomes a bottleneck for candle ingestion throughput.

The Postgres integration (PR #24) is already in place for general infrastructure, but no tables or queries have been defined yet. Candle storage is the first workload to migrate.

## 2. Goals

- Move all candle reads and writes from SQLite to Postgres via Drizzle ORM.
- Replace `BEGIN IMMEDIATE` with per-feed advisory locking for concurrent-write correctness.
- Preserve the append-only revision model (same write-decision tree, same read query semantics).
- Keep SQLite for all non-candle tables (receipts, SR levels, CLMM events).
- Ensure the system degrades gracefully: if `DATABASE_URL` is not set, candle operations fall back to SQLite (backward compat during rollout).

## 3. Non-Goals

1. **Migrate other tables.** Receipts, SR levels, and CLMM events stay on SQLite for this issue.
2. **Backfill historical data.** Postgres `candle_revisions` starts empty; old SQLite data remains accessible but is not migrated.
3. **Change the HTTP contract.** Request/response shapes for `POST /v1/candles` and `GET /v1/regime/current` are unchanged.
4. **Change the write-decision tree.** The per-slot insert/idempotent/revise/reject logic is identical; only the storage backend changes.
5. **Add new endpoints.** No new HTTP routes in this issue.

## 4. Architecture

```
Before (SQLite only):

  POST /v1/candles
    -> candlesWriter.writeCandles(store: LedgerStore)
    -> SQLite BEGIN IMMEDIATE
    -> INSERT into candle_revisions
    -> COMMIT

  GET /v1/regime/current
    -> candlesWriter.getLatestCandlesForFeed(store: LedgerStore)
    -> SELECT from candle_revisions (SQLite)

After (PG-primary with SQLite fallback):

  POST /v1/candles
    -> CandleStore.writeCandles (PG) if available
    -> else candlesWriter.writeCandles (SQLite)

  GET /v1/regime/current
    -> CandleStore.getLatestCandlesForFeed (PG) if available
    -> else candlesWriter.getLatestCandlesForFeed (SQLite)
```

The `CandleStore` class is the new PG-native data access layer. Handler injection is optional — if `DATABASE_URL` is absent, the system operates exactly as before.

### 4.1 Advisory locking

SQLite's `BEGIN IMMEDIATE` acquires a database-wide write lock. Postgres advisory locks are scoped to a single `bigint` key, allowing concurrent writes to different feeds while serializing writes to the same feed.

Advisory lock key derivation:

- Compute from `(symbol, source, network, poolAddress, timeframe)` — the five fields that uniquely identify a logical feed.
- Use `pg_advisory_xact_lock(hashbigint)` where `hashbigint` is derived deterministically from the concatenation of the five feed fields.
- `pg_advisory_xact_lock` is transaction-scoped: auto-released on `COMMIT` or `ROLLBACK`. No explicit unlock needed.

### 4.2 What stays untouched

- `src/engine/` — pure core, no DB knowledge.
- `src/ledger/writer.ts`, `src/ledger/srLevelsWriter.ts` — remain SQLite-only.
- `src/ledger/candlesWriter.ts` — preserved as the SQLite fallback; not deleted or modified beyond what's needed for the optional injection.
- HTTP contract types and validation — unchanged.

### 4.3 Hard rules

- Append-only revision model preserved.
- No on-chain code, no Solana RPC.
- Determinism: same write-decision tree, same read-query semantics.
- `CandleStore` is the sole authority for candle data when PG is available.

## 5. Drizzle schema

### 5.1 New file: `src/ledger/pg/schema/candleRevisions.ts`

```ts
import {
  pgTable,
  serial,
  varchar,
  bigint,
  doublePrecision,
  text,
  index,
  uniqueIndex
} from "drizzle-orm/pg-core";

export const candleRevisions = pgTable(
  "candle_revisions",
  {
    id: serial("id").primaryKey(),
    symbol: varchar("symbol", { length: 64 }).notNull(),
    source: varchar("source", { length: 64 }).notNull(),
    network: varchar("network", { length: 64 }).notNull(),
    poolAddress: varchar("pool_address", { length: 128 }).notNull(),
    timeframe: varchar("timeframe", { length: 16 }).notNull(),
    unixMs: bigint("unix_ms", { mode: "number" }).notNull(),
    sourceRecordedAtIso: varchar("source_recorded_at_iso", { length: 64 }).notNull(),
    sourceRecordedAtUnixMs: bigint("source_recorded_at_unix_ms", { mode: "number" }).notNull(),
    open: doublePrecision("open").notNull(),
    high: doublePrecision("high").notNull(),
    low: doublePrecision("low").notNull(),
    close: doublePrecision("close").notNull(),
    volume: doublePrecision("volume").notNull(),
    ohlcvCanonical: text("ohlcv_canonical").notNull(),
    ohlcvHash: varchar("ohlcv_hash", { length: 64 }).notNull(),
    receivedAtUnixMs: bigint("received_at_unix_ms", { mode: "number" }).notNull()
  },
  (table) => [
    uniqueIndex("ux_candle_revisions_slot_hash").on(
      table.symbol,
      table.source,
      table.network,
      table.poolAddress,
      table.timeframe,
      table.unixMs,
      table.ohlcvHash
    ),
    index("idx_candle_revisions_slot_latest").on(
      table.symbol,
      table.source,
      table.network,
      table.poolAddress,
      table.timeframe,
      table.unixMs,
      table.sourceRecordedAtUnixMs,
      table.id
    ),
    index("idx_candle_revisions_feed_window").on(
      table.symbol,
      table.source,
      table.network,
      table.poolAddress,
      table.timeframe,
      table.unixMs
    )
  ]
);
```

Column types map to PG as:

- `serial` → `SERIAL` (auto-increment PK)
- `varchar` with length → `VARCHAR(n)`
- `bigint` with `mode: "number"` → `BIGINT` stored as 8-byte integer, read/written as JS `number`
- `doublePrecision` → `DOUBLE PRECISION` (8-byte float, matching SQLite's `REAL` behavior)
- `text` → `TEXT`

The `bigint` columns (`unixMs`, `sourceRecordedAtUnixMs`, `receivedAtUnixMs`) use `mode: "number"` so Drizzle returns JS `number` values, matching the existing `CandleRow` interface which uses `number` fields. PG `BIGINT` range exceeds JS `MAX_SAFE_INTEGER`, but candle timestamps are well within safe-integer range (millisecond epochs ~1.7×10^12 vs ~9×10^15 for `MAX_SAFE_INTEGER`).

OHLCV columns use `doublePrecision` (8-byte float) to match SQLite's `REAL` behavior (also 8-byte double). Using PG `real` (4-byte float) would truncate 15-16 significant digits to 6-7, silently degrading indicator inputs and potentially causing regime misclassification. `doublePrecision` preserves parity with SQLite.

The unique index `ux_candle_revisions_slot_hash` provides defense-in-depth against duplicate inserts from any codepath (application bugs, admin scripts, direct SQL). The advisory lock serializes concurrent writes per-feed, while the unique constraint guarantees data integrity even if a codepath bypasses the lock. `ON CONFLICT DO NOTHING` is not needed for normal operation — the lock prevents races, and the constraint catches anomalies.

The two composite indexes mirror the SQLite `idx_candle_revisions_slot_latest` and `idx_candle_revisions_feed_window` indexes, supporting the per-slot latest-revision lookup and the feed-window read query respectively.

### 5.2 Schema index update: `src/ledger/pg/schema/index.ts`

```ts
export { candleRevisions } from "./candleRevisions.js";
```

### 5.3 Migration

Generated via `npx drizzle-kit generate` → `drizzle/0001_create_candle_revisions.sql`.

Applied in production by Railway's `preDeployCommand: npx drizzle-kit migrate` (already configured in `drizzle.config.ts`).

The migration SQL creates the table and indexes in the `regime_engine` schema (set by `search_path` in the PG connection).

### 5.4 Unique index restored

The original SQLite schema includes `ux_candle_revisions_slot_hash` for idempotency enforcement. The PG migration **restores this unique constraint** as defense-in-depth alongside the advisory lock:

1. The advisory lock serializes concurrent writes per-feed, eliminating the race condition.
2. The application-level idempotency check (matching `ohlcv_hash`) runs inside the locked transaction.
3. The unique constraint catches duplicate inserts from any codepath that bypasses `CandleStore` — admin scripts, migration tools, or application bugs that skip the advisory lock.

If a duplicate insert violates the constraint, the transaction rolls back. This is the correct behavior for an invariant violation — fail loudly rather than silently corrupt data.

## 6. CandleStore class

### 6.1 New file: `src/ledger/candleStore.ts`

```ts
import { eq, and, desc, sql } from "drizzle-orm";
import { candleRevisions } from "./pg/schema/candleRevisions.js";
import type { Db } from "./pg/db.js";
import { toCanonicalJson } from "../contract/v1/canonical.js";
import { sha256Hex } from "../contract/v1/hash.js";
import type {
  CandleIngestRequest,
  CandleIngestRejection,
  CandleIngestResponse
} from "../contract/v1/types.js";

export class CandleStore {
  constructor(private db: Db) {}
}
```

### 6.2 `writeCandles` method

```ts
async writeCandles(
  input: CandleIngestRequest,
  receivedAtUnixMs: number
): Promise<Omit<CandleIngestResponse, "schemaVersion">> {
  const incomingSourceRecordedAtUnixMs = Date.parse(input.sourceRecordedAtIso);
  if (!Number.isFinite(incomingSourceRecordedAtUnixMs)) {
    throw new Error(`Invalid sourceRecordedAtIso: ${input.sourceRecordedAtIso}`);
  }

  const feed = {
    symbol: input.symbol,
    source: input.source,
    network: input.network,
    poolAddress: input.poolAddress,
    timeframe: input.timeframe,
  };

  const lockKey = feedHash(feed);

  let insertedCount = 0;
  let revisedCount = 0;
  let idempotentCount = 0;
  let rejectedCount = 0;
  const rejections: CandleIngestRejection[] = [];

  await this.db.transaction(async (tx) => {
    // Acquire per-feed advisory lock (transaction-scoped, auto-released)
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`);

    for (const candle of input.candles) {
      const { ohlcvCanonical, ohlcvHash } = computeOhlcv(candle);

      const existing = await tx
        .select({
          sourceRecordedAtUnixMs: candleRevisions.sourceRecordedAtUnixMs,
          sourceRecordedAtIso: candleRevisions.sourceRecordedAtIso,
          ohlcvHash: candleRevisions.ohlcvHash,
        })
        .from(candleRevisions)
        .where(and(
          eq(candleRevisions.symbol, feed.symbol),
          eq(candleRevisions.source, feed.source),
          eq(candleRevisions.network, feed.network),
          eq(candleRevisions.poolAddress, feed.poolAddress),
          eq(candleRevisions.timeframe, feed.timeframe),
          eq(candleRevisions.unixMs, candle.unixMs),
        ))
        .orderBy(
          desc(candleRevisions.sourceRecordedAtUnixMs),
          desc(candleRevisions.id)
        )
        .limit(1);

      if (existing.length === 0) {
        await tx.insert(candleRevisions).values({
          ...feed,
          unixMs: candle.unixMs,
          sourceRecordedAtIso: input.sourceRecordedAtIso,
          sourceRecordedAtUnixMs: incomingSourceRecordedAtUnixMs,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
          ohlcvCanonical,
          ohlcvHash,
          receivedAtUnixMs,
        });
        insertedCount += 1;
        continue;
      }

      const row = existing[0];
      if (row.ohlcvHash === ohlcvHash) {
        idempotentCount += 1;
        continue;
      }

      if (row.sourceRecordedAtUnixMs < incomingSourceRecordedAtUnixMs) {
        await tx.insert(candleRevisions).values({
          ...feed,
          unixMs: candle.unixMs,
          sourceRecordedAtIso: input.sourceRecordedAtIso,
          sourceRecordedAtUnixMs: incomingSourceRecordedAtUnixMs,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
          ohlcvCanonical,
          ohlcvHash,
          receivedAtUnixMs,
        });
        revisedCount += 1;
        continue;
      }

      rejectedCount += 1;
      rejections.push({
        unixMs: candle.unixMs,
        reason: "STALE_REVISION",
        existingSourceRecordedAtIso: row.sourceRecordedAtIso,
      });
    }
  });

  rejections.sort((a, b) => a.unixMs - b.unixMs);

  return { insertedCount, revisedCount, idempotentCount, rejectedCount, rejections };
}
```

Key points:

- Advisory lock is acquired inside the transaction via `tx.execute(sql\`SELECT pg_advisory_xact_lock(${lockKey})\`)`. This is transaction-scoped, meaning it auto-releases on COMMIT or ROLLBACK — no explicit unlock needed.
- The lock key is a deterministic `bigint` derived from the feed identity fields (see §6.4).
- The same per-slot decision tree as SQLite: insert / idempotent / revise / reject.
- On transaction failure (constraint violation, connection error), the entire batch rolls back atomically.

### 6.3 `getLatestCandlesForFeed` method

```ts
async getLatestCandlesForFeed(
  params: GetLatestCandlesParams
): Promise<CandleRow[]> {
  const rows = await this.db.execute(sql`
    WITH latest_per_slot AS (
      SELECT unix_ms, open, high, low, close, volume,
             row_number() OVER (
               PARTITION BY unix_ms
               ORDER BY source_recorded_at_unix_ms DESC, id DESC
             ) AS rn
        FROM regime_engine.candle_revisions
       WHERE symbol = ${params.symbol}
         AND source = ${params.source}
         AND network = ${params.network}
         AND pool_address = ${params.poolAddress}
         AND timeframe = ${params.timeframe}
         AND unix_ms <= ${params.closedCandleCutoffUnixMs}
    )
    SELECT unix_ms, open, high, low, close, volume
      FROM (
        SELECT unix_ms, open, high, low, close, volume
          FROM latest_per_slot
         WHERE rn = 1
         ORDER BY unix_ms DESC
         LIMIT ${params.limit}
      )
     ORDER BY unix_ms ASC
  `);

  return rows.map((row: any) => ({
    unixMs: Number(row.unix_ms),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume),
  }));
}
```

The read query uses Drizzle's `sql` template tag for the CTE with `ROW_NUMBER() OVER`, since Drizzle doesn't natively support window functions yet. The query is semantically identical to the SQLite version.

**Important implementation notes:**

- The table reference `regime_engine.candle_revisions` is schema-qualified because `db.execute()` raw SQL bypasses Drizzle's automatic schema qualification. The connection's `search_path` alone is insufficient for raw SQL table references.
- `Number()` coercion is applied to all result columns because `db.execute()` returns untyped `{ [column: string]: any }` rows. PG `bigint` columns come back as strings from the postgres-js driver, and `double precision` columns may also need explicit coercion. The `Number()` calls are a safety measure against driver-specific type handling.
- Snake_case columns from PG are mapped to camelCase in the returned `CandleRow[]`.

### 6.4 Advisory lock key derivation

```ts
function feedHash(feed: {
  symbol: string;
  source: string;
  network: string;
  poolAddress: string;
  timeframe: string;
}): bigint {
  const combined = `${feed.symbol}\0${feed.source}\0${feed.network}\0${feed.poolAddress}\0${feed.timeframe}`;
  const hex = sha256Hex(combined);
  // Take first 15 hex chars → 60 bits, fit in PG int8 positive range
  return BigInt("0x" + hex.slice(0, 15)) || 1n;
}
```

This uses the already-imported `sha256Hex` function to produce a cryptographically uniform hash, then truncates to 60 bits (15 hex characters) to fit in PG's `int8` positive range (0 to 2^63-1). This avoids the weak distribution properties of polynomial hashing and provides uniform distribution even for similar feed identifiers.

`ohlcvHash` and `feedHash` are separate concerns: `ohlcvHash` (full SHA-256) determines content identity for the insert/idempotent/revise decision. `feedHash` (truncated SHA-256) determines which advisory lock to acquire.

**Collision safety:** A `feedHash` collision between two different feeds would serialize their writes unnecessarily (both feeds would wait for the same advisory lock). This is a performance degradation, not a data integrity issue — the transaction still enforces the correct per-slot decision tree using the full feed identity columns in the `WHERE` clause. With 60 bits of hash, the birthday-paradox collision probability is negligible for any realistic number of feeds (P ≈ n²/2^61, effectively zero for <10^9 feeds).

## 7. Handler wiring

### 7.1 `src/ledger/storeContext.ts`

Add `CandleStore` to `StoreContext`:

```ts
import { CandleStore } from "./candleStore.js";

export interface StoreContext {
  ledger: LedgerStore;
  pg: Db;
  pgClient: { end: () => Promise<void> };
  candleStore: CandleStore; // new
}

export const createStoreContext = (
  ledgerPath: string,
  pgConnectionString: string
): StoreContext => {
  const ledger = createLedgerStore(ledgerPath);
  try {
    const { db: pg, client: pgClient } = createDb(pgConnectionString);
    const candleStore = new CandleStore(pg);
    return { ledger, pg, pgClient, candleStore };
  } catch (err) {
    ledger.close();
    throw err;
  }
};
```

`candleStore` is always present when `StoreContext` exists (i.e., when `DATABASE_URL` is set). When `DATABASE_URL` is absent, `StoreContext` is null and the fallback path uses SQLite directly.

### 7.2 `src/http/routes.ts`

```ts
app.post("/v1/candles", createCandlesIngestHandler(ledger, storeContext?.candleStore));
app.get("/v1/regime/current", createRegimeCurrentHandler(ledger, storeContext?.candleStore));
```

Both handlers gain an optional second parameter `candleStore?: CandleStore`.

### 7.3 `src/http/handlers/candlesIngest.ts`

```ts
export const createCandlesIngestHandler = (store: LedgerStore, candleStore?: CandleStore) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      requireSharedSecret(request.headers, "X-Candles-Ingest-Token", "CANDLES_INGEST_TOKEN");
      const body = parseCandleIngestRequest(request.body);

      // Note: writeCandles (SQLite) is synchronous; CandleStore.writeCandles (PG) is async.
      // The ternary works because `await` on a non-Promise value is identity.
      const result = candleStore
        ? await candleStore.writeCandles(body, Date.now())
        : writeCandles(store, body, Date.now());

      const response: CandleIngestResponse = { schemaVersion: SCHEMA_VERSION, ...result };
      return reply.code(200).send(response);
    } catch (error) {
      // ... existing error handling unchanged
    }
  };
};
```

**Sync/async note:** The SQLite `writeCandles` is synchronous (returns `Omit<CandleIngestResponse, "schemaVersion">`), while `CandleStore.writeCandles` is async (returns `Promise<...>`). The handler uses a ternary with `await` on the PG branch. Since `await` on a non-Promise value is identity, this works correctly for both paths. If the SQLite function is later made async, the `await` should be added to the fallback branch as well.

### 7.4 `src/http/handlers/regimeCurrent.ts`

```ts
export const createRegimeCurrentHandler = (
  store: LedgerStore,
  candleStore?: CandleStore
) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = parseRegimeCurrentQuery(request.query);
      const config = MARKET_REGIME_CONFIG[query.timeframe];

      const nowUnixMs = Date.now();
      const cutoff = closedCandleCutoffUnixMs(nowUnixMs, config.timeframeMs, config.freshness.closedCandleDelayMs);
      const limit = Math.max(config.indicators.volLongWindow, config.suitability.minCandles) + READ_BUFFER;

      const candles = candleStore
        ? await candleStore.getLatestCandlesForFeed({ ... })
        : getLatestCandlesForFeed(store, { ... });

      // ... rest of handler unchanged
    } catch (error) {
      // ... existing error handling unchanged
    }
  };
};
```

### 7.5 Fallback behavior

- `DATABASE_URL` set → `StoreContext` created → `candleStore` injected → all candle I/O goes to PG.
- `DATABASE_URL` absent → `StoreContext` is null → `candleStore` is undefined → handlers fall back to existing SQLite `candlesWriter` functions.

**Important operational characteristics:**

1. **Deployment-time fallback, not runtime fallback.** The backend selection happens at startup based on `DATABASE_URL` presence. If `DATABASE_URL` is set but PG is unreachable at request time, candle requests will fail with 500 errors — there is no per-request fallback to SQLite. This is by design: mixing PG writes and SQLite reads would cause data inconsistency.

2. **Sync/async asymmetry.** The SQLite `writeCandles` and `getLatestCandlesForFeed` are synchronous. The PG `CandleStore` methods are async. The handler ternaries handle this via `await` on the PG branch; `await` on a non-Promise is identity.

3. **Graceful cold-start after cutover.** After enabling PG, `GET /v1/regime/current` returns 404 `CANDLES_NOT_FOUND` until sufficient candles accumulate. This is a regression from the pre-migration state (where SQLite had data). Mitigated by: (a) deploying during a low-traffic window, (b) accepting the cold-start period, or (c) implementing a one-time migration script (explicitly out of scope for this issue).

## 8. Module layout

New files:

```
src/ledger/
  pg/schema/candleRevisions.ts     Drizzle table definition + indexes
  candleStore.ts                   CandleStore class (read/write via Drizzle)

drizzle/
  0001_create_candle_revisions.sql  Generated migration
```

Modified files:

```
src/ledger/pg/schema/index.ts      Re-export candleRevisions
src/ledger/storeContext.ts          + candleStore field
src/http/routes.ts                  Pass candleStore to handlers
src/http/handlers/candlesIngest.ts   + optional CandleStore parameter
src/http/handlers/regimeCurrent.ts   + optional CandleStore parameter
```

Unchanged files:

```
src/ledger/candlesWriter.ts         Preserved as SQLite fallback
src/ledger/schema.sql               Unchanged (SQLite candle_revisions remains)
src/engine/                          No changes (pure core)
src/contract/v1/                    No changes (types unchanged)
```

**Shared types note:** `GetLatestCandlesParams` and `CandleRow` are exported from `candleStore.ts` with identical shapes to the same-named interfaces in `candlesWriter.ts`. TypeScript uses structural typing, so both paths produce compatible objects. Handlers import the `CandleStore` type for the parameter but receive `CandleRow[]` from whichever backend serves the request. If future migrations warrant it, these types should be unified into a single canonical export (e.g., `src/contract/v1/types.ts`).

## 9. Testing strategy

### 9.1 Drizzle schema test (`src/ledger/pg/__tests__/candleRevisions.test.ts`)

- Verify table columns and types match design spec.
- Verify indexes exist with correct column order.
- Run against a real PG instance (Railway test DB or local Docker).

### 9.2 CandleStore write tests (`src/ledger/__tests__/candleStore.test.ts`)

All tests run against a real PG instance (not mocked), using the same approach as existing ledger tests but with a PG test helper.

- Happy path: 3 fresh slots → `insertedCount=3`, no rejections.
- Byte-equal replay → `idempotentCount=3`, no inserts.
- Newer `sourceRecordedAtIso` + different OHLCV → `revisedCount=3`; new row appended; latest read returns new bytes.
- Older `sourceRecordedAtIso` + different OHLCV → `rejectedCount=3`; rejection details include existing `sourceRecordedAtIso`.
- Mixed batch (1 insert + 1 revise + 1 idempotent + 1 reject) → counts split correctly.
- Advisory lock: two concurrent writes to the same feed → second waits for first, both succeed.
- Advisory lock: concurrent writes to different feeds → both proceed in parallel.
- Structural failure mid-batch → transaction rolled back; no rows visible.

### 9.3 CandleStore read tests

- Read query returns latest revision per slot, ASC by `unixMs`, with closed-candle cutoff applied.
- Multiple revisions for same slot → only latest (by `source_recorded_at_unix_ms DESC, id DESC`) returned.
- Empty feed → empty array.

### 9.4 Handler integration tests (`src/http/__tests__/`)

Existing route tests extended:

- `candlesIngest.route.test.ts` — when `candleStore` is provided, handler delegates to it.
- `regimeCurrent.route.test.ts` — when `candleStore` is provided, handler delegates to it.
- Both: when `candleStore` is undefined, handler falls back to SQLite functions.

### 9.5 Fallback tests

- Verify that `createCandlesIngestHandler(store)` (no `candleStore`) works with SQLite.
- Verify that `createCandlesIngestHandler(store, candleStore)` uses PG.

## 10. Migration / rollout

1. **Pre-deploy:** `drizzle-kit generate` produces `drizzle/0001_create_candle_revisions.sql`.
2. **Deploy:** Railway `preDeployCommand: npx drizzle-kit migrate` creates the table in PG.
3. **Runtime:** `DATABASE_URL` is set → `CandleStore` is created → candle I/O goes to PG. `DATABASE_URL` not set → SQLite fallback.
4. **No backfill.** PG `candle_revisions` starts empty. The `/v1/candles` endpoint will begin populating it from the first ingest after deploy. `GET /v1/regime/current` will return 404 `CANDLES_NOT_FOUND` until enough candles accumulate (same cold-start behavior as a fresh SQLite database).

### 10.1 Rollback

If PG candle storage has issues:

1. Remove `DATABASE_URL` environment variable.
2. Redeploy. System falls back to SQLite candle I/O.
3. No data loss in SQLite — it was never modified and continues working.
4. **Data gap:** Any candle data written to PG between cutover and rollback is not available after rollback. SQLite data may be stale depending on the duration of the PG-primary period.
5. Optionally: `TRUNCATE regime_engine.candle_revisions` in PG to clean the empty/partial table for a clean retry state.

## 11. Acceptance criteria mapping

| Issue #23 criterion                                                   | Section          |
| --------------------------------------------------------------------- | ---------------- |
| Drizzle schema for `candle_revisions` in `regime_engine` schema       | §5               |
| `CandleStore` class with `writeCandles` and `getLatestCandlesForFeed` | §6               |
| Advisory lock per feed for write concurrency                          | §4.1, §6.2, §6.4 |
| Same write-decision tree (insert/idempotent/revise/reject)            | §6.2             |
| Same read query semantics (CTE with ROW_NUMBER)                       | §6.3             |
| Handler injection — PG-first with SQLite fallback                     | §7               |
| No backfill — PG starts empty                                         | §10              |
| Existing tests pass unchanged (SQLite path still works)               | §9.4, §9.5       |
| Migration via `drizzle-kit migrate`                                   | §5.3             |
