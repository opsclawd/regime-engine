import { describe, expect, it } from "vitest";
import { computeFreshness } from "../freshness.js";

const ONE_MIN_MS = 60 * 1000;
const FIFTEEN_MIN_MS = 15 * ONE_MIN_MS;
const ONE_HOUR_MS = 60 * ONE_MIN_MS;

const config = {
  softStaleMs: 75 * ONE_MIN_MS,
  hardStaleMs: 90 * ONE_MIN_MS
};

describe("computeFreshness", () => {
  it("ages a direct 15m candle from its close time", () => {
    const open = Date.parse("2026-04-26T02:30:00.000Z");
    const now = Date.parse("2026-04-26T02:48:00.000Z");
    const result = computeFreshness(now, open, FIFTEEN_MIN_MS, config);

    expect(result.lastCandleOpenUnixMs).toBe(open);
    expect(result.lastCandleOpenIso).toBe("2026-04-26T02:30:00.000Z");
    expect(result.lastCandleCloseUnixMs).toBe(open + FIFTEEN_MIN_MS);
    expect(result.lastCandleCloseIso).toBe("2026-04-26T02:45:00.000Z");
    expect(result.ageSeconds).toBe(3 * 60);
    expect(result.softStale).toBe(false);
    expect(result.hardStale).toBe(false);
  });

  it("ages a derived 1h candle from its close time, not bucket open", () => {
    const open = Date.parse("2026-04-26T01:00:00.000Z");
    const now = Date.parse("2026-04-26T02:48:00.000Z");
    const result = computeFreshness(now, open, ONE_HOUR_MS, config);

    expect(result.lastCandleCloseIso).toBe("2026-04-26T02:00:00.000Z");
    expect(result.ageSeconds).toBe(48 * 60);
    expect(result.softStale).toBe(false);
    expect(result.hardStale).toBe(false);
  });

  it("flags hardStale on the derived 1h close-age boundary", () => {
    const open = Date.parse("2026-04-26T01:00:00.000Z");
    const now = Date.parse("2026-04-26T03:31:00.000Z");
    const result = computeFreshness(now, open, ONE_HOUR_MS, config);

    expect(result.softStale).toBe(true);
    expect(result.hardStale).toBe(true);
  });

  it("clamps future-close candles to ageSeconds 0", () => {
    const open = Date.parse("2026-04-26T02:00:00.000Z");
    const now = Date.parse("2026-04-26T02:30:00.000Z");
    const result = computeFreshness(now, open, ONE_HOUR_MS, config);

    expect(result.ageSeconds).toBe(0);
    expect(result.softStale).toBe(false);
    expect(result.hardStale).toBe(false);
  });

  it("populates generatedAtIso and threshold seconds", () => {
    const open = Date.parse("2026-04-26T12:00:00.000Z");
    const now = open + 30 * ONE_MIN_MS;
    const result = computeFreshness(now, open, FIFTEEN_MIN_MS, config);

    expect(result.generatedAtIso).toBe(new Date(now).toISOString());
    expect(result.softStaleSeconds).toBe(75 * 60);
    expect(result.hardStaleSeconds).toBe(90 * 60);
  });

  it("does not return legacy lastCandleUnixMs or lastCandleIso fields", () => {
    const open = Date.parse("2026-04-26T01:00:00.000Z");
    const now = open + 5 * ONE_MIN_MS;
    const result = computeFreshness(now, open, ONE_HOUR_MS, config) as Record<string, unknown>;

    expect(result.lastCandleUnixMs).toBeUndefined();
    expect(result.lastCandleIso).toBeUndefined();
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "throws for invalid timeframeMs %p",
    (bad) => {
      const open = Date.parse("2026-04-26T01:00:00.000Z");
      expect(() => computeFreshness(open + 1000, open, bad, config)).toThrow(
        /timeframeMs must be a positive finite number/
      );
    }
  );
});
