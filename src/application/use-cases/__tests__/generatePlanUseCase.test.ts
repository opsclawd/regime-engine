import { describe, expect, it } from "vitest";
import { createGeneratePlanUseCase } from "../generatePlanUseCase.js";
import { FakePlanLedgerWritePort } from "./fakes/fakePlanLedgerWritePort.js";
import { FakeCandleReadPort } from "./fakes/fakeCandleReadPort.js";
import { FakeClockPort } from "./fakes/fakeClockPort.js";
import {
  PlanMarketDataUnavailableError,
  PlanPositionStateStaleError
} from "../../errors/planErrors.js";
import { MARKET_REGIME_CONFIG } from "../../../engine/marketRegime/config.js";
import type { CandleRow, PlanRequest } from "../../../contract/v1/types.js";

const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const FIXED_NOW = Date.parse("2026-05-08T12:15:00.000Z");
const AS_OF = FIXED_NOW;

const buildSequential15mRows = (count: number, anchor: number, basePrice = 100): CandleRow[] =>
  Array.from({ length: count }, (_, i) => {
    const close = basePrice + Math.sin(i / 4) * 0.5;
    return {
      unixMs: anchor - (count - 1 - i) * FIFTEEN_MIN_MS,
      open: close - 0.1,
      high: close + 0.5,
      low: close - 0.5,
      close,
      volume: 1_000 + i
    };
  });

const makeRequest = (overrides: Partial<PlanRequest> = {}): PlanRequest => ({
  schemaVersion: "1.0",
  asOfUnixMs: AS_OF,
  market: {
    symbol: "SOL/USDC",
    source: "geckoterminal",
    network: "solana",
    poolAddress: "PoolUC1",
    timeframe: "1h"
  },
  position: {
    positionId: "pos-uc-1",
    observedAtUnixMs: AS_OF,
    lowerBoundPrice: 95,
    upperBoundPrice: 110,
    currentPrice: 100,
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
      confirmBars: 2,
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
  },
  ...overrides
});

const buildDeps = (rows: CandleRow[]) => {
  const candleReadPort = new FakeCandleReadPort({ "15m": rows });
  const clock = new FakeClockPort(FIXED_NOW);
  const planLedgerWritePort = new FakePlanLedgerWritePort();
  return { candleReadPort, clock, planLedgerWritePort };
};

const enoughDerived1hSourceRows = () =>
  buildSequential15mRows((MARKET_REGIME_CONFIG["1h"].suitability.minCandles + 20) * 4, FIXED_NOW);

describe("GeneratePlanUseCase", () => {
  it("returns a position-scoped plan and writes once on the happy path", async () => {
    const { candleReadPort, clock, planLedgerWritePort } = buildDeps(enoughDerived1hSourceRows());
    const useCase = createGeneratePlanUseCase({
      candleReadPort,
      clock,
      engineVersion: "9.9.9",
      planLedgerWritePort
    });

    const body = makeRequest();
    const plan = await useCase(body);

    expect(plan.scope).toEqual({
      kind: "position",
      positionId: "pos-uc-1",
      poolAddress: "PoolUC1",
      symbol: "SOL/USDC"
    });
    expect(plan.marketData.requestedTimeframe).toBe("1h");
    expect(plan.marketData.sourceTimeframe).toBe("15m");
    expect(planLedgerWritePort.calls).toHaveLength(1);
    expect(planLedgerWritePort.calls[0].planRequest).toBe(body);
    expect(planLedgerWritePort.calls[0].planResponse).toBe(plan);
  });

  it("raises PlanPositionStateStaleError when observedAtUnixMs is older than 60s", async () => {
    const { candleReadPort, clock, planLedgerWritePort } = buildDeps(enoughDerived1hSourceRows());
    const useCase = createGeneratePlanUseCase({
      candleReadPort,
      clock,
      engineVersion: "9.9.9",
      planLedgerWritePort
    });

    const body = makeRequest({
      position: { ...makeRequest().position, observedAtUnixMs: AS_OF - 60_001 }
    });
    await expect(useCase(body)).rejects.toBeInstanceOf(PlanPositionStateStaleError);
  });

  it("raises PlanMarketDataUnavailableError when no closed candles are available", async () => {
    const { candleReadPort, clock, planLedgerWritePort } = buildDeps([]);
    const useCase = createGeneratePlanUseCase({
      candleReadPort,
      clock,
      engineVersion: "9.9.9",
      planLedgerWritePort
    });

    await expect(useCase(makeRequest())).rejects.toBeInstanceOf(PlanMarketDataUnavailableError);
  });

  it("raises PlanMarketDataUnavailableError when closed candles exist but are insufficient", async () => {
    const { candleReadPort, clock, planLedgerWritePort } = buildDeps(
      buildSequential15mRows(8, FIXED_NOW - ONE_HOUR_MS)
    );
    const useCase = createGeneratePlanUseCase({
      candleReadPort,
      clock,
      engineVersion: "9.9.9",
      planLedgerWritePort
    });

    await expect(useCase(makeRequest())).rejects.toBeInstanceOf(PlanMarketDataUnavailableError);
  });

  it("raises PlanMarketDataUnavailableError when derived 1h aggregation produces no complete bars", async () => {
    const { candleReadPort, clock, planLedgerWritePort } = buildDeps([
      {
        unixMs: FIXED_NOW - 200 * ONE_HOUR_MS,
        open: 100,
        high: 100.5,
        low: 99.5,
        close: 100,
        volume: 1
      }
    ]);
    const useCase = createGeneratePlanUseCase({
      candleReadPort,
      clock,
      engineVersion: "9.9.9",
      planLedgerWritePort
    });

    await expect(useCase(makeRequest())).rejects.toBeInstanceOf(PlanMarketDataUnavailableError);
  });

  it("emits REQUEST_EXIT_CLMM for a qualified below-range position", async () => {
    const { candleReadPort, clock, planLedgerWritePort } = buildDeps(enoughDerived1hSourceRows());
    const useCase = createGeneratePlanUseCase({
      candleReadPort,
      clock,
      engineVersion: "9.9.9",
      planLedgerWritePort
    });

    const body = makeRequest({
      position: {
        ...makeRequest().position,
        rangeState: "below-range",
        currentPrice: 90,
        breachQualified: true,
        breachQualifiedAtUnixMs: AS_OF - 30_000
      }
    });
    const plan = await useCase(body);
    expect(plan.actions[0].type).toBe("REQUEST_EXIT_CLMM");
  });
});
