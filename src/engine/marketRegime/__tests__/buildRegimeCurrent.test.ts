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
    const nowUnixMs = lastCandleUnixMs + 50 * 60 * 1000;
    const response = buildRegimeCurrent({
      feed,
      candles: flatCandles,
      nowUnixMs,
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

describe("buildRegimeCurrent freshness close-age semantics", () => {
  it("ages direct 15m freshness from candle close time", () => {
    const lastCandleOpenUnixMs = flatCandles[flatCandles.length - 1].unixMs;
    const closeUnixMs = lastCandleOpenUnixMs + FIFTEEN_MIN_MS;
    const nowUnixMs = closeUnixMs + 3 * 60 * 1000;
    const response = buildRegimeCurrent({
      feed,
      candles: flatCandles,
      nowUnixMs,
      config: MARKET_REGIME_CONFIG["15m"],
      configVersion: "market-regime-2.0.0",
      engineVersion: "0.1.0",
      metadata: { sourceTimeframe: "15m", sourceCandleCount: flatCandles.length }
    });

    expect(response.freshness.lastCandleOpenUnixMs).toBe(lastCandleOpenUnixMs);
    expect(response.freshness.lastCandleCloseUnixMs).toBe(closeUnixMs);
    expect(response.freshness.ageSeconds).toBe(3 * 60);
  });

  it("ages derived 1h freshness ~48m for a [01:00, 02:00) candle evaluated at 02:48", () => {
    const open0100 = Date.parse("2026-04-26T01:00:00.000Z");
    const ONE_HOUR = 60 * 60 * 1000;
    const aggregated = Array.from({ length: 60 }, (_, i) => ({
      unixMs: open0100 - (59 - i) * ONE_HOUR,
      open: 100,
      high: 100.5,
      low: 99.5,
      close: 100,
      volume: 1
    }));
    const nowUnixMs = Date.parse("2026-04-26T02:48:00.000Z");

    const response = buildRegimeCurrent({
      feed: { ...feed, timeframe: "1h" as const },
      candles: aggregated,
      nowUnixMs,
      config: MARKET_REGIME_CONFIG["1h"],
      configVersion: "market-regime-2.0.0",
      engineVersion: "0.1.0",
      metadata: {
        sourceTimeframe: "15m",
        sourceCandleCount: aggregated.length * 4,
        derivedTimeframe: "1h",
        aggregationVersion: "ohlcv-agg-v1"
      }
    });

    expect(response.freshness.lastCandleOpenIso).toBe("2026-04-26T01:00:00.000Z");
    expect(response.freshness.lastCandleCloseIso).toBe("2026-04-26T02:00:00.000Z");
    expect(response.freshness.ageSeconds).toBe(48 * 60);
    expect(response.freshness.softStale).toBe(false);
    expect(response.freshness.hardStale).toBe(false);
  });

  it("flags hardStale on derived 1h close-age past the 90m hard threshold", () => {
    const open0100 = Date.parse("2026-04-26T01:00:00.000Z");
    const ONE_HOUR = 60 * 60 * 1000;
    const aggregated = Array.from({ length: 60 }, (_, i) => ({
      unixMs: open0100 - (59 - i) * ONE_HOUR,
      open: 100,
      high: 100.5,
      low: 99.5,
      close: 100,
      volume: 1
    }));
    const nowUnixMs = Date.parse("2026-04-26T03:31:00.000Z");

    const response = buildRegimeCurrent({
      feed: { ...feed, timeframe: "1h" as const },
      candles: aggregated,
      nowUnixMs,
      config: MARKET_REGIME_CONFIG["1h"],
      configVersion: "market-regime-2.0.0",
      engineVersion: "0.1.0",
      metadata: {
        sourceTimeframe: "15m",
        sourceCandleCount: aggregated.length * 4,
        derivedTimeframe: "1h",
        aggregationVersion: "ohlcv-agg-v1"
      }
    });

    expect(response.freshness.softStale).toBe(true);
    expect(response.freshness.hardStale).toBe(true);
    expect(response.marketReasons.map((r) => r.code)).toContain("DATA_HARD_STALE");
  });
});
