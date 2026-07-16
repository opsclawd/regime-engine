import { describe, expect, it } from "vitest";
import { computeBaselines } from "../baselines.js";

describe("computeBaselines", () => {
  describe("canonical candle authority", () => {
    it("uses only explicit canonical candles when legacy inline candles conflict", () => {
      const fromUnixMs = Date.parse("2026-01-10T00:00:00.000Z");
      const toUnixMs = Date.parse("2026-01-10T12:00:00.000Z");

      const explicitCandles = [
        { unixMs: Date.parse("2026-01-10T00:00:00.000Z"), close: 100 },
        { unixMs: Date.parse("2026-01-10T12:00:00.000Z"), close: 120 }
      ];

      const summary = computeBaselines({
        window: {
          fromUnixMs,
          toUnixMs
        },
        candles: explicitCandles,
        planRequests: [
          {
            asOfUnixMs: toUnixMs,
            request: {
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

    it("ignores legacy inline candles when explicit canonical candles are provided", () => {
      const fromUnixMs = Date.parse("2026-01-10T00:00:00.000Z");
      const toUnixMs = Date.parse("2026-01-10T12:00:00.000Z");

      const explicitCandles = [
        { unixMs: Date.parse("2026-01-10T00:00:00.000Z"), close: 100 },
        { unixMs: Date.parse("2026-01-10T12:00:00.000Z"), close: 120 }
      ];

      const summary = computeBaselines({
        window: {
          fromUnixMs,
          toUnixMs
        },
        candles: explicitCandles,
        planRequests: [
          {
            asOfUnixMs: toUnixMs,
            request: {
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
    });

    it("rejects legacy inline candles through type cast for regression coverage", () => {
      const fromUnixMs = Date.parse("2026-01-10T00:00:00.000Z");
      const toUnixMs = Date.parse("2026-01-10T12:00:00.000Z");

      const explicitCandles = [
        { unixMs: Date.parse("2026-01-10T00:00:00.000Z"), close: 100 },
        { unixMs: Date.parse("2026-01-10T12:00:00.000Z"), close: 120 }
      ];

      const summary = computeBaselines({
        window: {
          fromUnixMs,
          toUnixMs
        },
        candles: explicitCandles,
        planRequests: [
          {
            asOfUnixMs: toUnixMs,
            request: {
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
    });
  });

  describe("defensive window normalization", () => {
    it("filters canonical candles to the report window and sorts them by unixMs", () => {
      const fromUnixMs = Date.parse("2026-01-10T00:00:00.000Z");
      const toUnixMs = Date.parse("2026-01-10T12:00:00.000Z");

      const unsortedCandles = [
        { unixMs: Date.parse("2026-01-10T12:00:00.000Z"), close: 120 },
        { unixMs: Date.parse("2026-01-10T06:00:00.000Z"), close: 110 },
        { unixMs: Date.parse("2026-01-09T00:00:00.000Z"), close: 50 },
        { unixMs: Date.parse("2026-01-10T00:00:00.000Z"), close: 100 },
        { unixMs: Date.parse("2026-01-11T00:00:00.000Z"), close: 130 }
      ];

      const summary = computeBaselines({
        window: {
          fromUnixMs,
          toUnixMs
        },
        candles: unsortedCandles,
        planRequests: [
          {
            asOfUnixMs: toUnixMs,
            request: {
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
    });
  });

  describe("empty canonical series", () => {
    it("keeps SOL baselines at initial NAV and still accrues USDC when canonical candles are empty", () => {
      const fromUnixMs = Date.parse("2026-01-10T00:00:00.000Z");
      const toUnixMs = Date.parse("2026-01-11T00:00:00.000Z");

      const summary = computeBaselines({
        window: {
          fromUnixMs,
          toUnixMs
        },
        candles: [],
        planRequests: [
          {
            asOfUnixMs: toUnixMs,
            request: {
              portfolio: {
                navUsd: 1_000
              },
              config: {
                baselines: {
                  dcaIntervalDays: 1,
                  dcaAmountUsd: 1_000,
                  usdcCarryApr: 0.365
                }
              }
            }
          }
        ]
      });

      expect(summary.solHodlFinalNavUsd).toBe(1_000);
      expect(summary.solDcaFinalNavUsd).toBe(1_000);
      expect(summary.usdcCarryFinalNavUsd).toBe(1_001);
    });
  });

  describe("no plan facts", () => {
    it("returns all-zero baselines when there are no plan requests", () => {
      const fromUnixMs = Date.parse("2026-01-10T00:00:00.000Z");
      const toUnixMs = Date.parse("2026-01-10T12:00:00.000Z");

      const summary = computeBaselines({
        window: {
          fromUnixMs,
          toUnixMs
        },
        candles: [
          { unixMs: Date.parse("2026-01-10T00:00:00.000Z"), close: 100 },
          { unixMs: Date.parse("2026-01-10T12:00:00.000Z"), close: 120 }
        ],
        planRequests: []
      });

      expect(summary.solHodlFinalNavUsd).toBe(0);
      expect(summary.solDcaFinalNavUsd).toBe(0);
      expect(summary.usdcCarryFinalNavUsd).toBe(0);
    });
  });

  describe("USDC carry duration", () => {
    it("uses the explicit report window for USDC carry duration", () => {
      const fromUnixMs = Date.parse("2026-01-10T00:00:00.000Z");
      const toUnixMs = Date.parse("2026-01-11T00:00:00.000Z");

      const summary = computeBaselines({
        window: {
          fromUnixMs,
          toUnixMs
        },
        candles: [
          { unixMs: Date.parse("2026-01-10T12:00:00.000Z"), close: 100 },
          { unixMs: Date.parse("2026-01-11T00:00:00.000Z"), close: 100 }
        ],
        planRequests: [
          {
            asOfUnixMs: toUnixMs,
            request: {
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
});
