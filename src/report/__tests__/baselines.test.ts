import { describe, expect, it } from "vitest";
import { computeBaselines } from "../baselines.js";

describe("computeBaselines", () => {
  it("ignores lookback candles that are outside the report window", () => {
    const fromUnixMs = Date.parse("2026-01-10T00:00:00.000Z");
    const toUnixMs = Date.parse("2026-01-10T12:00:00.000Z");

    const summary = computeBaselines({
      window: {
        fromUnixMs,
        toUnixMs
      },
      planRequests: [
        {
          asOfUnixMs: toUnixMs,
          request: {
            market: {
              candles: [
                { unixMs: Date.parse("2026-01-09T00:00:00.000Z"), close: 50 },
                { unixMs: Date.parse("2026-01-10T00:00:00.000Z"), close: 100 },
                { unixMs: Date.parse("2026-01-10T12:00:00.000Z"), close: 120 }
              ]
            },
            portfolio: {
              navUsd: 1_000
            },
            config: {
              baselines: {
                dcaIntervalDays: 1,
                dcaAmountUsd: 1_000,
                usdcCarryApr: 0
              }
            }
          }
        }
      ]
    });

    expect(summary.solHodlFinalNavUsd).toBe(1_200);
    expect(summary.solDcaFinalNavUsd).toBe(1_200);
    expect(summary.usdcCarryFinalNavUsd).toBe(1_000);
  });

  it("uses the explicit report window for USDC carry duration", () => {
    const fromUnixMs = Date.parse("2026-01-10T00:00:00.000Z");
    const toUnixMs = Date.parse("2026-01-11T00:00:00.000Z");

    const summary = computeBaselines({
      window: {
        fromUnixMs,
        toUnixMs
      },
      planRequests: [
        {
          asOfUnixMs: toUnixMs,
          request: {
            market: {
              candles: [
                { unixMs: Date.parse("2026-01-10T12:00:00.000Z"), close: 100 },
                { unixMs: Date.parse("2026-01-11T00:00:00.000Z"), close: 100 }
              ]
            },
            portfolio: {
              navUsd: 1_000
            },
            config: {
              baselines: {
                dcaIntervalDays: 1,
                dcaAmountUsd: 0,
                usdcCarryApr: 0.365
              }
            }
          }
        }
      ]
    });

    expect(summary.usdcCarryFinalNavUsd).toBe(1_001);
  });
});
