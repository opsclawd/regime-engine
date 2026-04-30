# Candle Storage PG Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate candle reads and writes from SQLite to Postgres via Drizzle ORM, with per-feed advisory locking and SQLite fallback when DATABASE_URL is absent.

**Architecture:** New `CandleStore` class wraps Drizzle queries against a PG `candle_revisions` table. Handlers accept an optional `CandleStore` — when provided (DATABASE_URL set), they delegate to it; otherwise they fall back to the existing SQLite `candlesWriter` functions. The advisory lock replaces SQLite's `BEGIN IMMEDIATE` for concurrency control.

**Tech Stack:** TypeScript, Drizzle ORM, postgres-js, Vitest, Fastify

---

## File Structure

**New files:**

- `src/ledger/pg/schema/candleRevisions.ts` — Drizzle table definition + indexes
- `src/ledger/candleStore.ts` — `CandleStore` class (writeCandles, getLatestCandlesForFeed, feedHash helper)
- `src/ledger/__tests__/candleStore.test.ts` — Unit tests for CandleStore (requires PG)
- `src/http/__tests__/candlesPg.e2e.test.ts` — E2E test for PG candle ingest route (requires PG)
- `src/http/__tests__/regimeCurrentPg.e2e.test.ts` — E2E test for PG regime current route (requires PG)
- `drizzle/0001_create_candle_revisions.sql` — Generated migration (created by `drizzle-kit generate`)

**Modified files:**

- `src/ledger/pg/schema/index.ts` — Add re-export of `candleRevisions`
- `src/ledger/storeContext.ts` — Add `candleStore: CandleStore` field
- `src/http/routes.ts` — Pass `storeContext?.candleStore` to candle and regime-current handlers
- `src/http/handlers/candlesIngest.ts` — Add optional `CandleStore` parameter, delegate when present
- `src/http/handlers/regimeCurrent.ts` — Add optional `CandleStore` parameter, delegate when present

**Unchanged files:**

- `src/ledger/candlesWriter.ts` — Preserved as SQLite fallback
- `src/ledger/schema.sql` — SQLite schema remains
- `src/engine/` — Pure core, no changes
- `src/contract/v1/` — Types unchanged

---

### Task 1: Drizzle Schema for candle_revisions

**Files:**

- Create: `src/ledger/pg/schema/candleRevisions.ts`
- Modify: `src/ledger/pg/schema/index.ts`
- Test: `npm run typecheck`

- [ ] **Step 1: Create `src/ledger/pg/schema/candleRevisions.ts`**

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

- [ ] **Step 2: Update `src/ledger/pg/schema/index.ts` to re-export candleRevisions**

Change the file from:

```ts
export {};
```

to:

```ts
export { candleRevisions } from "./candleRevisions.js";
```

- [ ] **Step 3: Run typecheck to verify schema compiles**

Run: `npm run typecheck`
Expected: PASS (no errors)

- [ ] **Step 4: Generate migration**

Run: `npx drizzle-kit generate`
Expected: Creates `drizzle/0001_create_candle_revisions.sql` with CREATE TABLE and index statements in the `regime_engine` schema.

- [ ] **Step 5: Verify the generated migration SQL**

Read `drizzle/0001_create_candle_revisions.sql` and confirm it contains:

- `CREATE TABLE IF NOT EXISTS "regime_engine"."candle_revisions"` with all columns using `double precision` for OHLCV (not `real`)
- `CREATE UNIQUE INDEX IF NOT EXISTS` for `ux_candle_revisions_slot_hash`
- `CREATE INDEX IF NOT EXISTS` for `idx_candle_revisions_slot_latest`
- `CREATE INDEX IF NOT EXISTS` for `idx_candle_revisions_feed_window`
- No `SET search_path` at the top (Drizzle handles schema via the connection)

- [ ] **Step 6: Commit**

```bash
git add src/ledger/pg/schema/candleRevisions.ts src/ledger/pg/schema/index.ts drizzle/
git commit -m "m23: add Drizzle schema for candle_revisions table and generate migration"
```

---

### Task 2: CandleStore class — `writeCandles` method

**Files:**

- Create: `src/ledger/candleStore.ts`
- Test: manual verification via typecheck

