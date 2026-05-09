import { describe, expect, it } from "vitest";
import { buildPositionPlan, type PositionPlanInput } from "../positionPlan.js";
import type {
  ClmmSuitabilityStatus,
  Regime,
  RegimeCurrentFreshness
} from "../../../contract/v1/types.js";
import type { IndicatorTelemetry } from "../../features/indicators.js";

const AS_OF = 1_762_591_200_000;

const baseFreshness = (): RegimeCurrentFreshness => ({
  generatedAtIso: "2026-05-08T12:00:00.000Z",
  lastCandleOpenUnixMs: AS_OF - 60 * 60 * 1000,
  lastCandleOpenIso: "2026-05-08T11:00:00.000Z",
  lastCandleCloseUnixMs: AS_OF - 60_000,
  lastCandleCloseIso: "2026-05-08T11:59:00.000Z",
  ageSeconds: 60,
  softStale: false,
  hardStale: false,
  softStaleSeconds: 1500,
  hardStaleSeconds: 2100
});

const baseTelemetry = (): IndicatorTelemetry => ({
  realizedVolShort: 0.01,
  realizedVolLong: 0.01,
  volRatio: 1.0,
  trendStrength: 0.0,
  compression: 0.5
});

const makeInput = (overrides: {
  regime?: Regime;
  suitabilityStatus?: ClmmSuitabilityStatus;
  rangeState?: "in-range" | "below-range" | "above-range";
  breachQualified?: boolean;
  activeClmm?: boolean;
  standDown?: boolean;
}): PositionPlanInput => ({
  asOfUnixMs: AS_OF,
  position: {
    positionId: "pos-1",
    observedAtUnixMs: AS_OF,
    lowerBoundPrice: 95,
    upperBoundPrice: 110,
    currentPrice: overrides.rangeState === "below-range" ? 90 : 100,
    rangeState: overrides.rangeState ?? "in-range",
    breachQualified: overrides.breachQualified ?? false,
    breachQualifiedAtUnixMs: overrides.breachQualified ? AS_OF - 30_000 : undefined
  },
  portfolio: { navUsd: 10_000, solUnits: 20, usdcUnits: 6_000 },
  autopilotState: {
    activeClmm: overrides.activeClmm ?? false,
    stopouts24h: 0,
    redeploys24h: 0,
    cooldownUntilUnixMs: 0,
    standDownUntilUnixMs: overrides.standDown ? AS_OF + 60 * 60 * 1000 : 0,
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
  },
  market: {
    feed: {
      symbol: "SOL/USDC",
      source: "geckoterminal",
      network: "solana",
      poolAddress: "PoolA",
      requestedTimeframe: "1h"
    },
    regime: overrides.regime ?? "CHOP",
    telemetry: baseTelemetry(),
    freshness: baseFreshness(),
    clmmSuitability: { status: overrides.suitabilityStatus ?? "ALLOWED", reasons: [] },
    candleCount: 50,
    sourceCandleCount: 200,
    sourceTimeframe: "15m",
    derivedTimeframe: "1h",
    aggregationVersion: "ohlcv-agg-v1"
  },
  nextRegimeState: {
    current: overrides.regime ?? "CHOP",
    barsInRegime: 1,
    pending: null,
    pendingBars: 0
  }
});

