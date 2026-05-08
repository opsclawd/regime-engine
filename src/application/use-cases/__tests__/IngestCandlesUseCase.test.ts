import { describe, expect, it } from "vitest";
import { createIngestCandlesUseCase } from "../ingestCandlesUseCase.js";
import { FakeCandleWritePort } from "./fakes/fakeCandleWritePort.js";
import type { CandleIngestRequest } from "../../../contract/v1/types.js";

const FIFTEEN_MIN_MS = 15 * 60 * 1000;

const makeRequest = (overrides: Partial<CandleIngestRequest> = {}): CandleIngestRequest => ({
  schemaVersion: "1.0",
  source: "birdeye",
  network: "solana-mainnet",
  poolAddress: "Pool111",
  symbol: "SOL/USDC",
  timeframe: "15m",
  sourceRecordedAtIso: "2026-04-26T12:00:00.000Z",
  candles: [
    { unixMs: 1 * FIFTEEN_MIN_MS, open: 100, high: 110, low: 90, close: 105, volume: 1 },
    { unixMs: 2 * FIFTEEN_MIN_MS, open: 105, high: 115, low: 100, close: 110, volume: 2 },
    { unixMs: 3 * FIFTEEN_MIN_MS, open: 110, high: 120, low: 105, close: 115, volume: 3 }
  ],
  ...overrides
});

describe("IngestCandlesUseCase", () => {
  it("inserts brand-new slots", async () => {
    const port = new FakeCandleWritePort();
    const useCase = createIngestCandlesUseCase({ candleWritePort: port });
    const result = await useCase(makeRequest(), 1_700_000_000_000);

    expect(result).toEqual({
      insertedCount: 3,
      revisedCount: 0,
      idempotentCount: 0,
      rejectedCount: 0,
      rejections: []
    });
    expect(port.totalRevisions()).toBe(3);
    expect(port.lockCalls).toHaveLength(1);
    expect(port.lockCalls[0].unixMsValues).toEqual([
      1 * FIFTEEN_MIN_MS,
      2 * FIFTEEN_MIN_MS,
      3 * FIFTEEN_MIN_MS
    ]);
  });

  it("byte-equal replay is idempotent without new rows", async () => {
    const port = new FakeCandleWritePort();
    const useCase = createIngestCandlesUseCase({ candleWritePort: port });
    await useCase(makeRequest(), 1_700_000_000_000);
    const result = await useCase(makeRequest(), 1_700_000_001_000);

    expect(result).toEqual({
      insertedCount: 0,
      revisedCount: 0,
      idempotentCount: 3,
      rejectedCount: 0,
      rejections: []
    });
    expect(port.totalRevisions()).toBe(3);
  });

  it("appends a revision when sourceRecordedAtIso advances and OHLCV differs", async () => {
    const port = new FakeCandleWritePort();
    const useCase = createIngestCandlesUseCase({ candleWritePort: port });
    await useCase(makeRequest(), 1_700_000_000_000);

    const newer = makeRequest({
      sourceRecordedAtIso: "2026-04-26T13:00:00.000Z",
      candles: [
        { unixMs: 1 * FIFTEEN_MIN_MS, open: 101, high: 111, low: 91, close: 106, volume: 11 },
        { unixMs: 2 * FIFTEEN_MIN_MS, open: 106, high: 116, low: 101, close: 111, volume: 22 },
        { unixMs: 3 * FIFTEEN_MIN_MS, open: 111, high: 121, low: 106, close: 116, volume: 33 }
      ]
    });
    const result = await useCase(newer, 1_700_000_002_000);

    expect(result).toEqual({
      insertedCount: 0,
      revisedCount: 3,
      idempotentCount: 0,
      rejectedCount: 0,
      rejections: []
    });
    expect(port.totalRevisions()).toBe(6);
  });

  it("rejects per-slot when sourceRecordedAtIso is older with different OHLCV", async () => {
    const port = new FakeCandleWritePort();
    const useCase = createIngestCandlesUseCase({ candleWritePort: port });
    await useCase(
      makeRequest({ sourceRecordedAtIso: "2026-04-26T13:00:00.000Z" }),
      1_700_000_000_000
    );

    const stale = makeRequest({
      sourceRecordedAtIso: "2026-04-26T12:00:00.000Z",
      candles: [
        { unixMs: 1 * FIFTEEN_MIN_MS, open: 200, high: 210, low: 190, close: 205, volume: 1 }
      ]
    });
    const result = await useCase(stale, 1_700_000_001_000);

    expect(result.insertedCount).toBe(0);
    expect(result.rejectedCount).toBe(1);
    expect(result.rejections).toEqual([
      {
        unixMs: 1 * FIFTEEN_MIN_MS,
        reason: "STALE_REVISION",
        existingSourceRecordedAtIso: "2026-04-26T13:00:00.000Z"
      }
    ]);
  });

  it("mixes inserted/revised/idempotent/rejected and sorts rejections by unixMs", async () => {
    const port = new FakeCandleWritePort();
    const useCase = createIngestCandlesUseCase({ candleWritePort: port });
    await useCase(
      makeRequest({
        sourceRecordedAtIso: "2026-04-26T13:00:00.000Z",
        candles: [
          { unixMs: 1 * FIFTEEN_MIN_MS, open: 100, high: 110, low: 90, close: 105, volume: 1 },
          { unixMs: 2 * FIFTEEN_MIN_MS, open: 105, high: 115, low: 100, close: 110, volume: 2 },
          { unixMs: 5 * FIFTEEN_MIN_MS, open: 130, high: 140, low: 125, close: 135, volume: 5 }
        ]
      }),
      1_700_000_000_000
    );

    const mixed = makeRequest({
      sourceRecordedAtIso: "2026-04-26T12:00:00.000Z",
      candles: [
        { unixMs: 5 * FIFTEEN_MIN_MS, open: 999, high: 999, low: 999, close: 999, volume: 9 },
        { unixMs: 1 * FIFTEEN_MIN_MS, open: 100, high: 110, low: 90, close: 105, volume: 1 },
        { unixMs: 2 * FIFTEEN_MIN_MS, open: 999, high: 999, low: 999, close: 999, volume: 9 },
        { unixMs: 3 * FIFTEEN_MIN_MS, open: 110, high: 120, low: 105, close: 115, volume: 3 }
      ]
    });
    const result = await useCase(mixed, 1_700_000_002_000);

    expect(result.idempotentCount).toBe(1);
    expect(result.insertedCount).toBe(1);
    expect(result.revisedCount).toBe(0);
    expect(result.rejectedCount).toBe(2);
    expect(result.rejections.map((r) => r.unixMs)).toEqual([
      2 * FIFTEEN_MIN_MS,
      5 * FIFTEEN_MIN_MS
    ]);
    expect(result.rejections[0].reason).toBe("STALE_REVISION");
    expect(result.rejections[0].existingSourceRecordedAtIso).toBe("2026-04-26T13:00:00.000Z");
  });

  it("throws on unparsable sourceRecordedAtIso", async () => {
    const port = new FakeCandleWritePort();
    const useCase = createIngestCandlesUseCase({ candleWritePort: port });
    await expect(
      useCase(makeRequest({ sourceRecordedAtIso: "not-a-date" }), 1_700_000_000_000)
    ).rejects.toThrow(/Invalid sourceRecordedAtIso/);
  });
});
