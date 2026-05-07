import { describe, expect, it } from "vitest";
import type { Candle } from "../../../contract/v1/types.js";
import { aggregate15mTo1h, FIFTEEN_MIN_MS, ONE_HOUR_MS } from "../aggregateCandles.js";

const makeCandle = (unixMs: number, overrides: Partial<Candle> = {}): Candle => ({
  unixMs,
  open: 100,
  high: 101,
  low: 99,
  close: 100.5,
  volume: 1,
  ...overrides
});

const fourAlignedCandles = (hourOpenUnixMs: number): Candle[] => [
  makeCandle(hourOpenUnixMs, { open: 100, high: 102, low: 98, close: 101, volume: 5 }),
  makeCandle(hourOpenUnixMs + FIFTEEN_MIN_MS, {
    open: 101,
    high: 105,
    low: 100,
    close: 104,
    volume: 7
  }),
  makeCandle(hourOpenUnixMs + 2 * FIFTEEN_MIN_MS, {
    open: 104,
    high: 106,
    low: 103,
    close: 105,
    volume: 4
  }),
  makeCandle(hourOpenUnixMs + 3 * FIFTEEN_MIN_MS, {
    open: 105,
    high: 107,
    low: 102,
    close: 103,
    volume: 6
  })
];

describe("aggregate15mTo1h", () => {
  it("aggregates four aligned 15m candles into one 1h candle", () => {
    const hourOpen = 12 * ONE_HOUR_MS;
    const { candles, telemetry } = aggregate15mTo1h(fourAlignedCandles(hourOpen));
    expect(candles).toHaveLength(1);
    expect(candles[0].unixMs).toBe(hourOpen);
    expect(candles[0].open).toBe(100);
    expect(candles[0].high).toBe(107);
    expect(candles[0].low).toBe(98);
    expect(candles[0].close).toBe(103);
    expect(candles[0].volume).toBe(22);
    expect(telemetry.sourceCandleCount).toBe(4);
    expect(telemetry.completeBuckets).toBe(1);
    expect(telemetry.skippedNonInteger).toBe(0);
    expect(telemetry.skippedMisaligned).toBe(0);
    expect(telemetry.skippedIncomplete).toBe(0);
    expect(telemetry.skippedGapInBucket).toBe(0);
  });

  it("emits the 1h bucket open timestamp", () => {
    const hourOpen = 100 * ONE_HOUR_MS;
    const { candles } = aggregate15mTo1h(fourAlignedCandles(hourOpen));
    expect(candles[0].unixMs).toBe(hourOpen);
  });

  it("treats input order as irrelevant and emits sorted output", () => {
    const a = fourAlignedCandles(2 * ONE_HOUR_MS);
    const b = fourAlignedCandles(1 * ONE_HOUR_MS);
    const shuffled = [a[2], b[3], a[0], b[1], a[3], b[0], a[1], b[2]];
    const { candles } = aggregate15mTo1h(shuffled);
    expect(candles).toHaveLength(2);
    expect(candles[0].unixMs).toBe(1 * ONE_HOUR_MS);
    expect(candles[1].unixMs).toBe(2 * ONE_HOUR_MS);
  });

  it("skips an incomplete current-hour bucket (only 3 candles present)", () => {
    const hourOpen = 5 * ONE_HOUR_MS;
    const partial = fourAlignedCandles(hourOpen).slice(0, 3);
    const { candles, telemetry } = aggregate15mTo1h(partial);
    expect(candles).toHaveLength(0);
    expect(telemetry.skippedIncomplete).toBe(1);
  });

  it("skips a bucket with 4 candles that have a gap in position", () => {
    const hourOpen = 5 * ONE_HOUR_MS;
    const four = fourAlignedCandles(hourOpen);
    const gapped = [four[0], four[1], four[1], four[3]];
    const { candles, telemetry } = aggregate15mTo1h(gapped);
    expect(candles).toHaveLength(0);
    expect(telemetry.skippedGapInBucket).toBe(1);
  });

  it("ignores misaligned source timestamps", () => {
    const hourOpen = 5 * ONE_HOUR_MS;
    const four = fourAlignedCandles(hourOpen);
    const misaligned = [four[0], makeCandle(hourOpen + FIFTEEN_MIN_MS + 60_000), four[2], four[3]];
    const { candles, telemetry } = aggregate15mTo1h(misaligned);
    expect(candles).toHaveLength(0);
    expect(telemetry.skippedMisaligned).toBe(1);
  });

  it("does not aggregate across hour boundaries", () => {
    const hourOpenA = 5 * ONE_HOUR_MS;
    const hourOpenB = 6 * ONE_HOUR_MS;
    const incompleteA = fourAlignedCandles(hourOpenA).slice(0, 2);
    const incompleteB = fourAlignedCandles(hourOpenB).slice(2, 4);
    const { candles } = aggregate15mTo1h([...incompleteA, ...incompleteB]);
    expect(candles).toHaveLength(0);
  });

  it("emits multiple complete buckets independently", () => {
    const { candles } = aggregate15mTo1h([
      ...fourAlignedCandles(0),
      ...fourAlignedCandles(ONE_HOUR_MS)
    ]);
    expect(candles).toHaveLength(2);
    expect(candles[0].unixMs).toBe(0);
    expect(candles[1].unixMs).toBe(ONE_HOUR_MS);
  });

  it("returns an empty array for an empty input", () => {
    const { candles, telemetry } = aggregate15mTo1h([]);
    expect(candles).toEqual([]);
    expect(telemetry.sourceCandleCount).toBe(0);
  });

  it("skips candles with non-integer unixMs timestamps", () => {
    const hourOpen = 5 * ONE_HOUR_MS;
    const four = fourAlignedCandles(hourOpen);
    const withNonInteger = [
      makeCandle(hourOpen + 0.5, { volume: 10 }),
      four[0],
      four[1],
      four[2],
      four[3]
    ];
    const { candles, telemetry } = aggregate15mTo1h(withNonInteger);
    expect(candles).toHaveLength(1);
    expect(telemetry.skippedNonInteger).toBe(1);
    expect(telemetry.sourceCandleCount).toBe(5);
  });
});
