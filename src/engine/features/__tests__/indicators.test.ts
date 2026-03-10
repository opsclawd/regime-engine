import { describe, expect, it } from "vitest";
import type { Candle } from "../../../contract/v1/types.js";
import { computeIndicators } from "../indicators.js";

const fixtureCandles: Candle[] = Array.from({ length: 32 }, (_, index) => {
  const base = 100 + index * 0.85 + (index % 4 === 0 ? -0.35 : 0.2);
  const close = base + Math.sin(index / 3) * 0.55;
  return {
    unixMs: 1_762_500_000_000 + index * 3_600_000,
    open: base,
    high: close + 1.15,
    low: close - 1.25,
    close,
    volume: 1_000 + index * 13
  };
});

describe("feature indicators", () => {
  it("returns deterministic telemetry for the same fixture", () => {
    const first = computeIndicators(fixtureCandles);
    const second = computeIndicators(fixtureCandles);

    expect(first).toEqual(second);
  });

  it("normalizes candle order by unixMs", () => {
    const ascending = computeIndicators(fixtureCandles);
    const descending = computeIndicators([...fixtureCandles].reverse());

    expect(descending).toEqual(ascending);
  });

  it("matches fixture snapshot", () => {
    expect(computeIndicators(fixtureCandles)).toMatchSnapshot();
  });

  it("computes a volRatio that is neutral to window-length scaling", () => {
    const telemetry = computeIndicators(fixtureCandles, {
      volShortWindow: 8,
      volLongWindow: 21
    });

    const shortPerBarVol = telemetry.realizedVolShort / Math.sqrt(8);
    const longPerBarVol = telemetry.realizedVolLong / Math.sqrt(21);

    expect(telemetry.volRatio).toBeCloseTo(shortPerBarVol / longPerBarVol, 11);
    expect(telemetry.volRatio).not.toBeCloseTo(
      telemetry.realizedVolShort / telemetry.realizedVolLong,
      6
    );
  });
});
