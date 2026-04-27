import { afterEach, describe, expect, it } from "vitest";
import { createLedgerStore, getLedgerCounts } from "../store.js";
import { writeCandles, getLatestCandlesForFeed } from "../candlesWriter.js";
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

describe("writeCandles", () => {
  let store: ReturnType<typeof createLedgerStore>;

  afterEach(() => {
    store?.close();
  });

  it("inserts brand-new slots", () => {
    store = createLedgerStore(":memory:");
    const result = writeCandles(store, makeRequest(), 1_700_000_000_000);

    expect(result).toEqual({
      insertedCount: 3,
      revisedCount: 0,
      idempotentCount: 0,
      rejectedCount: 0,
      rejections: []
    });
    expect(getLedgerCounts(store).candleRevisions).toBe(3);
  });

  it("byte-equal replay is idempotent without new rows", () => {
    store = createLedgerStore(":memory:");
    writeCandles(store, makeRequest(), 1_700_000_000_000);

    const result = writeCandles(store, makeRequest(), 1_700_000_001_000);

    expect(result).toEqual({
      insertedCount: 0,
      revisedCount: 0,
      idempotentCount: 3,
      rejectedCount: 0,
      rejections: []
    });
    expect(getLedgerCounts(store).candleRevisions).toBe(3);
  });

  it("appends a revision when sourceRecordedAtIso advances and OHLCV differs", () => {
    store = createLedgerStore(":memory:");
    writeCandles(store, makeRequest(), 1_700_000_000_000);

    const newer = makeRequest({
      sourceRecordedAtIso: "2026-04-26T13:00:00.000Z",
      candles: [
        { unixMs: 1 * ONE_HOUR_MS, open: 101, high: 111, low: 91,  close: 106, volume: 11 },
        { unixMs: 2 * ONE_HOUR_MS, open: 106, high: 116, low: 101, close: 111, volume: 22 },
        { unixMs: 3 * ONE_HOUR_MS, open: 111, high: 121, low: 106, close: 116, volume: 33 }
      ]
    });

    const result = writeCandles(store, newer, 1_700_000_002_000);

    expect(result).toEqual({
      insertedCount: 0,
      revisedCount: 3,
      idempotentCount: 0,
      rejectedCount: 0,
      rejections: []
    });
    expect(getLedgerCounts(store).candleRevisions).toBe(6);

    const latest = getLatestCandlesForFeed(store, {
      symbol: "SOL/USDC", source: "birdeye", network: "solana-mainnet",
      poolAddress: "Pool111", timeframe: "1h",
      closedCandleCutoffUnixMs: 10 * ONE_HOUR_MS, limit: 100
    });
    expect(latest.map((c) => c.close)).toEqual([106, 111, 116]);
  });

  it("rejects per-slot when sourceRecordedAtIso is older with different OHLCV", () => {
    store = createLedgerStore(":memory:");
    writeCandles(
      store,
      makeRequest({ sourceRecordedAtIso: "2026-04-26T13:00:00.000Z" }),
      1_700_000_000_000
    );

    const stale = makeRequest({
      sourceRecordedAtIso: "2026-04-26T12:00:00.000Z",
      candles: [
        { unixMs: 1 * ONE_HOUR_MS, open: 200, high: 210, low: 190, close: 205, volume: 1 }
      ]
    });

    const result = writeCandles(store, stale, 1_700_000_001_000);

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

  it("mixes inserted/revised/idempotent/rejected in one batch", () => {
    store = createLedgerStore(":memory:");

    writeCandles(
      store,
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

    const result = writeCandles(store, mixed, 1_700_000_002_000);

    expect(result.idempotentCount).toBe(1);
    expect(result.rejectedCount).toBe(1);
    expect(result.insertedCount).toBe(1);
    expect(result.revisedCount).toBe(0);
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0].unixMs).toBe(2 * ONE_HOUR_MS);
  });
});