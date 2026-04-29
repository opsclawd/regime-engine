import { describe, expect, it } from "vitest";
import { parseCandleIngestRequest } from "../validation.js";
import { ContractValidationError } from "../../../http/errors.js";

const ONE_HOUR_MS = 60 * 60 * 1000;

const makeBody = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: "1.0",
  source: "birdeye",
  network: "solana-mainnet",
  poolAddress: "Pool1111111111111111111111111111111111111111",
  symbol: "SOL/USDC",
  timeframe: "1h",
  sourceRecordedAtIso: "2026-04-26T12:00:00.000Z",
  candles: [
    {
      unixMs: ONE_HOUR_MS,
      open: 100,
      high: 110,
      low: 95,
      close: 105,
      volume: 1000
    }
  ],
  ...overrides
});

describe("parseCandleIngestRequest", () => {
  it("accepts a minimal valid 1-candle batch", () => {
    const result = parseCandleIngestRequest(makeBody());
    expect(result.candles).toHaveLength(1);
    expect(result.timeframe).toBe("1h");
  });

  it("rejects unsupported schemaVersion with UNSUPPORTED_SCHEMA_VERSION", () => {
    expect.assertions(2);
    try {
      parseCandleIngestRequest(makeBody({ schemaVersion: "2.0" }));
    } catch (error) {
      expect(error).toBeInstanceOf(ContractValidationError);
      expect((error as ContractValidationError).response.error.code).toBe(
        "UNSUPPORTED_SCHEMA_VERSION"
      );
    }
  });

  it("rejects unsupported timeframe with VALIDATION_ERROR", () => {
    expect.assertions(1);
    try {
      parseCandleIngestRequest(makeBody({ timeframe: "5m" }));
    } catch (error) {
      expect((error as ContractValidationError).response.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it.each([["source"], ["network"], ["poolAddress"], ["symbol"], ["sourceRecordedAtIso"]])(
    "rejects missing %s with VALIDATION_ERROR",
    (key) => {
      const body = makeBody();
      delete (body as Record<string, unknown>)[key];
      expect(() => parseCandleIngestRequest(body)).toThrow(ContractValidationError);
    }
  );

  it("rejects malformed sourceRecordedAtIso with VALIDATION_ERROR", () => {
    expect.assertions(1);
    try {
      parseCandleIngestRequest(makeBody({ sourceRecordedAtIso: "not-an-iso-date" }));
    } catch (error) {
      expect((error as ContractValidationError).response.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("rejects empty candles array with VALIDATION_ERROR", () => {
    expect.assertions(1);
    try {
      parseCandleIngestRequest(makeBody({ candles: [] }));
    } catch (error) {
      expect((error as ContractValidationError).response.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("rejects 1001-candle batch with BATCH_TOO_LARGE", () => {
    const oversized = Array.from({ length: 1001 }, (_, i) => ({
      unixMs: (i + 1) * ONE_HOUR_MS,
      open: 100,
      high: 110,
      low: 95,
      close: 105,
      volume: 1000
    }));
    expect.assertions(1);
    try {
      parseCandleIngestRequest(makeBody({ candles: oversized }));
    } catch (error) {
      expect((error as ContractValidationError).response.error.code).toBe("BATCH_TOO_LARGE");
    }
  });

  it.each([
    ["high < open", { open: 100, high: 90, low: 80, close: 95, volume: 1 }],
    ["high < close", { open: 100, high: 90, low: 80, close: 95, volume: 1 }],
    ["low > open", { open: 100, high: 120, low: 110, close: 105, volume: 1 }],
    ["low > close", { open: 100, high: 120, low: 110, close: 105, volume: 1 }],
    ["zero open", { open: 0, high: 100, low: 50, close: 80, volume: 1 }],
    ["negative volume", { open: 100, high: 110, low: 95, close: 105, volume: -1 }],
    ["non-finite high", { open: 100, high: Infinity, low: 95, close: 105, volume: 1 }]
  ])("rejects malformed candle (%s) with MALFORMED_CANDLE", (_label, ohlc) => {
    expect.assertions(2);
    try {
      parseCandleIngestRequest(makeBody({ candles: [{ unixMs: ONE_HOUR_MS, ...ohlc }] }));
    } catch (error) {
      const e = error as ContractValidationError;
      expect(e.response.error.code).toBe("MALFORMED_CANDLE");
      expect(e.response.error.details[0].path).toMatch(/candles\[0\]/);
    }
  });

  it("rejects unixMs not aligned to timeframeMs with MALFORMED_CANDLE", () => {
    expect.assertions(1);
    try {
      parseCandleIngestRequest(
        makeBody({
          candles: [
            {
              unixMs: ONE_HOUR_MS + 1,
              open: 100,
              high: 110,
              low: 95,
              close: 105,
              volume: 1000
            }
          ]
        })
      );
    } catch (error) {
      expect((error as ContractValidationError).response.error.code).toBe("MALFORMED_CANDLE");
    }
  });

  it("rejects duplicate unixMs in batch with DUPLICATE_CANDLE_IN_BATCH", () => {
    expect.assertions(1);
    try {
      parseCandleIngestRequest(
        makeBody({
          candles: [
            { unixMs: ONE_HOUR_MS, open: 100, high: 110, low: 95, close: 105, volume: 1 },
            { unixMs: ONE_HOUR_MS, open: 101, high: 111, low: 96, close: 106, volume: 2 }
          ]
        })
      );
    } catch (error) {
      expect((error as ContractValidationError).response.error.code).toBe(
        "DUPLICATE_CANDLE_IN_BATCH"
      );
    }
  });
});
