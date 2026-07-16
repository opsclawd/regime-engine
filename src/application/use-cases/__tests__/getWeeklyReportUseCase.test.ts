import { describe, expect, it } from "vitest";
import { createGetWeeklyReportUseCase } from "../getWeeklyReportUseCase.js";
import { FakeWeeklyReportLedgerReadPort } from "./fakes/fakeWeeklyReportReadPort.js";
import { FakeCandleReadPort } from "./fakes/fakeCandleReadPort.js";
import { ReportRangeApplicationError } from "../../errors/reportErrors.js";
import type {
  PlanRequest,
  PlanResponse,
  ExecutionResultRequest
} from "../../../contract/v1/types.js";

const POOL_ADDRESS = "PoolWeekly1";

const createPlanRequest = (asOfUnixMs: number, timeframe: "15m" | "1h" = "15m"): PlanRequest => ({
  schemaVersion: "1.0",
  asOfUnixMs,
  market: {
    symbol: "SOL/USDC",
    source: "geckoterminal",
    network: "solana",
    poolAddress: POOL_ADDRESS,
    timeframe
  },
  position: {
    positionId: `pos-${asOfUnixMs}`,
    observedAtUnixMs: asOfUnixMs,
    lowerBoundPrice: 100,
    upperBoundPrice: 120,
    currentPrice: 110,
    rangeState: "in-range",
    breachQualified: false
  },
  portfolio: { navUsd: 10_000, solUnits: 20, usdcUnits: 6_000 },
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
});