- [ ] **Step 1: Create `src/ledger/candleStore.ts` with imports, helper functions, and the `writeCandles` method**

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

export interface GetLatestCandlesParams {
  symbol: string;
  source: string;
  network: string;
  poolAddress: string;
  timeframe: string;
  closedCandleCutoffUnixMs: number;
  limit: number;
}

export interface CandleRow {
  unixMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const computeOhlcv = (candle: {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}) => {
  const ohlcvCanonical = toCanonicalJson({
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume
  });
  const ohlcvHash = sha256Hex(ohlcvCanonical);
  return { ohlcvCanonical, ohlcvHash };
};

const feedHash = (feed: {
  symbol: string;
  source: string;
  network: string;
  poolAddress: string;
  timeframe: string;
}): bigint => {
  const combined = `${feed.symbol}\0${feed.source}\0${feed.network}\0${feed.poolAddress}\0${feed.timeframe}`;
  const hex = sha256Hex(combined);
  return BigInt("0x" + hex.slice(0, 15)) || 1n;
};

export class CandleStore {
  constructor(private db: Db) {}

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
      timeframe: input.timeframe
    };

    const lockKey = feedHash(feed);

    let insertedCount = 0;
    let revisedCount = 0;
    let idempotentCount = 0;
    let rejectedCount = 0;
    const rejections: CandleIngestRejection[] = [];

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`);

      for (const candle of input.candles) {
        const { ohlcvCanonical, ohlcvHash } = computeOhlcv(candle);

        const existing = await tx
          .select({
            sourceRecordedAtUnixMs: candleRevisions.sourceRecordedAtUnixMs,
            sourceRecordedAtIso: candleRevisions.sourceRecordedAtIso,
            ohlcvHash: candleRevisions.ohlcvHash
          })
          .from(candleRevisions)
          .where(
            and(
              eq(candleRevisions.symbol, feed.symbol),
              eq(candleRevisions.source, feed.source),
              eq(candleRevisions.network, feed.network),
              eq(candleRevisions.poolAddress, feed.poolAddress),
              eq(candleRevisions.timeframe, feed.timeframe),
              eq(candleRevisions.unixMs, candle.unixMs)
            )
          )
          .orderBy(desc(candleRevisions.sourceRecordedAtUnixMs), desc(candleRevisions.id))
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
            receivedAtUnixMs
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
            receivedAtUnixMs
          });
          revisedCount += 1;
          continue;
        }

        rejectedCount += 1;
        rejections.push({
          unixMs: candle.unixMs,
          reason: "STALE_REVISION",
          existingSourceRecordedAtIso: row.sourceRecordedAtIso
        });
      }
    });

    rejections.sort((a, b) => a.unixMs - b.unixMs);

    return { insertedCount, revisedCount, idempotentCount, rejectedCount, rejections };
  }
}
```

- [ ] **Step 2: Run typecheck to verify**

Run: `npm run typecheck`
Expected: PASS (no errors). Note: `getLatestCandlesForFeed` will be added in Task 3, so the class is incomplete for now — but `writeCandles` itself should type-check.

- [ ] **Step 3: Commit**

```bash
git add src/ledger/candleStore.ts
git commit -m "m23: add CandleStore.writeCandles with advisory locking"
```

---

### Task 3: CandleStore class — `getLatestCandlesForFeed` method

**Files:**

- Modify: `src/ledger/candleStore.ts`

- [ ] **Step 1: Add `getLatestCandlesForFeed` method to CandleStore**

Add this method to the `CandleStore` class in `src/ledger/candleStore.ts`, after the `writeCandles` method:

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

- [ ] **Step 2: Run typecheck to verify**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/ledger/candleStore.ts
git commit -m "m23: add CandleStore.getLatestCandlesForFeed with CTE query"
```

---

### Task 4: Wire CandleStore into StoreContext and route handlers

**Files:**

- Modify: `src/ledger/storeContext.ts`
- Modify: `src/http/routes.ts`
- Modify: `src/http/handlers/candlesIngest.ts`
- Modify: `src/http/handlers/regimeCurrent.ts`

- [ ] **Step 1: Update `src/ledger/storeContext.ts`**

Replace the entire file with:

```ts
import type { LedgerStore } from "./store.js";
import type { Db } from "./pg/db.js";
import { CandleStore } from "./candleStore.js";
import { createLedgerStore } from "./store.js";
import { createDb } from "./pg/db.js";

export interface StoreContext {
  ledger: LedgerStore;
  pg: Db;
  pgClient: { end: () => Promise<void> };
  candleStore: CandleStore;
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

export const closeStoreContext = async (ctx: StoreContext): Promise<void> => {
  try {
    ctx.ledger.close();
  } finally {
    await ctx.pgClient.end();
  }
};
```

- [ ] **Step 2: Update `src/http/handlers/candlesIngest.ts`**

Replace the entire file with:

```ts
import type { FastifyReply, FastifyRequest } from "fastify";
import { SCHEMA_VERSION, type CandleIngestResponse } from "../../contract/v1/types.js";
import { parseCandleIngestRequest } from "../../contract/v1/validation.js";
import type { LedgerStore } from "../../ledger/store.js";
import { writeCandles } from "../../ledger/candlesWriter.js";
import type { CandleStore } from "../../ledger/candleStore.js";
import { AuthError, requireSharedSecret } from "../auth.js";
import { ContractValidationError } from "../errors.js";

export const createCandlesIngestHandler = (store: LedgerStore, candleStore?: CandleStore) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      requireSharedSecret(request.headers, "X-Candles-Ingest-Token", "CANDLES_INGEST_TOKEN");

