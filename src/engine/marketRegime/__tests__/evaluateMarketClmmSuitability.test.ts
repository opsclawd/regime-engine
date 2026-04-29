import { describe, expect, it } from "vitest";
import { evaluateMarketClmmSuitability } from "../evaluateMarketClmmSuitability.js";
import { MARKET_REGIME_CONFIG } from "../config.js";

const cfg = MARKET_REGIME_CONFIG["1h"].suitability;

const baseTelemetry = {
  realizedVolShort: 0.01,
  realizedVolLong: 0.01,
  volRatio: 0.5,
  trendStrength: 0,
  compression: 0.05
};

const fresh = { hardStale: false, softStale: false };
const stale = { hardStale: false, softStale: true };
const dead = { hardStale: true, softStale: true };
const sufficient = 30;
const insufficient = 5;

describe("evaluateMarketClmmSuitability", () => {
  it("returns UNKNOWN with CLMM_UNKNOWN_INSUFFICIENT_SAMPLES when below minCandles", () => {
    const r = evaluateMarketClmmSuitability({
      regime: "CHOP",
      telemetry: baseTelemetry,
      freshness: fresh,
      candleCount: insufficient,
      config: cfg
    });
    expect(r.status).toBe("UNKNOWN");
    expect(r.reasons.map((x) => x.code)).toEqual(["CLMM_UNKNOWN_INSUFFICIENT_SAMPLES"]);
  });

  it("returns UNKNOWN with CLMM_UNKNOWN_HARD_STALE_DATA when hardStale", () => {
    const r = evaluateMarketClmmSuitability({
      regime: "CHOP",
      telemetry: baseTelemetry,
      freshness: dead,
      candleCount: sufficient,
      config: cfg
    });
    expect(r.status).toBe("UNKNOWN");
    expect(r.reasons.map((x) => x.code)).toEqual(["CLMM_UNKNOWN_HARD_STALE_DATA"]);
  });

  it("returns BLOCKED CLMM_BLOCKED_TRENDING_UP for UP regime even with fresh data", () => {
    const r = evaluateMarketClmmSuitability({
      regime: "UP",
      telemetry: baseTelemetry,
      freshness: fresh,
      candleCount: sufficient,
      config: cfg
    });
    expect(r.status).toBe("BLOCKED");
    expect(r.reasons.map((x) => x.code)).toContain("CLMM_BLOCKED_TRENDING_UP");
  });

  it("returns BLOCKED CLMM_BLOCKED_TRENDING_DOWN for DOWN regime", () => {
    const r = evaluateMarketClmmSuitability({
      regime: "DOWN",
      telemetry: baseTelemetry,
      freshness: fresh,
      candleCount: sufficient,
      config: cfg
    });
    expect(r.status).toBe("BLOCKED");
    expect(r.reasons.map((x) => x.code)).toContain("CLMM_BLOCKED_TRENDING_DOWN");
  });

  it("returns BLOCKED on extreme volRatio for CHOP regime", () => {
    const r = evaluateMarketClmmSuitability({
      regime: "CHOP",
      telemetry: { ...baseTelemetry, volRatio: cfg.extremeVolRatio + 0.01 },
      freshness: fresh,
      candleCount: sufficient,
      config: cfg
    });
    expect(r.status).toBe("BLOCKED");
    expect(r.reasons.map((x) => x.code)).toContain("CLMM_BLOCKED_EXTREME_VOLATILITY");
  });

  it("returns BLOCKED on extreme compression for CHOP regime", () => {
    const r = evaluateMarketClmmSuitability({
      regime: "CHOP",
      telemetry: { ...baseTelemetry, compression: cfg.extremeCompression + 0.01 },
      freshness: fresh,
      candleCount: sufficient,
      config: cfg
    });
    expect(r.status).toBe("BLOCKED");
    expect(r.reasons.map((x) => x.code)).toContain("CLMM_BLOCKED_EXTREME_COMPRESSION");
  });

  it("appends UP + extreme vol BLOCKED reasons but no caution reasons", () => {
    const r = evaluateMarketClmmSuitability({
      regime: "UP",
      telemetry: { ...baseTelemetry, volRatio: cfg.extremeVolRatio + 0.01 },
      freshness: stale,
      candleCount: sufficient,
      config: cfg
    });
    expect(r.status).toBe("BLOCKED");
    const codes = r.reasons.map((x) => x.code);
    expect(codes).toContain("CLMM_BLOCKED_TRENDING_UP");
    expect(codes).toContain("CLMM_BLOCKED_EXTREME_VOLATILITY");
    expect(codes).not.toContain("CLMM_CAUTION_SOFT_STALE_DATA");
    expect(codes).not.toContain("CLMM_CAUTION_ELEVATED_VOLATILITY");
  });

  it("returns CAUTION CLMM_CAUTION_SOFT_STALE_DATA for CHOP + softStale", () => {
    const r = evaluateMarketClmmSuitability({
      regime: "CHOP",
      telemetry: baseTelemetry,
      freshness: stale,
      candleCount: sufficient,
      config: cfg
    });
    expect(r.status).toBe("CAUTION");
    expect(r.reasons.map((x) => x.code)).toContain("CLMM_CAUTION_SOFT_STALE_DATA");
  });

  it("returns CAUTION CLMM_CAUTION_ELEVATED_VOLATILITY for CHOP + elevated non-extreme vol", () => {
    const r = evaluateMarketClmmSuitability({
      regime: "CHOP",
      telemetry: { ...baseTelemetry, volRatio: cfg.allowedVolRatioMax + 0.01 },
      freshness: fresh,
      candleCount: sufficient,
      config: cfg
    });
    expect(r.status).toBe("CAUTION");
    expect(r.reasons.map((x) => x.code)).toContain("CLMM_CAUTION_ELEVATED_VOLATILITY");
  });

  it("appends both caution reasons when soft-stale and elevated vol are simultaneous", () => {
    const r = evaluateMarketClmmSuitability({
      regime: "CHOP",
      telemetry: { ...baseTelemetry, volRatio: cfg.allowedVolRatioMax + 0.01 },
      freshness: stale,
      candleCount: sufficient,
      config: cfg
    });
    expect(r.status).toBe("CAUTION");
    const codes = r.reasons.map((x) => x.code);
    expect(codes).toContain("CLMM_CAUTION_SOFT_STALE_DATA");
    expect(codes).toContain("CLMM_CAUTION_ELEVATED_VOLATILITY");
  });

  it("returns ALLOWED CLMM_ALLOWED_CHOP_FRESH for fresh + sufficient + low-vol CHOP", () => {
    const r = evaluateMarketClmmSuitability({
      regime: "CHOP",
      telemetry: baseTelemetry,
      freshness: fresh,
      candleCount: sufficient,
      config: cfg
    });
    expect(r.status).toBe("ALLOWED");
    expect(r.reasons.map((x) => x.code)).toEqual(["CLMM_ALLOWED_CHOP_FRESH"]);
  });
});
