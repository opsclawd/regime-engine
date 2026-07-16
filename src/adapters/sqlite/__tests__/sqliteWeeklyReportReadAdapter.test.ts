import { describe, expect, it } from "vitest";
import { createSqliteWeeklyReportReadAdapter } from "../sqliteWeeklyReportReadAdapter.js";
import { createLedgerStore } from "../../../ledger/store.js";
import { writePlanLedgerEntry, writeExecutionResultLedgerEntry } from "../../../ledger/writer.js";
import { ReportRangeApplicationError } from "../../../application/errors/reportErrors.js";

const POOL_ADDRESS = "TestPool1";

describe("sqliteWeeklyReportReadAdapter", () => {
  describe("returns ledger facts ordered by timestamp then insertion id", () => {
    it("orders plans by asOfUnixMs ASC, id ASC", () => {
      const store = createLedgerStore(":memory:");
      const baseTime = Date.parse("2026-01-05T00:00:00.000Z");

      const request1 = {
        schemaVersion: "1.0" as const,
        asOfUnixMs: baseTime,
        market: {
          symbol: "SOL/USDC",
          source: "geckoterminal",
          network: "solana",
          poolAddress: POOL_ADDRESS,
          timeframe: "15m" as const
        },
        position: {
          positionId: "pos-1",
          observedAtUnixMs: baseTime,
          lowerBoundPrice: 100,
          upperBoundPrice: 120,
          currentPrice: 110,
          rangeState: "in-range" as const,
          breachQualified: false
        },
        portfolio: { navUsd: 10000, solUnits: 10, usdcUnits: 5000 },
        autopilotState: {
          activeClmm: true,
          stopouts24h: 0,
          redeploys24h: 0,
          cooldownUntilUnixMs: 0,
          standDownUntilUnixMs: 0,
          strikeCount: 0
        },
        config: {
          regime: {
            confirmBars: 1,
            minHoldBars: 0,
            enterUpTrend: 0.6,
            exitUpTrend: 0.35,
            enterDownTrend: -0.6,
            exitDownTrend: -0.35,
            chopVolRatioMax: 1.4
          },
          allocation: {
            upSolBps: 7000,
            downSolBps: 1000,
            chopSolBps: 4000,
            maxDeltaExposureBpsPerDay: 2000,
            maxTurnoverPerDayBps: 5000
          },
          churn: {
            maxStopouts24h: 3,
            maxRedeploys24h: 3,
            cooldownMsAfterStopout: 0,
            standDownTriggerStrikes: 3
          },
          baselines: { dcaIntervalDays: 7, dcaAmountUsd: 100, usdcCarryApr: 0.04 }
        }
      };

      const plan1 = {
        schemaVersion: "1.0" as const,
        planId: "plan-1",
        planHash: "hash-1",
        asOfUnixMs: baseTime,
        scope: {
          kind: "position" as const,
          positionId: "pos-1",
          poolAddress: POOL_ADDRESS,
          symbol: "SOL/USDC"
        },
        regime: "CHOP" as const,
        targets: { solBps: 4000, usdcBps: 6000, allowClmm: true },
        actions: [{ type: "HOLD" as const, reasonCode: "CHOP" }],
        constraints: { cooldownUntilUnixMs: 0, standDownUntilUnixMs: 0, notes: [] },
        nextRegimeState: {
          current: "CHOP" as const,
          barsInRegime: 1,
          pending: null,
          pendingBars: 0
        },
        reasons: [],
        telemetry: {},
        marketData: {
          source: "geckoterminal",
          network: "solana",
          poolAddress: POOL_ADDRESS,
          requestedTimeframe: "15m" as const,
          sourceTimeframe: "15m",
          candleCount: 50,
          sourceCandleCount: 200,
          freshness: {
            generatedAtIso: "",
            lastCandleOpenUnixMs: 0,
            lastCandleOpenIso: "",
            lastCandleCloseUnixMs: 0,
            lastCandleCloseIso: "",
            ageSeconds: 60,
            softStale: false,
            hardStale: false,
            softStaleSeconds: 1500,
            hardStaleSeconds: 2100
          }
        }
      };

      const plan2 = {
        ...plan1,
        planId: "plan-2",
        planHash: "hash-2"
      };

      writePlanLedgerEntry(store, {
        planRequest: request1,
        planResponse: plan1,
        receivedAtUnixMs: baseTime
      });

      writePlanLedgerEntry(store, {
        planRequest: request1,
        planResponse: plan2,
        receivedAtUnixMs: baseTime
      });

      const adapter = createSqliteWeeklyReportReadAdapter(store);
      const result = adapter.getWeeklyReportData({
        from: "2026-01-01",
        to: "2026-01-31"
      });

      expect(result).resolves.toMatchObject({
        plans: [
          { asOfUnixMs: baseTime, plan: plan1 },
          { asOfUnixMs: baseTime, plan: plan2 }
        ]
      });

      store.close();
    });

    it("orders executionResults by asOfUnixMs ASC, id ASC", () => {
      const store = createLedgerStore(":memory:");
      const baseTime = Date.parse("2026-01-05T00:00:00.000Z");

      const request1 = {
        schemaVersion: "1.0" as const,
        asOfUnixMs: baseTime,
        market: {
          symbol: "SOL/USDC",
          source: "geckoterminal",
          network: "solana",
          poolAddress: POOL_ADDRESS,
          timeframe: "15m" as const
        },
        position: {
          positionId: "pos-1",
          observedAtUnixMs: baseTime,
          lowerBoundPrice: 100,
          upperBoundPrice: 120,
          currentPrice: 110,
          rangeState: "in-range" as const,
          breachQualified: false
        },
        portfolio: { navUsd: 10000, solUnits: 10, usdcUnits: 5000 },
        autopilotState: {
          activeClmm: true,
          stopouts24h: 0,
          redeploys24h: 0,
          cooldownUntilUnixMs: 0,
          standDownUntilUnixMs: 0,
          strikeCount: 0
        },
        config: {
          regime: {
            confirmBars: 1,
            minHoldBars: 0,
            enterUpTrend: 0.6,
            exitUpTrend: 0.35,
            enterDownTrend: -0.6,
            exitDownTrend: -0.35,
            chopVolRatioMax: 1.4
          },
          allocation: {
            upSolBps: 7000,
            downSolBps: 1000,
            chopSolBps: 4000,
            maxDeltaExposureBpsPerDay: 2000,
            maxTurnoverPerDayBps: 5000
          },
          churn: {
            maxStopouts24h: 3,
            maxRedeploys24h: 3,
            cooldownMsAfterStopout: 0,
            standDownTriggerStrikes: 3
          },
          baselines: { dcaIntervalDays: 7, dcaAmountUsd: 100, usdcCarryApr: 0.04 }
        }
      };

      const plan1 = {
        schemaVersion: "1.0" as const,
        planId: "plan-1",
        planHash: "hash-1",
        asOfUnixMs: baseTime,
        scope: {
          kind: "position" as const,
          positionId: "pos-1",
          poolAddress: POOL_ADDRESS,
          symbol: "SOL/USDC"
        },
        regime: "CHOP" as const,
        targets: { solBps: 4000, usdcBps: 6000, allowClmm: true },
        actions: [{ type: "HOLD" as const, reasonCode: "CHOP" }],
        constraints: { cooldownUntilUnixMs: 0, standDownUntilUnixMs: 0, notes: [] },
        nextRegimeState: {
          current: "CHOP" as const,
          barsInRegime: 1,
          pending: null,
          pendingBars: 0
        },
        reasons: [],
        telemetry: {},
        marketData: {
          source: "geckoterminal",
          network: "solana",
          poolAddress: POOL_ADDRESS,
          requestedTimeframe: "15m" as const,
          sourceTimeframe: "15m",
          candleCount: 50,
          sourceCandleCount: 200,
          freshness: {
            generatedAtIso: "",
            lastCandleOpenUnixMs: 0,
            lastCandleOpenIso: "",
            lastCandleCloseUnixMs: 0,
            lastCandleCloseIso: "",
            ageSeconds: 60,
            softStale: false,
            hardStale: false,
            softStaleSeconds: 1500,
            hardStaleSeconds: 2100
          }
        }
      };

      writePlanLedgerEntry(store, {
        planRequest: request1,
        planResponse: plan1,
        receivedAtUnixMs: baseTime
      });

      writeExecutionResultLedgerEntry(store, {
        executionResult: {
          schemaVersion: "1.0",
          planId: "plan-1",
          planHash: "hash-1",
          asOfUnixMs: baseTime,
          actionResults: [{ actionType: "HOLD", status: "SUCCESS" }],
          costs: { txFeesUsd: 0.01, priorityFeesUsd: 0.001, slippageUsd: 0.01 },
          portfolioAfter: { navUsd: 10000, solUnits: 10, usdcUnits: 5000 }
        }
      });

      const adapter = createSqliteWeeklyReportReadAdapter(store);
      const result = adapter.getWeeklyReportData({
        from: "2026-01-01",
        to: "2026-01-31"
      });

      expect(result).resolves.toMatchObject({
        executionResults: [
          {
            asOfUnixMs: baseTime,
            result: expect.objectContaining({
              planId: "plan-1",
              actionResults: [{ actionType: "HOLD", status: "SUCCESS" }]
            })
          }
        ]
      });

      store.close();
    });
  });

  describe("maps invalid and reversed dates to ReportRangeApplicationError", () => {
    it("throws ReportRangeApplicationError for invalid date format", async () => {
      const store = createLedgerStore(":memory:");
      const adapter = createSqliteWeeklyReportReadAdapter(store);

      await expect(
        adapter.getWeeklyReportData({ from: "not-a-date", to: "2026-01-31" })
      ).rejects.toThrow(ReportRangeApplicationError);

      store.close();
    });

    it("throws ReportRangeApplicationError for reversed date range", async () => {
      const store = createLedgerStore(":memory:");
      const adapter = createSqliteWeeklyReportReadAdapter(store);

      await expect(
        adapter.getWeeklyReportData({ from: "2026-01-31", to: "2026-01-01" })
      ).rejects.toThrow(ReportRangeApplicationError);

      store.close();
    });
  });

  describe("keeps malformed persisted JSON as an unexpected error", () => {
    it("propagates JSON parse errors as unexpected errors", async () => {
      const store = createLedgerStore(":memory:");
      store.db
        .prepare(
          `
          INSERT INTO plans
            (plan_id, plan_hash, as_of_unix_ms, plan_json, created_at_unix_ms)
          VALUES
            (?, ?, ?, ?, ?)
        `
        )
        .run(
          "plan-invalid",
          "hash-invalid",
          Date.parse("2026-01-08T00:00:00.000Z"),
          "{not-json",
          Date.parse("2026-01-08T00:00:00.000Z")
        );

      const adapter = createSqliteWeeklyReportReadAdapter(store);

      await expect(
        adapter.getWeeklyReportData({ from: "2026-01-01", to: "2026-01-31" })
      ).rejects.toThrow(SyntaxError);

      store.close();
    });
  });
});
