import { describe, expect, it } from "vitest";
import { buildRegimeCurrent } from "../buildRegimeCurrent.js";
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
    const nowUnixMs = lastCandleUnixMs + 20 * 60 * 1000;
    const response = buildRegimeCurrent({
      feed,
      candles: flatCandles,
      nowUnixMs,
      config: MARKET_REGIME_CONFIG["15m"],
      configVersion: "market-regime-1.0.0",
      engineVersion: "0.1.0"
    });

    expect(response.regime).toBe("CHOP");
    expect(response.clmmSuitability.status).toBe("ALLOWED");
    expect(response.metadata.candleCount).toBe(130);
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
      nowUnixMs: lastCandleUnixMs + 20 * 60 * 1000,
      config: MARKET_REGIME_CONFIG["15m"],
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
      nowUnixMs: lastCandleUnixMs + 40 * 60 * 1000,
      config: MARKET_REGIME_CONFIG["15m"],
      configVersion: "market-regime-1.0.0",
      engineVersion: "0.1.0"
    });
    expect(response.clmmSuitability.status).toBe("UNKNOWN");
    expect(response.marketReasons.map((r) => r.code)).toContain("DATA_HARD_STALE");
  });
});