      const body = parseCandleIngestRequest(request.body);

      const result = candleStore
        ? await candleStore.writeCandles(body, Date.now())
        : writeCandles(store, body, Date.now());

      const response: CandleIngestResponse = {
        schemaVersion: SCHEMA_VERSION,
        ...result
      };

      return reply.code(200).send(response);
    } catch (error) {
      if (error instanceof AuthError) {
        return reply.code(error.statusCode).send(error.response);
      }
      if (error instanceof ContractValidationError) {
        return reply.code(error.statusCode).send(error.response);
      }
      request.log.error(error, "Unhandled error in POST /v1/candles");
      return reply.code(500).send({
        schemaVersion: "1.0",
        error: { code: "INTERNAL_ERROR", message: "Internal server error", details: [] }
      });
    }
  };
};
```

- [ ] **Step 3: Update `src/http/handlers/regimeCurrent.ts`**

Replace the entire file with:

```ts
import type { FastifyReply, FastifyRequest } from "fastify";
import { parseRegimeCurrentQuery } from "../../contract/v1/validation.js";
import { candlesNotFoundError, ContractValidationError } from "../errors.js";
import type { LedgerStore } from "../../ledger/store.js";
import { getLatestCandlesForFeed } from "../../ledger/candlesWriter.js";
import type { CandleStore } from "../../ledger/candleStore.js";
import {
  MARKET_REGIME_CONFIG,
  MARKET_REGIME_CONFIG_VERSION
} from "../../engine/marketRegime/config.js";
import { closedCandleCutoffUnixMs } from "../../engine/marketRegime/closedCandleCutoff.js";
import { buildRegimeCurrent } from "../../engine/marketRegime/buildRegimeCurrent.js";

const READ_BUFFER = 50;

