import { describe, expect, it } from "vitest";
import { MARKET_REGIME_CONFIG } from "../config.js";
import { closedCandleCutoffUnixMs } from "../closedCandleCutoff.js";
import { buildRegimeCandleReadPlan } from "../regimeCandleReadPlan.js";

const NOW = 1_777_000_000_000;

describe("buildRegimeCandleReadPlan(15m)", () => {
  const plan = buildRegimeCandleReadPlan({
    requestedTimeframe: "15m",
    nowUnixMs: NOW
  });

  it("uses 15m as the stored source timeframe", () => {
    expect(plan.sourceTimeframe).toBe("15m");
  });

  it("computes sourceCutoffUnixMs from the 15m freshness config", () => {
    const cfg = MARKET_REGIME_CONFIG["15m"];
    expect(plan.sourceCutoffUnixMs).toBe(
      closedCandleCutoffUnixMs(NOW, cfg.timeframeMs, cfg.freshness.closedCandleDelayMs)
    );
  });

  it("does not produce a derived cutoff", () => {
    expect(plan.derivedCutoffUnixMs).toBeUndefined();
  });

  it("uses sourceLimit = max(volLongWindow, minCandles) + READ_BUFFER", () => {
    const cfg = MARKET_REGIME_CONFIG["15m"];
    const expected = Math.max(cfg.indicators.volLongWindow, cfg.suitability.minCandles) + 50;
    expect(plan.sourceLimit).toBe(expected);
  });

  it("returns direct metadata hints", () => {
    expect(plan.metadataHints).toEqual({ sourceTimeframe: "15m" });
  });
});

describe("buildRegimeCandleReadPlan(1h)", () => {
  const plan = buildRegimeCandleReadPlan({
    requestedTimeframe: "1h",
    nowUnixMs: NOW
  });

  it("uses 15m as the stored source timeframe", () => {
    expect(plan.sourceTimeframe).toBe("15m");
  });

  it("computes sourceCutoffUnixMs from the 15m freshness config", () => {
    const cfg = MARKET_REGIME_CONFIG["15m"];
    expect(plan.sourceCutoffUnixMs).toBe(
      closedCandleCutoffUnixMs(NOW, cfg.timeframeMs, cfg.freshness.closedCandleDelayMs)
    );
  });

  it("computes derivedCutoffUnixMs from the 1h freshness config", () => {
    const cfg = MARKET_REGIME_CONFIG["1h"];
    expect(plan.derivedCutoffUnixMs).toBe(
      closedCandleCutoffUnixMs(NOW, cfg.timeframeMs, cfg.freshness.closedCandleDelayMs)
    );
  });

  it("uses sourceLimit = requiredDerivedBars * 4 + DERIVED_SOURCE_READ_BUFFER_15M", () => {
    const cfg = MARKET_REGIME_CONFIG["1h"];
    const requiredDerivedBars =
      Math.max(cfg.indicators.volLongWindow, cfg.suitability.minCandles) + 50;
    const expected = requiredDerivedBars * 4 + 32;
    expect(plan.sourceLimit).toBe(expected);
  });

  it("returns derived metadata hints", () => {
    expect(plan.metadataHints).toEqual({
      sourceTimeframe: "15m",
      derivedTimeframe: "1h",
      aggregationVersion: "ohlcv-agg-v1"
    });
  });
});
