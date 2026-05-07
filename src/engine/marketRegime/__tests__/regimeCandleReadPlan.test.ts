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

  it("returns mode direct", () => {
    expect(plan.mode).toBe("direct");
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

  it("uses sourceLimit = max(volLongWindow, minCandles) + READ_BUFFER", () => {
    const cfg = MARKET_REGIME_CONFIG["15m"];
    const expected = Math.max(cfg.indicators.volLongWindow, cfg.suitability.minCandles) + 50;
    expect(plan.sourceLimit).toBe(expected);
  });

  it("returns direct sourceMetadata", () => {
    expect(plan.sourceMetadata).toEqual({ sourceTimeframe: "15m" });
  });

  it("does not have derivedCutoffUnixMs on the direct plan", () => {
    expect("derivedCutoffUnixMs" in plan).toBe(false);
  });
});

describe("buildRegimeCandleReadPlan(1h)", () => {
  const plan = buildRegimeCandleReadPlan({
    requestedTimeframe: "1h",
    nowUnixMs: NOW
  });

  it("returns mode derived", () => {
    expect(plan.mode).toBe("derived");
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
    if (plan.mode !== "derived") throw new Error("expected derived mode");
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

  it("returns derived sourceMetadata", () => {
    expect(plan.sourceMetadata).toEqual({
      sourceTimeframe: "15m",
      derivedTimeframe: "1h",
      aggregationVersion: "ohlcv-agg-v1"
    });
  });

  it("has derivedCutoffUnixMs as a required number (not optional)", () => {
    if (plan.mode !== "derived") throw new Error("expected derived mode");
    expect(typeof plan.derivedCutoffUnixMs).toBe("number");
  });
});
