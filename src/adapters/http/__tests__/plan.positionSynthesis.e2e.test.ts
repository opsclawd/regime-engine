import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { createPlanHandler } from "../handlers/plan.js";
import { createGeneratePlanUseCase } from "../../../application/use-cases/generatePlanUseCase.js";
import { PolicyInsightStoreUnavailableError } from "../../../application/errors/policyInsightErrors.js";
import type { CandleReadPort } from "../../../application/ports/candlePorts.js";
import type { PlanLedgerWritePort } from "../../../application/ports/planLedgerPort.js";

const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const FIXED_NOW = Date.parse("2026-05-08T12:15:00.000Z");

const buildRecentCandles = (count: number) => {
  return Array.from({ length: count }, (_, i) => {
    const close = 100 + Math.sin(i / 4) * 0.5;
    return {
      unixMs: FIXED_NOW - (count - 1 - i) * FIFTEEN_MIN_MS,
      open: close - 0.1,
      high: close + 0.5,
      low: close - 0.5,
      close,
      volume: 1_000 + i
    };
  });
};

const makePlanPayload = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: "1.0",
  asOfUnixMs: FIXED_NOW,
  market: {
    symbol: "SOL/USDC",
    source: "geckoterminal",
    network: "solana",
    poolAddress: "PoolPlanE2E",
    timeframe: "1h"
  },
  position: {
    positionId: "pos-e2e-synth",
    walletId: "wallet123",
    observedAtUnixMs: FIXED_NOW,
    lowerBoundPrice: 95,
    upperBoundPrice: 110,
    currentPrice: 100,
    rangeState: "in-range",
    breachQualified: false
  },
  portfolio: { navUsd: 12_000, solUnits: 25, usdcUnits: 7_000 },
  autopilotState: {
    activeClmm: false,
    stopouts24h: 0,
    redeploys24h: 0,
    cooldownUntilUnixMs: 0,
    standDownUntilUnixMs: 0,
    strikeCount: 0
  },
  config: {
    regime: {
      confirmBars: 2,
      minHoldBars: 3,
      enterUpTrend: 0.6,
      exitUpTrend: 0.35,
      enterDownTrend: -0.6,
      exitDownTrend: -0.35,
      chopVolRatioMax: 1.4
    },
    allocation: {
      upSolBps: 8_000,
      downSolBps: 1_500,
      chopSolBps: 5_000,
      maxDeltaExposureBpsPerDay: 1_000,
      maxTurnoverPerDayBps: 600
    },
    churn: {
      maxStopouts24h: 2,
      maxRedeploys24h: 2,
      cooldownMsAfterStopout: 86_400_000,
      standDownTriggerStrikes: 2
    },
    baselines: { dcaIntervalDays: 7, dcaAmountUsd: 250, usdcCarryApr: 0.06 }
  },
  ...overrides
});

describe("/v1/plan position synthesis e2e", () => {
  it("maps position synthesis queue outage to retryable 503", async () => {
    const fakeCandleReadPort: CandleReadPort = {
      getLatestCandlesForFeed: vi.fn().mockResolvedValue(buildRecentCandles(200)),
      getCandlesForFeedWindow: vi.fn()
    };
    const fakePlanLedgerWritePort: PlanLedgerWritePort = {
      writePlan: vi.fn().mockResolvedValue(undefined)
    };
    const requestPositionSynthesisFn = vi
      .fn()
      .mockRejectedValue(
        new PolicyInsightStoreUnavailableError(
          "Queue store connection failed",
          "POLICY_STORE_UNAVAILABLE"
        )
      );
    const requestPositionSynthesis = Object.assign(requestPositionSynthesisFn, {
      reconcileStartup: vi.fn()
    });

    const useCase = createGeneratePlanUseCase({
      candleReadPort: fakeCandleReadPort,
      planLedgerWritePort: fakePlanLedgerWritePort,
      requestPositionSynthesis
    });

    const app = Fastify();
    app.post("/v1/plan", createPlanHandler(useCase));

    const res = await app.inject({
      method: "POST",
      url: "/v1/plan",
      payload: makePlanPayload()
    });

    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.schemaVersion).toBe("1.0");
    expect(body.error.code).toBe("POLICY_STORE_UNAVAILABLE");
    expect(fakePlanLedgerWritePort.writePlan).toHaveBeenCalledTimes(1);
    expect(requestPositionSynthesis).toHaveBeenCalledTimes(1);
  });
});