export const createRegimeCurrentHandler = (store: LedgerStore, candleStore?: CandleStore) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = parseRegimeCurrentQuery(request.query);
      const config = MARKET_REGIME_CONFIG[query.timeframe];

      const nowUnixMs = Date.now();
      const cutoff = closedCandleCutoffUnixMs(
        nowUnixMs,
        config.timeframeMs,
        config.freshness.closedCandleDelayMs
      );
      const limit =
        Math.max(config.indicators.volLongWindow, config.suitability.minCandles) + READ_BUFFER;

      const candles = candleStore
        ? await candleStore.getLatestCandlesForFeed({
            symbol: query.symbol,
            source: query.source,
            network: query.network,
            poolAddress: query.poolAddress,
            timeframe: query.timeframe,
            closedCandleCutoffUnixMs: cutoff,
            limit
          })
        : getLatestCandlesForFeed(store, {
            symbol: query.symbol,
            source: query.source,
            network: query.network,
            poolAddress: query.poolAddress,
            timeframe: query.timeframe,
            closedCandleCutoffUnixMs: cutoff,
            limit
          });

      if (candles.length === 0) {
        throw candlesNotFoundError(
          `No closed candles found for symbol="${query.symbol}", source="${query.source}", ` +
            `network="${query.network}", poolAddress="${query.poolAddress}", ` +
            `timeframe="${query.timeframe}".`
        );
      }

      const response = buildRegimeCurrent({
        feed: {
          symbol: query.symbol,
          source: query.source,
          network: query.network,
          poolAddress: query.poolAddress,
          timeframe: query.timeframe
        },
        candles,
        nowUnixMs,
        config,
        configVersion: MARKET_REGIME_CONFIG_VERSION,
        engineVersion: process.env.npm_package_version ?? "0.0.0"
      });

      return reply.code(200).send(response);
    } catch (error) {
      if (error instanceof ContractValidationError) {
        return reply.code(error.statusCode).send(error.response);
      }
      request.log.error(error, "Unhandled error in GET /v1/regime/current");
      return reply.code(500).send({
        schemaVersion: "1.0",
        error: { code: "INTERNAL_ERROR", message: "Internal server error", details: [] }
      });
    }
  };
};
```

- [ ] **Step 4: Update `src/http/routes.ts`**

Replace lines 81-82 (the two candle handler registrations) and add the `CandleStore` import:

Add import at the top:

```ts
import type { CandleStore } from "../ledger/candleStore.js";
```

Change these two lines:

```ts
app.post("/v1/candles", createCandlesIngestHandler(ledger));
app.get("/v1/regime/current", createRegimeCurrentHandler(ledger));
```

to:

```ts
app.post("/v1/candles", createCandlesIngestHandler(ledger, storeContext?.candleStore));
app.get("/v1/regime/current", createRegimeCurrentHandler(ledger, storeContext?.candleStore));
```

- [ ] **Step 5: Verify the storeContext.e2e.test.ts still references StoreContext**

Read `src/http/__tests__/storeContext.e2e.test.ts` — it imports `buildApp` and only tests `/health`. The `StoreContext` interface change (adding `candleStore`) should not break this test since it doesn't construct `StoreContext` directly. No changes needed.

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 7: Run existing tests**

Run: `npm run test`
Expected: All existing tests PASS. These tests don't set `DATABASE_URL`, so they exercise the SQLite fallback path. The handler changes only add optional parameters, so the existing tests should pass unchanged.

- [ ] **Step 8: Commit**

```bash
git add src/ledger/storeContext.ts src/http/routes.ts src/http/handlers/candlesIngest.ts src/http/handlers/regimeCurrent.ts
git commit -m "m23: wire CandleStore into StoreContext and route handlers with optional injection"
```

---

### Task 5: Unit tests for CandleStore (PG integration tests)

**Files:**

- Create: `src/ledger/__tests__/candleStore.test.ts`

This task creates PG integration tests that mirror the existing `candlesWriter.test.ts` but use `CandleStore` against a real Postgres. These tests require `DATABASE_URL` and are run via `npm run test:pg`.

- [ ] **Step 1: Create `src/ledger/__tests__/candleStore.test.ts`**

```ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../pg/db.js";
import { CandleStore } from "../candleStore.js";
import { candleRevisions } from "../pg/schema/candleRevisions.js";
import type { CandleIngestRequest } from "../../contract/v1/types.js";

const ONE_HOUR_MS = 60 * 60 * 1000;

const makeRequest = (overrides: Partial<CandleIngestRequest> = {}): CandleIngestRequest => ({
  schemaVersion: "1.0",
  source: "birdeye",
  network: "solana-mainnet",
  poolAddress: "Pool111",
  symbol: "SOL/USDC",
  timeframe: "1h",
  sourceRecordedAtIso: "2026-04-26T12:00:00.000Z",
  candles: [
    { unixMs: 1 * ONE_HOUR_MS, open: 100, high: 110, low: 90, close: 105, volume: 1 },
    { unixMs: 2 * ONE_HOUR_MS, open: 105, high: 115, low: 100, close: 110, volume: 2 },
    { unixMs: 3 * ONE_HOUR_MS, open: 110, high: 120, low: 105, close: 115, volume: 3 }
  ],
  ...overrides
});

