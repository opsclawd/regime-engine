import { describe, expect, it } from "vitest";
import { buildPositionPlan, type PositionPlanInput } from "../../../engine/plan/positionPlan.js";
import { toCanonicalJson } from "../canonical.js";

const AS_OF = 1_762_591_200_000;

const fixedInput: PositionPlanInput = {
  asOfUnixMs: AS_OF,
  position: {
    positionId: "pos-canonical-snap",
    observedAtUnixMs: AS_OF,
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
  },
  market: {
    feed: {
      symbol: "SOL/USDC",
      source: "geckoterminal",
      network: "solana",
      poolAddress: "PoolCanonical1",
      requestedTimeframe: "1h"
    },
    regime: "CHOP",
    telemetry: {
      realizedVolShort: 0.01,
      realizedVolLong: 0.01,
      volRatio: 1.0,
      trendStrength: 0.0,
      compression: 0.5
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
    clmmSuitability: { status: "ALLOWED", reasons: [] },
    candleCount: 50,
    sourceCandleCount: 200,
    sourceTimeframe: "15m",
    derivedTimeframe: "1h",
    aggregationVersion: "ohlcv-agg-v1"
  }
};

describe("canonical JSON and planHash", () => {
  it("produces byte-identical canonical JSON for identical inputs", () => {
    const a = buildPositionPlan(fixedInput);
    const b = buildPositionPlan(JSON.parse(JSON.stringify(fixedInput)));
    expect(toCanonicalJson(a)).toBe(toCanonicalJson(b));
    expect(a.planHash).toBe(b.planHash);
  });

  it("matches the deterministic snapshot", () => {
    const plan = buildPositionPlan(fixedInput);
    expect(toCanonicalJson(plan)).toMatchSnapshot();
    expect(plan.planHash).toMatchSnapshot();
  });
});
