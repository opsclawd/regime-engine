import { describe, expect, it } from "vitest";
import { buildPositionPlan, type PositionPlanInput } from "../positionPlan.js";
import { toCanonicalJson } from "../../../contract/v1/canonical.js";

const AS_OF = 1_762_591_200_000;

const fixedInput: PositionPlanInput = {
  asOfUnixMs: AS_OF,
  position: {
    positionId: "pos-snapshot",
    observedAtUnixMs: AS_OF - 30_000,
    lowerBoundPrice: 95,
    upperBoundPrice: 110,
    currentPrice: 102.5,
    rangeState: "in-range",
    breachQualified: false,
    liquidityUsd: 5_000,
    unclaimedFeesUsd: 12.5
  },
  portfolio: { navUsd: 12_000, solUnits: 25, usdcUnits: 7_000 },
  autopilotState: {
    activeClmm: true,
    stopouts24h: 0,
    redeploys24h: 0,
    cooldownUntilUnixMs: 0,
    standDownUntilUnixMs: 0,
    strikeCount: 0
  },
  regimeState: { current: "CHOP", barsInRegime: 4, pending: null, pendingBars: 0 },
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
      poolAddress: "PoolSnapshot1",
      requestedTimeframe: "1h"
    },
    regime: "CHOP",
    telemetry: {
      realizedVolShort: 0.011,
      realizedVolLong: 0.013,
      volRatio: 0.846,
      trendStrength: 0.12,
      compression: 0.4
    },
    freshness: {
      generatedAtIso: "2026-05-08T12:00:00.000Z",
      lastCandleUnixMs: AS_OF - 60_000,
      lastCandleIso: "2026-05-08T11:59:00.000Z",
      ageSeconds: 60,
      softStale: false,
      hardStale: false,
      softStaleSeconds: 1500,
      hardStaleSeconds: 2100
    },
    clmmSuitability: {
      status: "ALLOWED",
      reasons: [{ code: "CLMM_ALLOWED_CHOP_FRESH", severity: "INFO", message: "ok" }]
    },
    candleCount: 50,
    sourceCandleCount: 200,
    sourceTimeframe: "15m",
    derivedTimeframe: "1h",
    aggregationVersion: "ohlcv-agg-v1"
  }
};

describe("buildPositionPlan determinism", () => {
  it("returns byte-identical canonical JSON for identical inputs", () => {
    const first = buildPositionPlan(fixedInput);
    const second = buildPositionPlan(JSON.parse(JSON.stringify(fixedInput)));
    expect(first).toEqual(second);
    expect(first.planHash).toBe(second.planHash);
    expect(toCanonicalJson(first)).toBe(toCanonicalJson(second));
  });

  it("matches deterministic plan snapshots", () => {
    const plan = buildPositionPlan(fixedInput);
    expect(toCanonicalJson(plan)).toMatchSnapshot();
    expect(plan.planHash).toMatchSnapshot();
  });
});