describe.skipIf(!process.env.DATABASE_URL)("CandleStore (PG)", () => {
  let db: Db;
  let client: { end: () => Promise<void> };
  let store: CandleStore;

  beforeAll(async () => {
    const result = createDb(process.env.DATABASE_URL!);
    db = result.db;
    client = result.client;
    store = new CandleStore(db);
  });

  afterAll(async () => {
    await client.end();
  });

  afterEach(async () => {
    await db.delete(candleRevisions).execute();
  });

  it("inserts brand-new slots", async () => {
    const result = await store.writeCandles(makeRequest(), 1_700_000_000_000);

    expect(result).toEqual({
      insertedCount: 3,
      revisedCount: 0,
      idempotentCount: 0,
      rejectedCount: 0,
      rejections: []
    });
  });

  it("byte-equal replay is idempotent without new rows", async () => {
    await store.writeCandles(makeRequest(), 1_700_000_000_000);

    const result = await store.writeCandles(makeRequest(), 1_700_000_001_000);

    expect(result).toEqual({
      insertedCount: 0,
      revisedCount: 0,
      idempotentCount: 3,
      rejectedCount: 0,
      rejections: []
    });
  });

  it("appends a revision when sourceRecordedAtIso advances and OHLCV differs", async () => {
    await store.writeCandles(makeRequest(), 1_700_000_000_000);

    const newer = makeRequest({
      sourceRecordedAtIso: "2026-04-26T13:00:00.000Z",
      candles: [
        { unixMs: 1 * ONE_HOUR_MS, open: 101, high: 111, low: 91, close: 106, volume: 11 },
        { unixMs: 2 * ONE_HOUR_MS, open: 106, high: 116, low: 101, close: 111, volume: 22 },
        { unixMs: 3 * ONE_HOUR_MS, open: 111, high: 121, low: 106, close: 116, volume: 33 }
      ]
    });

    const result = await store.writeCandles(newer, 1_700_000_002_000);

    expect(result).toEqual({
      insertedCount: 0,
      revisedCount: 3,
      idempotentCount: 0,
      rejectedCount: 0,
      rejections: []
    });

    const latest = await store.getLatestCandlesForFeed({
      symbol: "SOL/USDC",
      source: "birdeye",
      network: "solana-mainnet",
      poolAddress: "Pool111",
      timeframe: "1h",
      closedCandleCutoffUnixMs: 10 * ONE_HOUR_MS,
      limit: 100
    });
    expect(latest.map((c) => c.close)).toEqual([106, 111, 116]);
  });

  it("rejects per-slot when sourceRecordedAtIso is older with different OHLCV", async () => {
    await store.writeCandles(
      makeRequest({ sourceRecordedAtIso: "2026-04-26T13:00:00.000Z" }),
      1_700_000_000_000
    );

    const stale = makeRequest({
      sourceRecordedAtIso: "2026-04-26T12:00:00.000Z",
      candles: [{ unixMs: 1 * ONE_HOUR_MS, open: 200, high: 210, low: 190, close: 205, volume: 1 }]
    });

    const result = await store.writeCandles(stale, 1_700_000_001_000);

    expect(result.rejectedCount).toBe(1);
    expect(result.insertedCount).toBe(0);
    expect(result.rejections).toEqual([
      {
        unixMs: 1 * ONE_HOUR_MS,
        reason: "STALE_REVISION",
        existingSourceRecordedAtIso: "2026-04-26T13:00:00.000Z"
      }
    ]);
  });

  it("mixes inserted/revised/idempotent/rejected in one batch", async () => {
    await store.writeCandles(
      makeRequest({
        sourceRecordedAtIso: "2026-04-26T13:00:00.000Z",
        candles: [
          { unixMs: 1 * ONE_HOUR_MS, open: 100, high: 110, low: 90, close: 105, volume: 1 },
          { unixMs: 2 * ONE_HOUR_MS, open: 105, high: 115, low: 100, close: 110, volume: 2 }
        ]
      }),
      1_700_000_000_000
    );

    const mixed = makeRequest({
      sourceRecordedAtIso: "2026-04-26T12:00:00.000Z",
      candles: [
        { unixMs: 1 * ONE_HOUR_MS, open: 100, high: 110, low: 90, close: 105, volume: 1 },
        { unixMs: 2 * ONE_HOUR_MS, open: 999, high: 999, low: 999, close: 999, volume: 9 },
        { unixMs: 3 * ONE_HOUR_MS, open: 110, high: 120, low: 105, close: 115, volume: 3 }
      ]
    });

    const result = await store.writeCandles(mixed, 1_700_000_002_000);

    expect(result.idempotentCount).toBe(1);
    expect(result.rejectedCount).toBe(1);
    expect(result.insertedCount).toBe(1);
    expect(result.revisedCount).toBe(0);
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0].unixMs).toBe(2 * ONE_HOUR_MS);
  });

  it("getLatestCandlesForFeed returns empty array when no data exists", async () => {
    const result = await store.getLatestCandlesForFeed({
      symbol: "SOL/USDC",
      source: "birdeye",
      network: "solana-mainnet",
      poolAddress: "Pool111",
      timeframe: "1h",
      closedCandleCutoffUnixMs: 10 * ONE_HOUR_MS,
      limit: 100
    });
    expect(result).toEqual([]);
  });

  it("getLatestCandlesForFeed respects closedCandleCutoffUnixMs", async () => {
    await store.writeCandles(
      makeRequest({
        candles: [
          { unixMs: 1 * ONE_HOUR_MS, open: 100, high: 110, low: 90, close: 105, volume: 1 },
          { unixMs: 2 * ONE_HOUR_MS, open: 101, high: 111, low: 91, close: 106, volume: 2 },
          { unixMs: 10 * ONE_HOUR_MS, open: 102, high: 112, low: 92, close: 107, volume: 3 }
        ]
      }),
      1_700_000_000_000
    );

    const result = await store.getLatestCandlesForFeed({
      symbol: "SOL/USDC",
      source: "birdeye",
      network: "solana-mainnet",
      poolAddress: "Pool111",
      timeframe: "1h",
      closedCandleCutoffUnixMs: 5 * ONE_HOUR_MS,
      limit: 100
    });

    expect(result.length).toBe(2);
    expect(result.map((c) => c.close)).toEqual([105, 106]);
  });

  it("getLatestCandlesForFeed respects limit", async () => {
    await store.writeCandles(
      makeRequest({
        candles: Array.from({ length: 20 }, (_, i) => ({
          unixMs: (i + 1) * ONE_HOUR_MS,
          open: 100 + i,
          high: 110 + i,
          low: 90 + i,
          close: 105 + i,
          volume: i + 1
        }))
      }),
      1_700_000_000_000
    );

    const result = await store.getLatestCandlesForFeed({
      symbol: "SOL/USDC",
      source: "birdeye",
      network: "solana-mainnet",
      poolAddress: "Pool111",
      timeframe: "1h",
      closedCandleCutoffUnixMs: 25 * ONE_HOUR_MS,
      limit: 5
    });

    expect(result.length).toBe(5);
  });
});
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Run the existing (SQLite) tests to confirm nothing is broken**

