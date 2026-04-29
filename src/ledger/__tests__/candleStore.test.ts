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
    { unixMs: 1 * ONE_HOUR_MS, open: 100, high: 110, low: 90,  close: 105, volume: 1 },
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
        { unixMs: 1 * ONE_HOUR_MS, open: 101, high: 111, low: 91,  close: 106, volume: 11 },
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
      symbol: "SOL/USDC", source: "birdeye", network: "solana-mainnet",
      poolAddress: "Pool111", timeframe: "1h",
      closedCandleCutoffUnixMs: 10 * ONE_HOUR_MS, limit: 100
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
      candles: [
        { unixMs: 1 * ONE_HOUR_MS, open: 200, high: 210, low: 190, close: 205, volume: 1 }
      ]
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
        { unixMs: 1 * ONE_HOUR_MS, open: 100, high: 110, low: 90,  close: 105, volume: 1 },
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
      symbol: "SOL/USDC", source: "birdeye", network: "solana-mainnet",
      poolAddress: "Pool111", timeframe: "1h",
      closedCandleCutoffUnixMs: 10 * ONE_HOUR_MS, limit: 100
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
      symbol: "SOL/USDC", source: "birdeye", network: "solana-mainnet",
      poolAddress: "Pool111", timeframe: "1h",
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
          open: 100 + i, high: 110 + i, low: 90 + i, close: 105 + i, volume: i + 1
        }))
      }),
      1_700_000_000_000
    );

    const result = await store.getLatestCandlesForFeed({
      symbol: "SOL/USDC", source: "birdeye", network: "solana-mainnet",
      poolAddress: "Pool111", timeframe: "1h",
      closedCandleCutoffUnixMs: 25 * ONE_HOUR_MS,
      limit: 5
    });

    expect(result.length).toBe(5);
  });

  it("dedup works without unique index — latest revision wins", async () => {
    await store.writeCandles(
      makeRequest({
        sourceRecordedAtIso: "2026-04-26T12:00:00.000Z",
        candles: [
          { unixMs: 1 * ONE_HOUR_MS, open: 100, high: 110, low: 90, close: 105, volume: 1 }
        ]
      }),
      1_700_000_000_000
    );

    await store.writeCandles(
      makeRequest({
        sourceRecordedAtIso: "2026-04-26T13:00:00.000Z",
        candles: [
          { unixMs: 1 * ONE_HOUR_MS, open: 101, high: 111, low: 91, close: 106, volume: 2 }
        ]
      }),
      1_700_000_001_000
    );

    const latest = await store.getLatestCandlesForFeed({
      symbol: "SOL/USDC", source: "birdeye", network: "solana-mainnet",
      poolAddress: "Pool111", timeframe: "1h",
      closedCandleCutoffUnixMs: 10 * ONE_HOUR_MS, limit: 100
    });

    expect(latest.length).toBe(1);
    expect(latest[0].close).toBe(106);
  });
});