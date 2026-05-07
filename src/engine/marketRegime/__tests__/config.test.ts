import { describe, expect, it } from "vitest";
import { MARKET_REGIME_CONFIG } from "../config.js";
import {
  FIFTEEN_MIN_MS,
  ONE_HOUR_MS,
  FIFTEEN_MINUTES_PER_HOUR
} from "../../candles/aggregateCandles.js";

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

describe("MARKET_REGIME_CONFIG[1h]", () => {
  it("has timeframeMs equal to 1 hour", () => {
    expect(MARKET_REGIME_CONFIG["1h"].timeframeMs).toBe(60 * 60 * 1000);
  });

  it("has the original 1h indicator and regime windows", () => {
    const config = MARKET_REGIME_CONFIG["1h"];
    expect(config.indicators.volShortWindow).toBe(8);
    expect(config.indicators.volLongWindow).toBe(21);
    expect(config.indicators.trendWindow).toBe(14);
    expect(config.indicators.compressionWindow).toBe(20);
    expect(config.regime.confirmBars).toBe(1);
    expect(config.suitability.minCandles).toBe(30);
  });

  it("has the original 1h freshness thresholds", () => {
    const config = MARKET_REGIME_CONFIG["1h"];
    expect(config.freshness.closedCandleDelayMs).toBe(5 * 60 * 1000);
    expect(config.freshness.softStaleMs).toBe(75 * 60 * 1000);
    expect(config.freshness.hardStaleMs).toBe(90 * 60 * 1000);
  });
});

describe("aggregateCandles constants match config", () => {
  it("FIFTEEN_MIN_MS matches config 15m timeframeMs", () => {
    expect(FIFTEEN_MIN_MS).toBe(MARKET_REGIME_CONFIG["15m"].timeframeMs);
  });

  it("ONE_HOUR_MS matches config 1h timeframeMs", () => {
    expect(ONE_HOUR_MS).toBe(MARKET_REGIME_CONFIG["1h"].timeframeMs);
  });

  it("FIFTEEN_MINUTES_PER_HOUR equals the ratio", () => {
    expect(FIFTEEN_MINUTES_PER_HOUR).toBe(
      MARKET_REGIME_CONFIG["1h"].timeframeMs / MARKET_REGIME_CONFIG["15m"].timeframeMs
    );
  });
});
