import { describe, expect, it } from "vitest";
import { buildRegimeCurrent } from "../buildRegimeCurrent.js";
import { aggregate15mTo1h } from "../../candles/aggregateCandles.js";
import { MARKET_REGIME_CONFIG } from "../config.js";

const FIFTEEN_MIN_MS = 15 * 60 * 1000;

const flatCandles = Array.from({ length: 130 }, (_, i) => ({
  unixMs: (i + 1) * FIFTEEN_MIN_MS,
  open: 100,
  high: 100.5,
  low: 99.5,
  close: 100,
  volume: 1
}));

const fewCandles = flatCandles.slice(0, 5);

const feed = {
  symbol: "SOL/USDC",
  source: "birdeye",
  network: "solana-mainnet",
  poolAddress: "Pool111",
  timeframe: "15m" as const
};

describe("buildRegimeCurrent", () => {
  it("classifies CHOP and emits ALLOWED for flat candles + fresh data", () => {
    const lastCandleUnixMs = flatCandles[flatCandles.length - 1].unixMs;
    const response = buildRegimeCurrent({
      feed,
      candles: flatCandles,
      nowUnixMs: lastCandleUnixMs + 20 * 60 * 1000,
      config: MARKET_REGIME_CONFIG["15m"],
      configVersion: "market-regime-1.0.0",
      engineVersion: "0.1.0",
      metadata: { sourceTimeframe: "15m", sourceCandleCount: flatCandles.length }
    });

    expect(response.regime).toBe("CHOP");
    expect(response.clmmSuitability.status).toBe("ALLOWED");
    expect(response.metadata.candleCount).toBe(130);
    expect(response.metadata.engineVersion).toBe("0.1.0");
    expect(response.metadata.configVersion).toBe("market-regime-1.0.0");
    expect(response.symbol).toBe("SOL/USDC");
  });

  it("returns UNKNOWN when candleCount < minCandles even for fresh data", () => {
    const lastCandleUnixMs = fewCandles[fewCandles.length - 1].unixMs;
    const response = buildRegimeCurrent({
      feed,
      candles: fewCandles,
      nowUnixMs: lastCandleUnixMs + 20 * 60 * 1000,
      config: MARKET_REGIME_CONFIG["15m"],
      configVersion: "market-regime-1.0.0",
      engineVersion: "0.1.0",
      metadata: { sourceTimeframe: "15m", sourceCandleCount: fewCandles.length }
    });
    expect(response.clmmSuitability.status).toBe("UNKNOWN");
    expect(response.marketReasons.map((r) => r.code)).toContain("DATA_INSUFFICIENT_SAMPLES");
  });

  it("returns UNKNOWN when freshness is hardStale", () => {
    const lastCandleUnixMs = flatCandles[flatCandles.length - 1].unixMs;
    const response = buildRegimeCurrent({
      feed,
      candles: flatCandles,
      nowUnixMs: lastCandleUnixMs + 40 * 60 * 1000,
      config: MARKET_REGIME_CONFIG["15m"],
      configVersion: "market-regime-1.0.0",
      engineVersion: "0.1.0",
      metadata: { sourceTimeframe: "15m", sourceCandleCount: flatCandles.length }
    });
    expect(response.clmmSuitability.status).toBe("UNKNOWN");
    expect(response.marketReasons.map((r) => r.code)).toContain("DATA_HARD_STALE");
  });

  it("passes through caller-supplied metadata fields without interpreting them", () => {
    const lastCandleUnixMs = flatCandles[flatCandles.length - 1].unixMs;
    const response = buildRegimeCurrent({
      feed: { ...feed, timeframe: "1h" as const },
      candles: flatCandles,
      nowUnixMs: lastCandleUnixMs + 20 * 60 * 1000,
      config: MARKET_REGIME_CONFIG["1h"],
      configVersion: "market-regime-2.0.0",
      engineVersion: "0.1.0",
      metadata: {
        sourceTimeframe: "15m",
        sourceCandleCount: 520,
        derivedTimeframe: "1h",
        aggregationVersion: "ohlcv-agg-v1"
      }
    });
    expect(response.timeframe).toBe("1h");
    expect(response.metadata.sourceTimeframe).toBe("15m");
    expect(response.metadata.sourceCandleCount).toBe(520);
    expect(response.metadata.derivedTimeframe).toBe("1h");
    expect(response.metadata.aggregationVersion).toBe("ohlcv-agg-v1");
    expect(response.metadata.candleCount).toBe(130);
  });

  it("omits derived metadata fields when caller provides only source fields", () => {
    const lastCandleUnixMs = flatCandles[flatCandles.length - 1].unixMs;
    const response = buildRegimeCurrent({
      feed,
      candles: flatCandles,
      nowUnixMs: lastCandleUnixMs + 20 * 60 * 1000,
      config: MARKET_REGIME_CONFIG["15m"],
      configVersion: "market-regime-2.0.0",
      engineVersion: "0.1.0",
      metadata: {
        sourceTimeframe: "15m",
        sourceCandleCount: 130
      }
    });
    expect(response.metadata.sourceTimeframe).toBe("15m");
    expect(response.metadata.sourceCandleCount).toBe(130);
    expect(response.metadata.derivedTimeframe).toBeUndefined();
    expect(response.metadata.aggregationVersion).toBeUndefined();
  });
});

describe("buildRegimeCurrent with aggregated 1h candles", () => {
  it("classifies using aggregated 1h candles passed to 1h config", () => {
    const { candles: aggregated } = aggregate15mTo1h(flatCandles);
    expect(aggregated.length).toBeGreaterThan(0);

    const lastCandleUnixMs = aggregated[aggregated.length - 1].unixMs;
    const response = buildRegimeCurrent({
      feed: { ...feed, timeframe: "1h" as const },
      candles: aggregated,
      nowUnixMs: lastCandleUnixMs + 20 * 60 * 1000,
      config: MARKET_REGIME_CONFIG["1h"],
      configVersion: "market-regime-2.0.0",
      engineVersion: "0.1.0",
      metadata: {
        sourceTimeframe: "15m",
        sourceCandleCount: flatCandles.length,
        derivedTimeframe: "1h",
        aggregationVersion: "ohlcv-agg-v1"
      }
    });
    expect(response.timeframe).toBe("1h");
    expect(response.metadata.sourceTimeframe).toBe("15m");
    expect(response.metadata.sourceCandleCount).toBe(flatCandles.length);
    expect(response.metadata.derivedTimeframe).toBe("1h");
    expect(response.metadata.aggregationVersion).toBe("ohlcv-agg-v1");
    expect(response.metadata.candleCount).toBe(aggregated.length);
    expect(["UP", "DOWN", "CHOP"]).toContain(response.regime);
  });
});
