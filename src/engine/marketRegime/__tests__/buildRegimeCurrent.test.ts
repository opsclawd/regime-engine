import { describe, expect, it } from "vitest";
import { buildRegimeCurrent } from "../buildRegimeCurrent.js";
import { MARKET_REGIME_CONFIG } from "../config.js";

const ONE_HOUR_MS = 60 * 60 * 1000;

const flatCandles = Array.from({ length: 40 }, (_, i) => ({
  unixMs: (i + 1) * ONE_HOUR_MS,
  open: 100,
  high: 100.5,
  low: 99.5,
  close: 100,
  volume: 1
}));

const feed = {
  symbol: "SOL/USDC",
  source: "birdeye",
  network: "solana-mainnet",
  poolAddress: "Pool111",
  timeframe: "1h" as const
};

describe("buildRegimeCurrent", () => {
  it("classifies CHOP and emits ALLOWED for flat candles + fresh data", () => {
    const lastCandleUnixMs = flatCandles[flatCandles.length - 1].unixMs;
    const nowUnixMs = lastCandleUnixMs + 30 * 60 * 1000;
    const response = buildRegimeCurrent({
      feed,
      candles: flatCandles,
      nowUnixMs,
      config: MARKET_REGIME_CONFIG["1h"],
      configVersion: "market-regime-1.0.0",
      engineVersion: "0.1.0"
    });

    expect(response.regime).toBe("CHOP");
    expect(response.clmmSuitability.status).toBe("ALLOWED");
    expect(response.metadata.candleCount).toBe(40);
    expect(response.metadata.engineVersion).toBe("0.1.0");
    expect(response.metadata.configVersion).toBe("market-regime-1.0.0");
    expect(response.symbol).toBe("SOL/USDC");
  });

  it("returns UNKNOWN when candleCount < minCandles even for fresh data", () => {
    const fewCandles = flatCandles.slice(0, 5);
    const lastCandleUnixMs = fewCandles[fewCandles.length - 1].unixMs;
    const response = buildRegimeCurrent({
      feed,
      candles: fewCandles,
      nowUnixMs: lastCandleUnixMs + 30 * 60 * 1000,
      config: MARKET_REGIME_CONFIG["1h"],
      configVersion: "market-regime-1.0.0",
      engineVersion: "0.1.0"
    });
    expect(response.clmmSuitability.status).toBe("UNKNOWN");
    expect(response.marketReasons.map((r) => r.code)).toContain("DATA_INSUFFICIENT_SAMPLES");
  });

  it("returns UNKNOWN when freshness is hardStale", () => {
    const lastCandleUnixMs = flatCandles[flatCandles.length - 1].unixMs;
    const response = buildRegimeCurrent({
      feed,
      candles: flatCandles,
      nowUnixMs: lastCandleUnixMs + 91 * 60 * 1000,
      config: MARKET_REGIME_CONFIG["1h"],
      configVersion: "market-regime-1.0.0",
      engineVersion: "0.1.0"
    });
    expect(response.clmmSuitability.status).toBe("UNKNOWN");
    expect(response.marketReasons.map((r) => r.code)).toContain("DATA_HARD_STALE");
  });
});
