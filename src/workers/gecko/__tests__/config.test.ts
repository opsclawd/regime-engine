import { describe, it, expect } from "vitest";
import { parseGeckoCollectorConfig } from "../config.js";

const MINIMAL_ENV: Record<string, string | undefined> = {
  REGIME_ENGINE_URL: "https://regime-engine.example",
  CANDLES_INGEST_TOKEN: "tok_abc123",
  GECKO_POOL_ADDRESS: "So1enD8SdYKeb4s4XxKQsXKQsXKQsXKQsXKQsXKQsXK"
};

describe("parseGeckoCollectorConfig", () => {
  it("returns MVP defaults for minimal env", () => {
    const config = parseGeckoCollectorConfig(MINIMAL_ENV);
    expect(config.regimeEngineUrl.href).toBe("https://regime-engine.example/");
    expect(config.candlesIngestToken).toBe("tok_abc123");
    expect(config.geckoSource).toBe("geckoterminal");
    expect(config.geckoNetwork).toBe("solana");
    expect(config.geckoPoolAddress).toBe("So1enD8SdYKeb4s4XxKQsXKQsXKQsXKQsXKQsXKQsXK");
    expect(config.geckoSymbol).toBe("SOL/USDC");
    expect(config.geckoTimeframe).toBe("1h");
    expect(config.geckoLookback).toBe(200);
    expect(config.geckoPollIntervalMs).toBe(300000);
    expect(config.geckoMaxCallsPerMinute).toBe(6);
    expect(config.geckoRequestTimeoutMs).toBe(10000);
  });

  it("uses explicit values when provided", () => {
    const env = {
      ...MINIMAL_ENV,
      GECKO_SOURCE: "geckoterminal",
      GECKO_NETWORK: "solana",
      GECKO_SYMBOL: "SOL/USDC",
      GECKO_TIMEFRAME: "1h",
      GECKO_LOOKBACK: "500",
      GECKO_POLL_INTERVAL_MS: "60000",
      GECKO_MAX_CALLS_PER_MINUTE: "10",
      GECKO_REQUEST_TIMEOUT_MS: "5000"
    };
    const config = parseGeckoCollectorConfig(env);
    expect(config.geckoLookback).toBe(500);
    expect(config.geckoPollIntervalMs).toBe(60000);
    expect(config.geckoMaxCallsPerMinute).toBe(10);
    expect(config.geckoRequestTimeoutMs).toBe(5000);
  });

  it("throws for missing REGIME_ENGINE_URL", () => {
    const env = { ...MINIMAL_ENV, REGIME_ENGINE_URL: undefined };
    expect(() => parseGeckoCollectorConfig(env)).toThrow("Missing required env: REGIME_ENGINE_URL");
  });

  it("throws for missing CANDLES_INGEST_TOKEN", () => {
    const env = { ...MINIMAL_ENV, CANDLES_INGEST_TOKEN: undefined };
    expect(() => parseGeckoCollectorConfig(env)).toThrow(
      "Missing required env: CANDLES_INGEST_TOKEN"
    );
  });

  it("throws for missing GECKO_POOL_ADDRESS", () => {
    const env = { ...MINIMAL_ENV, GECKO_POOL_ADDRESS: undefined };
    expect(() => parseGeckoCollectorConfig(env)).toThrow(
      "Missing required env: GECKO_POOL_ADDRESS"
    );
  });

  it("throws for placeholder pool address with angle brackets", () => {
    const env = { ...MINIMAL_ENV, GECKO_POOL_ADDRESS: "<confirm-before-production>" };
    expect(() => parseGeckoCollectorConfig(env)).toThrow("placeholder");
  });

  it("throws for non-absolute URL", () => {
    const env = { ...MINIMAL_ENV, REGIME_ENGINE_URL: "not-a-url" };
    expect(() => parseGeckoCollectorConfig(env)).toThrow("not a valid absolute URL");
  });

  it("allows HTTP for localhost", () => {
    const env = { ...MINIMAL_ENV, REGIME_ENGINE_URL: "http://localhost:3000" };
    const config = parseGeckoCollectorConfig(env);
    expect(config.regimeEngineUrl.href).toBe("http://localhost:3000/");
  });

  it("allows HTTP for 127.0.0.1", () => {
    const env = { ...MINIMAL_ENV, REGIME_ENGINE_URL: "http://127.0.0.1:3000" };
    const config = parseGeckoCollectorConfig(env);
    expect(config.regimeEngineUrl.href).toBe("http://127.0.0.1:3000/");
  });

  it("allows HTTP for *.railway.internal", () => {
    const env = { ...MINIMAL_ENV, REGIME_ENGINE_URL: "http://regime.railway.internal:3000" };
    const config = parseGeckoCollectorConfig(env);
    expect(config.regimeEngineUrl.href).toBe("http://regime.railway.internal:3000/");
  });

  it("throws for plain HTTP to remote host", () => {
    const env = { ...MINIMAL_ENV, REGIME_ENGINE_URL: "http://regime-engine.example" };
    expect(() => parseGeckoCollectorConfig(env)).toThrow("must use HTTPS");
  });

  it("throws for unsupported GECKO_SOURCE", () => {
    const env = { ...MINIMAL_ENV, GECKO_SOURCE: "other" };
    expect(() => parseGeckoCollectorConfig(env)).toThrow("Unsupported GECKO_SOURCE");
  });

  it("throws for unsupported GECKO_NETWORK", () => {
    const env = { ...MINIMAL_ENV, GECKO_NETWORK: "ethereum" };
    expect(() => parseGeckoCollectorConfig(env)).toThrow("Unsupported GECKO_NETWORK");
  });

  it("throws for unsupported GECKO_SYMBOL", () => {
    const env = { ...MINIMAL_ENV, GECKO_SYMBOL: "ETH/USDC" };
    expect(() => parseGeckoCollectorConfig(env)).toThrow("Unsupported GECKO_SYMBOL");
  });

  it("throws for unsupported GECKO_TIMEFRAME", () => {
    const env = { ...MINIMAL_ENV, GECKO_TIMEFRAME: "5m" };
    expect(() => parseGeckoCollectorConfig(env)).toThrow("Unsupported GECKO_TIMEFRAME");
  });

  it("treats empty string as default for literal env", () => {
    const env = { ...MINIMAL_ENV, GECKO_SOURCE: "" };
    const config = parseGeckoCollectorConfig(env);
    expect(config.geckoSource).toBe("geckoterminal");
  });

  it("throws for invalid numeric env", () => {
    const env = { ...MINIMAL_ENV, GECKO_LOOKBACK: "abc" };
    expect(() => parseGeckoCollectorConfig(env)).toThrow("must be a positive integer");
  });

  it("throws for lookback exceeding max", () => {
    const env = { ...MINIMAL_ENV, GECKO_LOOKBACK: "1001" };
    expect(() => parseGeckoCollectorConfig(env)).toThrow("must be a positive integer ≤ 1000");
  });

  it("rejects REGIME_ENGINE_URL with a path component", () => {
    const env = { ...MINIMAL_ENV, REGIME_ENGINE_URL: "https://regime-engine.example/api" };
    expect(() => parseGeckoCollectorConfig(env)).toThrow("must not contain a path component");
  });
});