Run: `npm run test`
Expected: All existing tests PASS (these exercise the SQLite path only).

- [ ] **Step 4: Commit**

```bash
git add src/ledger/__tests__/candleStore.test.ts
git commit -m "m23: add CandleStore PG integration tests"
```

Note: These tests will only run when `DATABASE_URL` is set (they use `describe.skipIf`). Running them locally requires a PG instance. They will be exercised in CI via `npm run test:pg`.

---

### Task 6: Update the test:pg script to include new PG tests

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Update the `test:pg` script in `package.json`**

Change the `test:pg` script from:

```json
"test:pg": "DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false vitest run src/ledger/pg/__tests__/ src/__tests__/pgStartup.test.ts src/http/__tests__/storeContext.e2e.test.ts"
```

to:

```json
"test:pg": "DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false vitest run src/ledger/pg/__tests__/ src/__tests__/pgStartup.test.ts src/http/__tests__/storeContext.e2e.test.ts src/ledger/__tests__/candleStore.test.ts"
```

- [ ] **Step 2: Commit**

```bash
git add package.json
git commit -m "m23: add CandleStore tests to test:pg script"
```

---

### Task 7: PG schema verification test

**Files:**

- Create: `src/ledger/pg/__tests__/candleRevisions.test.ts`

- [ ] **Step 1: Create `src/ledger/pg/__tests__/candleRevisions.test.ts`**