const createPlanResponse = (asOfUnixMs: number): PlanResponse => ({
  schemaVersion: "1.0",
  planId: `plan-${asOfUnixMs}`,
  planHash: `hash-${asOfUnixMs}`,
  asOfUnixMs,
  scope: {
    kind: "position",
    positionId: `pos-${asOfUnixMs}`,
    poolAddress: POOL_ADDRESS,
    symbol: "SOL/USDC"
  },
  regime: "CHOP",
  targets: { solBps: 4000, usdcBps: 6000, allowClmm: true },
  actions: [{ type: "HOLD", reasonCode: "CHOP_REGIME" }],
  constraints: {
    cooldownUntilUnixMs: 0,
    standDownUntilUnixMs: 0,
    notes: []
  },
  nextRegimeState: { current: "CHOP", barsInRegime: 1, pending: null, pendingBars: 0 },
  reasons: [],
  telemetry: {},
  marketData: {
    source: "geckoterminal",
    network: "solana",
    poolAddress: POOL_ADDRESS,
    requestedTimeframe: "15m",
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
});

const createExecutionResult = (asOfUnixMs: number): ExecutionResultRequest => ({
  schemaVersion: "1.0",
  planId: `plan-${asOfUnixMs}`,
  planHash: `hash-${asOfUnixMs}`,
  asOfUnixMs,
  actionResults: [{ actionType: "HOLD", status: "SUCCESS" }],
  costs: { txFeesUsd: 0.05, priorityFeesUsd: 0.01, slippageUsd: 0.1 },
  portfolioAfter: { navUsd: 10_050, solUnits: 20.2, usdcUnits: 5_960 }
});

describe("GetWeeklyReportUseCase", () => {
  describe("selects the first complete supported feed in chronological request order", () => {
    it("uses the first request's market identity when it has complete feed", async () => {
      const ledgerPort = new FakeWeeklyReportLedgerReadPort();
      const candlePort = new FakeCandleReadPort({ "15m": [] });

      const firstRequest = createPlanRequest(Date.parse("2026-01-05T00:00:00.000Z"));
      const secondRequest = createPlanRequest(Date.parse("2026-01-06T00:00:00.000Z"));

      ledgerPort.setNextResult({
        window: {
          from: "2026-01-01",
          to: "2026-01-07",
          fromUnixMs: Date.parse("2026-01-01T00:00:00.000Z"),
          toUnixMs: Date.parse("2026-01-07T23:59:59.999Z")
        },
        plans: [
          { asOfUnixMs: firstRequest.asOfUnixMs, plan: createPlanResponse(firstRequest.asOfUnixMs) }
        ],
        planRequests: [
          { asOfUnixMs: firstRequest.asOfUnixMs, request: firstRequest },
          { asOfUnixMs: secondRequest.asOfUnixMs, request: secondRequest }
        ],
        executionResults: []
      });

      const useCase = createGetWeeklyReportUseCase({
        weeklyReportLedgerReadPort: ledgerPort,
        candleReadPort: candlePort
      });

      await useCase({ from: "2026-01-01", to: "2026-01-07" });

      expect(candlePort.windowCalls).toHaveLength(1);
      expect(candlePort.windowCalls[0]).toEqual({
        symbol: "SOL/USDC",
        source: "geckoterminal",
        network: "solana",
        poolAddress: POOL_ADDRESS,
        timeframe: "15m",
        fromUnixMs: Date.parse("2026-01-01T00:00:00.000Z"),
        closedCandleCutoffUnixMs: Date.parse("2026-01-07T23:30:00.000Z")
      });
    });

    it("skips request with empty symbol and uses next complete request", async () => {
      const ledgerPort = new FakeWeeklyReportLedgerReadPort();
      const candlePort = new FakeCandleReadPort({ "15m": [] });

      const incompleteRequest: PlanRequest = {
        ...createPlanRequest(Date.parse("2026-01-05T00:00:00.000Z")),
        market: { ...createPlanRequest(Date.parse("2026-01-05T00:00:00.000Z")).market, symbol: "" }
      };
      const completeRequest = createPlanRequest(Date.parse("2026-01-06T00:00:00.000Z"));

      ledgerPort.setNextResult({
        window: {
          from: "2026-01-01",
          to: "2026-01-07",
          fromUnixMs: Date.parse("2026-01-01T00:00:00.000Z"),
          toUnixMs: Date.parse("2026-01-07T23:59:59.999Z")
        },
        plans: [],
        planRequests: [
          { asOfUnixMs: incompleteRequest.asOfUnixMs, request: incompleteRequest },
          { asOfUnixMs: completeRequest.asOfUnixMs, request: completeRequest }
        ],
        executionResults: []
      });

      const useCase = createGetWeeklyReportUseCase({
        weeklyReportLedgerReadPort: ledgerPort,
        candleReadPort: candlePort
      });

      await useCase({ from: "2026-01-01", to: "2026-01-07" });

      expect(candlePort.windowCalls).toHaveLength(1);
      expect(candlePort.windowCalls[0].symbol).toBe("SOL/USDC");
    });

    it("skips request with unsupported timeframe and uses next supported request", async () => {
      const ledgerPort = new FakeWeeklyReportLedgerReadPort();
      const candlePort = new FakeCandleReadPort({ "15m": [], "1h": [] });

      const fiveMinRequest = createPlanRequest(Date.parse("2026-01-05T00:00:00.000Z"), "15m");
      const oneHourRequest = createPlanRequest(Date.parse("2026-01-06T00:00:00.000Z"), "1h");

      ledgerPort.setNextResult({
        window: {
          from: "2026-01-01",
          to: "2026-01-07",
          fromUnixMs: Date.parse("2026-01-01T00:00:00.000Z"),
          toUnixMs: Date.parse("2026-01-07T23:59:59.999Z")
        },
        plans: [],
        planRequests: [
          { asOfUnixMs: fiveMinRequest.asOfUnixMs, request: fiveMinRequest },
          { asOfUnixMs: oneHourRequest.asOfUnixMs, request: oneHourRequest }
        ],
        executionResults: []
      });

      const useCase = createGetWeeklyReportUseCase({
        weeklyReportLedgerReadPort: ledgerPort,
        candleReadPort: candlePort
      });

      await useCase({ from: "2026-01-01", to: "2026-01-07" });

      expect(candlePort.windowCalls).toHaveLength(1);
    });
  });

  describe("reads a 15m request from the canonical 15m source window", () => {
    it("calls candle port with 15m timeframe for 15m request", async () => {
      const ledgerPort = new FakeWeeklyReportLedgerReadPort();
      const candlePort = new FakeCandleReadPort({ "15m": [] });
      const fromUnixMs = Date.parse("2026-01-01T00:00:00.000Z");
      const toUnixMs = Date.parse("2026-01-07T23:59:59.999Z");

      const request = createPlanRequest(Date.parse("2026-01-05T00:00:00.000Z"), "15m");

      ledgerPort.setNextResult({
        window: { from: "2026-01-01", to: "2026-01-07", fromUnixMs, toUnixMs },
        plans: [{ asOfUnixMs: request.asOfUnixMs, plan: createPlanResponse(request.asOfUnixMs) }],
        planRequests: [{ asOfUnixMs: request.asOfUnixMs, request }],
        executionResults: []
      });

      const useCase = createGetWeeklyReportUseCase({
        weeklyReportLedgerReadPort: ledgerPort,
        candleReadPort: candlePort
      });

      await useCase({ from: "2026-01-01", to: "2026-01-07" });

      expect(candlePort.windowCalls).toHaveLength(1);
      expect(candlePort.windowCalls[0].timeframe).toBe("15m");
    });
  });

  describe("reads a 1h request from the canonical 15m source window without aggregation", () => {
    it("calls candle port with 15m source timeframe even for 1h requested timeframe", async () => {
      const ledgerPort = new FakeWeeklyReportLedgerReadPort();
      const candlePort = new FakeCandleReadPort({ "15m": [] });
      const fromUnixMs = Date.parse("2026-01-01T00:00:00.000Z");
      const toUnixMs = Date.parse("2026-01-07T23:59:59.999Z");

      const request = createPlanRequest(Date.parse("2026-01-05T00:00:00.000Z"), "1h");

      ledgerPort.setNextResult({
        window: { from: "2026-01-01", to: "2026-01-07", fromUnixMs, toUnixMs },
        plans: [{ asOfUnixMs: request.asOfUnixMs, plan: createPlanResponse(request.asOfUnixMs) }],
        planRequests: [{ asOfUnixMs: request.asOfUnixMs, request }],
        executionResults: []
      });

      const useCase = createGetWeeklyReportUseCase({
        weeklyReportLedgerReadPort: ledgerPort,
        candleReadPort: candlePort
      });

      await useCase({ from: "2026-01-01", to: "2026-01-07" });

      expect(candlePort.windowCalls).toHaveLength(1);
      expect(candlePort.windowCalls[0].timeframe).toBe("15m");
    });
  });

  describe("uses the shared source closed-candle cutoff at the report end", () => {
    it("passes window.toUnixMs as nowUnixMs to buildRegimeCandleReadPlan", async () => {
      const ledgerPort = new FakeWeeklyReportLedgerReadPort();
      const candlePort = new FakeCandleReadPort({ "15m": [] });
      const fromUnixMs = Date.parse("2026-01-01T00:00:00.000Z");
      const toUnixMs = Date.parse("2026-01-07T23:59:59.999Z");

      const request = createPlanRequest(Date.parse("2026-01-05T00:00:00.000Z"), "15m");

      ledgerPort.setNextResult({
        window: { from: "2026-01-01", to: "2026-01-07", fromUnixMs, toUnixMs },
        plans: [],
        planRequests: [{ asOfUnixMs: request.asOfUnixMs, request }],
        executionResults: []
      });

      const useCase = createGetWeeklyReportUseCase({
        weeklyReportLedgerReadPort: ledgerPort,
        candleReadPort: candlePort
      });

      await useCase({ from: "2026-01-01", to: "2026-01-07" });

      expect(candlePort.windowCalls).toHaveLength(1);
      expect(candlePort.windowCalls[0].closedCandleCutoffUnixMs).toBeDefined();
    });
  });

  describe("skips candle reads when no request has a complete supported feed", () => {
    it("does not call candle port when all requests have empty market identity", async () => {
      const ledgerPort = new FakeWeeklyReportLedgerReadPort();
      const candlePort = new FakeCandleReadPort({ "15m": [] });
      const fromUnixMs = Date.parse("2026-01-01T00:00:00.000Z");
      const toUnixMs = Date.parse("2026-01-07T23:59:59.999Z");

      const emptyMarketRequest: PlanRequest = {
        ...createPlanRequest(Date.parse("2026-01-05T00:00:00.000Z")),
        market: {
          ...createPlanRequest(Date.parse("2026-01-05T00:00:00.000Z")).market,
          symbol: "",
          source: "",
          network: "",
          poolAddress: ""
        }
      };

      ledgerPort.setNextResult({
        window: { from: "2026-01-01", to: "2026-01-07", fromUnixMs, toUnixMs },
        plans: [],
        planRequests: [{ asOfUnixMs: emptyMarketRequest.asOfUnixMs, request: emptyMarketRequest }],
        executionResults: []
      });

      const useCase = createGetWeeklyReportUseCase({
        weeklyReportLedgerReadPort: ledgerPort,
        candleReadPort: candlePort
      });

      const result = await useCase({ from: "2026-01-01", to: "2026-01-07" });

      expect(candlePort.windowCalls).toHaveLength(0);
      expect(result.summary.baselines.solHodlFinalNavUsd).toBe(10000);
    });

    it("does not call candle port when planRequests is empty", async () => {
      const ledgerPort = new FakeWeeklyReportLedgerReadPort();
      const candlePort = new FakeCandleReadPort({ "15m": [] });
      const fromUnixMs = Date.parse("2026-01-01T00:00:00.000Z");
      const toUnixMs = Date.parse("2026-01-07T23:59:59.999Z");

      ledgerPort.setNextResult({
        window: { from: "2026-01-01", to: "2026-01-07", fromUnixMs, toUnixMs },
        plans: [],
        planRequests: [],
        executionResults: []
      });

      const useCase = createGetWeeklyReportUseCase({
        weeklyReportLedgerReadPort: ledgerPort,
        candleReadPort: candlePort
      });

      const result = await useCase({ from: "2026-01-01", to: "2026-01-07" });

      expect(candlePort.windowCalls).toHaveLength(0);
      expect(result.summary.baselines.solHodlFinalNavUsd).toBe(0);
    });
  });

  describe("does not retry or fall back when the canonical read returns no rows", () => {
    it("passes empty candle array to renderer without second read", async () => {
      const ledgerPort = new FakeWeeklyReportLedgerReadPort();
      const candlePort = new FakeCandleReadPort({ "15m": [] });
      const fromUnixMs = Date.parse("2026-01-01T00:00:00.000Z");
      const toUnixMs = Date.parse("2026-01-07T23:59:59.999Z");

      const request = createPlanRequest(Date.parse("2026-01-05T00:00:00.000Z"));

      ledgerPort.setNextResult({
        window: { from: "2026-01-01", to: "2026-01-07", fromUnixMs, toUnixMs },
        plans: [],
        planRequests: [{ asOfUnixMs: request.asOfUnixMs, request }],
        executionResults: []
      });

      const useCase = createGetWeeklyReportUseCase({
        weeklyReportLedgerReadPort: ledgerPort,
        candleReadPort: candlePort
      });

      const result = await useCase({ from: "2026-01-01", to: "2026-01-07" });

      expect(candlePort.windowCalls).toHaveLength(1);
      expect(result.summary.baselines.solHodlFinalNavUsd).toBe(10000);
    });
  });

  describe("propagates canonical candle read failures", () => {
    it("throws when candle port getCandlesForFeedWindow rejects", async () => {
      const ledgerPort = new FakeWeeklyReportLedgerReadPort();
      const candlePort = new FakeCandleReadPort();
      candlePort.setWindowError(new Error("Candle read failed"));
      const fromUnixMs = Date.parse("2026-01-01T00:00:00.000Z");
      const toUnixMs = Date.parse("2026-01-07T23:59:59.999Z");

      const request = createPlanRequest(Date.parse("2026-01-05T00:00:00.000Z"));

      ledgerPort.setNextResult({
        window: { from: "2026-01-01", to: "2026-01-07", fromUnixMs, toUnixMs },
        plans: [],
        planRequests: [{ asOfUnixMs: request.asOfUnixMs, request }],
        executionResults: []
      });

      const useCase = createGetWeeklyReportUseCase({
        weeklyReportLedgerReadPort: ledgerPort,
        candleReadPort: candlePort
      });

      await expect(useCase({ from: "2026-01-01", to: "2026-01-07" })).rejects.toThrow(
        "Candle read failed"
      );
    });
  });

  describe("preserves report range application errors", () => {
    it("propagates ReportRangeApplicationError from ledger port", async () => {
      const ledgerPort = new FakeWeeklyReportLedgerReadPort();
      ledgerPort.setNextError(new ReportRangeApplicationError("Invalid weekly report date range."));

      const useCase = createGetWeeklyReportUseCase({
        weeklyReportLedgerReadPort: ledgerPort,
        candleReadPort: new FakeCandleReadPort()
      });

      await expect(useCase({ from: "2026-02-30", to: "2026-03-01" })).rejects.toThrow(
        ReportRangeApplicationError
      );
      await expect(useCase({ from: "2026-02-30", to: "2026-03-01" })).rejects.toThrow(
        "Invalid weekly report date range."
      );
    });

    it("propagates ReportRangeApplicationError for reversed date range", async () => {
      const ledgerPort = new FakeWeeklyReportLedgerReadPort();
      ledgerPort.setNextError(
        new ReportRangeApplicationError("Invalid weekly report date range: from > to.")
      );

      const useCase = createGetWeeklyReportUseCase({
        weeklyReportLedgerReadPort: ledgerPort,
        candleReadPort: new FakeCandleReadPort()
      });

      await expect(useCase({ from: "2026-01-31", to: "2026-01-01" })).rejects.toThrow(
        ReportRangeApplicationError
      );
    });
  });

  describe("renders byte-identical output for identical explicit facts and candles", () => {
    it("produces deterministic output for same facts and candles", async () => {
      const ledgerPort = new FakeWeeklyReportLedgerReadPort();
      const candlePort = new FakeCandleReadPort();
      const fromUnixMs = Date.parse("2026-01-01T00:00:00.000Z");
      const toUnixMs = Date.parse("2026-01-07T23:59:59.999Z");

      const request = createPlanRequest(Date.parse("2026-01-05T00:00:00.000Z"));
      const plan = createPlanResponse(request.asOfUnixMs);

      ledgerPort.setNextResult({
        window: { from: "2026-01-01", to: "2026-01-07", fromUnixMs, toUnixMs },
        plans: [{ asOfUnixMs: request.asOfUnixMs, plan }],
        planRequests: [{ asOfUnixMs: request.asOfUnixMs, request }],
        executionResults: [
          { asOfUnixMs: request.asOfUnixMs, result: createExecutionResult(request.asOfUnixMs) }
        ]
      });

      const candleRows = [
        {
          unixMs: Date.parse("2026-01-01T00:00:00.000Z"),
          open: 100,
          high: 105,
          low: 99,
          close: 103,
          volume: 1000
        },
        {
          unixMs: Date.parse("2026-01-07T12:00:00.000Z"),
          open: 103,
          high: 108,
          low: 102,
          close: 106,
          volume: 1200
        }
      ];
      candlePort.rowsByTimeframe = new Map([["15m", candleRows]]);

      const useCase = createGetWeeklyReportUseCase({
        weeklyReportLedgerReadPort: ledgerPort,
        candleReadPort: candlePort
      });

      const result1 = await useCase({ from: "2026-01-01", to: "2026-01-07" });
      const result2 = await useCase({ from: "2026-01-01", to: "2026-01-07" });

      expect(result1.markdown).toBe(result2.markdown);
      expect(result1.summary).toEqual(result2.summary);
    });
  });
});