describe("buildPositionPlan action precedence", () => {
  it("returns REQUEST_EXIT_CLMM for qualified below-range", () => {
    const plan = buildPositionPlan(
      makeInput({ rangeState: "below-range", breachQualified: true, activeClmm: true })
    );
    expect(plan.actions).toEqual([{ type: "REQUEST_EXIT_CLMM", reasonCode: expect.any(String) }]);
  });

  it("returns REQUEST_EXIT_CLMM for qualified above-range", () => {
    const plan = buildPositionPlan(
      makeInput({ rangeState: "above-range", breachQualified: true, activeClmm: true })
    );
    expect(plan.actions).toEqual([{ type: "REQUEST_EXIT_CLMM", reasonCode: expect.any(String) }]);
  });

  it("returns HOLD for below-range without breachQualified", () => {
    const plan = buildPositionPlan(
      makeInput({ rangeState: "below-range", breachQualified: false, activeClmm: true })
    );
    expect(plan.actions[0].type).toBe("HOLD");
  });

  it("returns REQUEST_EXIT_CLMM when suitability is BLOCKED and activeClmm is true", () => {
    const plan = buildPositionPlan(makeInput({ suitabilityStatus: "BLOCKED", activeClmm: true }));
    expect(plan.actions[0].type).toBe("REQUEST_EXIT_CLMM");
  });

  it("returns HOLD when suitability is BLOCKED but activeClmm is false", () => {
    const plan = buildPositionPlan(makeInput({ suitabilityStatus: "BLOCKED", activeClmm: false }));
    expect(plan.actions[0].type).toBe("HOLD");
  });

  it("returns STAND_DOWN when stand-down active and no exit conditions", () => {
    const plan = buildPositionPlan(makeInput({ standDown: true }));
    expect(plan.actions[0].type).toBe("STAND_DOWN");
  });

  it("breach precedence: qualified breach exits even when stand-down is active", () => {
    const plan = buildPositionPlan(
      makeInput({
        rangeState: "below-range",
        breachQualified: true,
        activeClmm: true,
        standDown: true
      })
    );
    expect(plan.actions[0].type).toBe("REQUEST_EXIT_CLMM");
  });

  it("returns HOLD for in-range CAUTION", () => {
    const plan = buildPositionPlan(makeInput({ suitabilityStatus: "CAUTION" }));
    expect(plan.actions[0].type).toBe("HOLD");
  });

  it("returns HOLD for in-range UNKNOWN", () => {
    const plan = buildPositionPlan(makeInput({ suitabilityStatus: "UNKNOWN" }));
    expect(plan.actions[0].type).toBe("HOLD");
  });

  it("returns HOLD for in-range ALLOWED", () => {
    const plan = buildPositionPlan(makeInput({ suitabilityStatus: "ALLOWED" }));
    expect(plan.actions[0].type).toBe("HOLD");
  });

  it("public path never emits REQUEST_REBALANCE or REQUEST_ENTER_CLMM", () => {
    const cases: Array<Partial<Parameters<typeof makeInput>[0]>> = [
      {},
      { suitabilityStatus: "ALLOWED" },
      { suitabilityStatus: "BLOCKED", activeClmm: false },
      { rangeState: "below-range", breachQualified: false },
      { standDown: true }
    ];
    for (const c of cases) {
      const plan = buildPositionPlan(makeInput(c));
      for (const action of plan.actions) {
        expect(["HOLD", "STAND_DOWN", "REQUEST_EXIT_CLMM"]).toContain(action.type);
      }
    }
  });

  it("populates scope from feed and position", () => {
    const plan = buildPositionPlan(makeInput({}));
    expect(plan.scope).toEqual({
      kind: "position",
      positionId: "pos-1",
      poolAddress: "PoolA",
      symbol: "SOL/USDC"
    });
  });

  it("populates marketData from market context", () => {
    const plan = buildPositionPlan(makeInput({}));
    expect(plan.marketData.requestedTimeframe).toBe("1h");
    expect(plan.marketData.derivedTimeframe).toBe("1h");
    expect(plan.marketData.aggregationVersion).toBe("ohlcv-agg-v1");
    expect(plan.marketData.candleCount).toBe(50);
    expect(plan.marketData.sourceCandleCount).toBe(200);
  });

  it("respects regime hysteresis: pending confirmation prevents regime flip", () => {
    const pendingInput = makeInput({ regime: "CHOP", activeClmm: true });
    pendingInput.market.regime = "CHOP";
    pendingInput.market.clmmSuitability = { status: "ALLOWED", reasons: [] };
    pendingInput.nextRegimeState = {
      current: "CHOP",
      barsInRegime: 10,
      pending: "UP",
      pendingBars: 0
    };
    const plan = buildPositionPlan(pendingInput);
    expect(plan.regime).toBe("CHOP");
    expect(plan.nextRegimeState.pending).toBe("UP");
    expect(plan.nextRegimeState.current).toBe("CHOP");
  });

  it("respects regime hysteresis: minHoldBars prevents immediate regime flip", () => {
    const holdInput = makeInput({ activeClmm: true });
    holdInput.market.regime = "UP";
    holdInput.market.clmmSuitability = { status: "ALLOWED", reasons: [] };
    holdInput.nextRegimeState = {
      current: "UP",
      barsInRegime: 1,
      pending: null,
      pendingBars: 0
    };
    const plan = buildPositionPlan(holdInput);
    expect(plan.regime).toBe("UP");
    expect(plan.nextRegimeState).toEqual(holdInput.nextRegimeState);
  });
});