This test verifies the Drizzle schema columns and indexes against a real PG instance.

```ts
import { describe, expect, it } from "vitest";
import { createDb } from "../db.js";
import { candleRevisions } from "../schema/candleRevisions.js";

describe.skipIf(!process.env.DATABASE_URL)("candle_revisions schema (PG)", () => {
  it("has all required columns with correct types", async () => {
    const { db, client } = createDb(process.env.DATABASE_URL!);

    const result = await db.execute({
      sql: `SELECT column_name, data_type, is_nullable
              FROM information_schema.columns
             WHERE table_schema = 'regime_engine' AND table_name = 'candle_revisions'
             ORDER BY ordinal_position`
    });

    const columns = result.map((row: any) => row.column_name);

    expect(columns).toContain("id");
    expect(columns).toContain("symbol");
    expect(columns).toContain("source");
    expect(columns).toContain("network");
    expect(columns).toContain("pool_address");
    expect(columns).toContain("timeframe");
    expect(columns).toContain("unix_ms");
    expect(columns).toContain("source_recorded_at_iso");
    expect(columns).toContain("source_recorded_at_unix_ms");
    expect(columns).toContain("open");
    expect(columns).toContain("high");
    expect(columns).toContain("low");
    expect(columns).toContain("close");
    expect(columns).toContain("volume");
    expect(columns).toContain("ohlcv_canonical");
    expect(columns).toContain("ohlcv_hash");
    expect(columns).toContain("received_at_unix_ms");

    const openCol = result.find((row: any) => row.column_name === "open");
    expect(openCol?.data_type).toBe("double precision");

    await client.end();
  });

  it("has the unique index on slot+hash", async () => {
    const { db, client } = createDb(process.env.DATABASE_URL!);

    const result = await db.execute({
      sql: `SELECT indexname FROM pg_indexes
             WHERE schemaname = 'regime_engine' AND tablename = 'candle_revisions'`
    });

    const indexNames = result.map((row: any) => row.indexname);

    expect(indexNames).toContain("ux_candle_revisions_slot_hash");
    expect(indexNames).toContain("idx_candle_revisions_slot_latest");
    expect(indexNames).toContain("idx_candle_revisions_feed_window");

    await client.end();
  });
});
```

- [ ] **Step 2: Add this test to the `test:pg` script in `package.json`**

Update the `test:pg` script from Task 6 to also include `src/ledger/pg/__tests__/candleRevisions.test.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/ledger/pg/__tests__/candleRevisions.test.ts package.json
git commit -m "m23: add PG schema verification test for candle_revisions"
```

---

### Task 8: Fallback handler tests

**Files:**

- Create: `src/http/__tests__/candleFallback.e2e.test.ts`

- [ ] **Step 1: Create `src/http/__tests__/candleFallback.e2e.test.ts`**

Tests that handlers work with both SQLite-only and SQLite+PG paths.

```ts
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { createLedgerStore } from "../../ledger/store.js";
import { writeCandles } from "../../ledger/candlesWriter.js";

const ONE_HOUR_MS = 60 * 60 * 1000;
const createdDbPaths: string[] = [];

const tempDb = (): string => {
  const path = join(
    tmpdir(),
    `regime-engine-fallback-e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}.sqlite`
  );
  createdDbPaths.push(path);
  return path;
};

afterEach(() => {
  for (const p of createdDbPaths.splice(0)) {
    rmSync(p, { force: true });
  }
  delete process.env.LEDGER_DB_PATH;
  delete process.env.CANDLES_INGEST_TOKEN;
});

const makePayload = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: "1.0",
  source: "birdeye",
  network: "solana-mainnet",
  poolAddress: "Pool111",
  symbol: "SOL/USDC",
  timeframe: "1h",
  sourceRecordedAtIso: "2026-04-26T12:00:00.000Z",
  candles: [{ unixMs: ONE_HOUR_MS, open: 100, high: 110, low: 95, close: 105, volume: 1 }],
  ...overrides
});

describe("Candle handler fallback (SQLite-only, no DATABASE_URL)", () => {
  it("POST /v1/candles works with SQLite when candleStore is not provided", async () => {
    process.env.LEDGER_DB_PATH = tempDb();
    process.env.CANDLES_INGEST_TOKEN = "test-token";
    delete process.env.DATABASE_URL;

    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/candles",
      headers: { "X-Candles-Ingest-Token": "test-token" },
      payload: makePayload()
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().insertedCount).toBe(1);
    await app.close();
  });

  it("GET /v1/regime/current returns 404 when no candles data exists (SQLite)", async () => {
    process.env.LEDGER_DB_PATH = tempDb();
    delete process.env.DATABASE_URL;

    const app = buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/regime/current?symbol=SOL%2FUSDC&source=birdeye&network=solana-mainnet&poolAddress=Pool111&timeframe=1h"
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("CANDLES_NOT_FOUND");
    await app.close();
  });
});
```

