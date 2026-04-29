import { describe, expect, it } from "vitest";
import { buildRegimeCurrent } from "../buildRegimeCurrent.js";
import { MARKET_REGIME_CONFIG, MARKET_REGIME_CONFIG_VERSION } from "../config.js";

const ONE_HOUR_MS = 60 * 60 * 1000;

const goldenCandles = Array.from({ length: 40 }, (_, i) => ({
  unixMs: (i + 1) * ONE_HOUR_MS,
  open: 100 + i * 0.1,
  high: 100.5 + i * 0.1,
  low: 99.5 + i * 0.1,
  close: 100 + i * 0.1 + 0.05,
  volume: 1 + i
}));

describe("buildRegimeCurrent snapshot", () => {
  it("produces identical response objects for fixed inputs", () => {
    const response = buildRegimeCurrent({
      feed: {
        symbol: "SOL/USDC",
        source: "birdeye",
        network: "solana-mainnet",
        poolAddress: "Pool111",
        timeframe: "1h"
      },
      candles: goldenCandles,
      nowUnixMs: 100 * ONE_HOUR_MS,
      config: MARKET_REGIME_CONFIG["1h"],
      configVersion: MARKET_REGIME_CONFIG_VERSION,
      engineVersion: "0.1.0"
    });

    expect(response).toMatchSnapshot();
  });
});
