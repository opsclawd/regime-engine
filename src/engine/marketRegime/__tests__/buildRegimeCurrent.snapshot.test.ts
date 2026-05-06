import { describe, expect, it } from "vitest";
import { buildRegimeCurrent } from "../buildRegimeCurrent.js";
import { MARKET_REGIME_CONFIG, MARKET_REGIME_CONFIG_VERSION } from "../config.js";

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
  it("produces identical response objects for fixed inputs", () => {
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
      engineVersion: "0.1.0"
    });

    expect(response).toMatchSnapshot();
  });
});