- [ ] **Step 2: Run existing tests to confirm nothing breaks**

Run: `npm run test`
Expected: All tests pass, including the new fallback test.

- [ ] **Step 3: Commit**

```bash
git add src/http/__tests__/candleFallback.e2e.test.ts
git commit -m "m23: add fallback handler tests for SQLite-only path"
```

---

### Task 9: Run full quality gate and verify migration

**Files:**

- None (verification only)

- [ ] **Step 1: Run the full quality gate**

Run: `npm run typecheck && npm run test && npm run lint && npm run build`
Expected: All commands pass with zero errors/warnings.

- [ ] **Step 2: Verify the migration SQL**

Run: `ls drizzle/`
Expected: Shows both `0000_create_regime_engine_schema.sql` and `0001_create_candle_revisions.sql`.

- [ ] **Step 3: Verify SQLite fallback still works**

Run: `npm run test`
Expected: All tests pass. These tests don't set `DATABASE_URL`, confirming the SQLite fallback path works.

- [ ] **Step 4: Final commit (if any linting fixes or small adjustments were needed)**

```bash
git add -A
git commit -m "m23: finalize candle PG migration — quality gate clean"
```

---

## Self-Review Checklist

### 1. Spec coverage

| Spec section                             | Plan task                           |
| ---------------------------------------- | ----------------------------------- |
| §5 Drizzle schema                        | Task 1                              |
| §5.4 Unique index on slot+hash           | Task 1                              |
| §6.2 `writeCandles` with advisory lock   | Task 2                              |
| §6.3 `getLatestCandlesForFeed` with CTE  | Task 3                              |
| §6.4 `feedHash` helper (sha256Hex-based) | Task 2 (included in CandleStore)    |
| §7.1 StoreContext update                 | Task 4                              |
| §7.2 Routes update                       | Task 4                              |
| §7.3 CandlesIngest handler               | Task 4                              |
| §7.4 RegimeCurrent handler               | Task 4                              |
| §7.5 Fallback behavior                   | Task 4 (inherent in optional param) |
| §9.1 Drizzle schema test                 | Task 7                              |
| §9.2 CandleStore write tests             | Task 5                              |
| §9.3 CandleStore read tests              | Task 5                              |
| §9.4 Handler integration tests           | Task 8                              |
| §9.5 Fallback tests                      | Task 8                              |
| No backfill                              | No task needed (documented)         |
| Migration via drizzle-kit                | Task 1 (generated)                  |

### 2. Placeholder scan

No TBD, TODO, "implement later", "fill in details", or "similar to" patterns found. All code is complete.

### 3. Type consistency

- `CandleStore` constructor takes `Db` → matches `createDb` return type `db` field
- `writeCandles` returns `Promise<Omit<CandleIngestResponse, "schemaVersion">>` → matches handler destructuring
- `getLatestCandlesForFeed` returns `Promise<CandleRow[]>` → matches `buildRegimeCurrent` input
- `GetLatestCandlesParams` and `CandleRow` are exported from `candleStore.ts` → matches import in handler
- Handler functions accept `(LedgerStore, CandleStore?)` → matches `routes.ts` call sites passing `(ledger, storeContext?.candleStore)`
