import { describe, expect, it } from "vitest";
import { MARKET_REGIME_CONFIG } from "../config.js";

describe("MARKET_REGIME_CONFIG[15m]", () => {
  it("has timeframeMs equal to 15 minutes", () => {
    expect(MARKET_REGIME_CONFIG["15m"].timeframeMs).toBe(15 * 60 * 1000);
  });

  it("has retuned indicator windows preserving 1h horizons on 15m bars", () => {
    const config = MARKET_REGIME_CONFIG["15m"];
    expect(config.indicators.volShortWindow).toBe(32);
    expect(config.indicators.volLongWindow).toBe(84);
    expect(config.indicators.trendWindow).toBe(56);
    expect(config.indicators.compressionWindow).toBe(80);
    expect(config.regime.confirmBars).toBe(2);
    expect(config.suitability.minCandles).toBe(120);
  });

  it("has retuned freshness thresholds for 15m granularity", () => {
    const config = MARKET_REGIME_CONFIG["15m"];
    expect(config.freshness.closedCandleDelayMs).toBe(2 * 60 * 1000);
    expect(config.freshness.softStaleMs).toBe(25 * 60 * 1000);
    expect(config.freshness.hardStaleMs).toBe(35 * 60 * 1000);
  });
});
