import { describe, expect, it } from "vitest";
import { buildRegimeCurrent } from "../buildRegimeCurrent.js";
import { MARKET_REGIME_CONFIG, MARKET_REGIME_CONFIG_VERSION } from "../config.js";
import { aggregate15mTo1h } from "../../candles/aggregateCandles.js";

const FIFTEEN_MIN_MS = 15 * 60 * 1000;

const goldenCandles = Array.from({ length: 130 }, (_, i) => ({
  unixMs: (i + 1) * FIFTEEN_MIN_MS,
  open: 100 + i * 0.1,
  high: 100.5 + i * 0.1,
  low: 99.5 + i * 0.1,
  close: 100 + i * 0.1 + 0.05,
  volume: 1 + i
}));

describe("buildRegimeCurrent snapshot", () => {
  it("produces identical response objects for fixed 15m inputs", () => {
    const response = buildRegimeCurrent({
      feed: {
        symbol: "SOL/USDC",
        source: "birdeye",
        network: "solana-mainnet",
        poolAddress: "Pool111",
        timeframe: "15m"
      },
      candles: goldenCandles,
      nowUnixMs: 200 * FIFTEEN_MIN_MS,
      config: MARKET_REGIME_CONFIG["15m"],
      configVersion: MARKET_REGIME_CONFIG_VERSION,
      engineVersion: "0.1.0",
      metadata: {
        sourceTimeframe: "15m",
        sourceCandleCount: goldenCandles.length
      }
    });

    expect(response).toMatchSnapshot();
  });

  it("produces identical response objects for fixed 1h derived inputs", () => {
    const { candles: aggregated1h } = aggregate15mTo1h(goldenCandles);

    const response = buildRegimeCurrent({
      feed: {
        symbol: "SOL/USDC",
        source: "birdeye",
        network: "solana-mainnet",
        poolAddress: "Pool111",
        timeframe: "1h"
      },
      candles: aggregated1h,
      nowUnixMs: 200 * FIFTEEN_MIN_MS,
      config: MARKET_REGIME_CONFIG["1h"],
      configVersion: MARKET_REGIME_CONFIG_VERSION,
      engineVersion: "0.1.0",
      metadata: {
        sourceTimeframe: "15m",
        sourceCandleCount: goldenCandles.length,
        derivedTimeframe: "1h",
        aggregationVersion: "ohlcv-agg-v1"
      }
    });

    expect(response).toMatchSnapshot();
  });
});
