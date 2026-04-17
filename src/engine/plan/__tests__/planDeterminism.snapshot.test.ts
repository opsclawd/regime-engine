import { describe, expect, it } from "vitest";
import { toCanonicalJson } from "../../../contract/v1/canonical.js";
import type { PlanRequest } from "../../../contract/v1/types.js";
import { buildPlan } from "../buildPlan.js";

const fixtureRequest: PlanRequest = {
  schemaVersion: "1.0",
  asOfUnixMs: 1_762_591_200_000,
  market: {
    symbol: "SOLUSDC",
    timeframe: "1h",
    candles: Array.from({ length: 36 }, (_, index) => {
      const base = 100 + index * 0.7 + Math.sin(index / 4) * 0.8;
      const close = base + Math.sin(index / 3) * 0.5;
      return {
        unixMs: 1_762_591_200_000 - (35 - index) * 3_600_000,
        open: base,
        high: close + 1,
        low: close - 1,
        close,
        volume: 1_000 + index * 5
      };
    })
  },
  portfolio: {
    navUsd: 12_000,
    solUnits: 25,
    usdcUnits: 7_000
  },
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
    baselines: {
      dcaIntervalDays: 7,
      dcaAmountUsd: 250,
      usdcCarryApr: 0.06
    }
  }
};

describe("plan determinism", () => {
  it("returns byte-identical canonical JSON for identical inputs", () => {
    const first = buildPlan(fixtureRequest);
    const second = buildPlan(JSON.parse(JSON.stringify(fixtureRequest)));

    expect(first).toEqual(second);
    expect(first.planHash).toBe(second.planHash);
    expect(toCanonicalJson(first)).toBe(toCanonicalJson(second));
  });

  it("matches deterministic plan snapshots", () => {
    const plan = buildPlan(fixtureRequest);
    expect(toCanonicalJson(plan)).toMatchSnapshot();
    expect(plan.planHash).toMatchSnapshot();
  });

  it("normalizes candle ordering for plan decisions", () => {
    const ascendingPlan = buildPlan(fixtureRequest);
    const descendingPlan = buildPlan({
      ...fixtureRequest,
      market: {
        ...fixtureRequest.market,
        candles: [...fixtureRequest.market.candles].reverse()
      }
    });

    expect(descendingPlan.regime).toBe(ascendingPlan.regime);
    expect(descendingPlan.telemetry.currentSolBps).toBe(ascendingPlan.telemetry.currentSolBps);
    expect(descendingPlan.targets).toEqual(ascendingPlan.targets);
    expect(descendingPlan.actions).toEqual(ascendingPlan.actions);
  });
});
