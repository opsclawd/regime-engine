import { describe, expect, it } from "vitest";
import { applyVolatilityTargeting } from "../volTarget.js";

describe("volatility targeting overlay", () => {
  it("de-risks SOL target when realized volatility spikes", () => {
    const decision = applyVolatilityTargeting({
      regime: "UP",
      currentSolBps: 7_000,
      targetSolBps: 8_000,
      volRatio: 2,
      maxDeltaExposureBpsPerDay: 5_000,
      maxTurnoverPerDayBps: 5_000
    });

    expect(decision.volRatio).toBe(2);
    expect(decision.scale).toBe(0.6);
    expect(decision.desiredAfterVolSolBps).toBe(6_800);
    expect(decision.targets.solBps).toBe(6_800);
  });

  it("allows additional UP tilt when volatility is low", () => {
    const decision = applyVolatilityTargeting({
      regime: "UP",
      currentSolBps: 7_000,
      targetSolBps: 8_000,
      volRatio: 0.5,
      maxDeltaExposureBpsPerDay: 5_000,
      maxTurnoverPerDayBps: 5_000
    });

    expect(decision.volRatio).toBe(0.5);
    expect(decision.scale).toBe(1.15);
    expect(decision.desiredAfterVolSolBps).toBe(8_450);
    expect(decision.targets.solBps).toBe(8_450);
  });

  it("keeps explicit caps in force after volatility scaling", () => {
    const decision = applyVolatilityTargeting({
      regime: "UP",
      currentSolBps: 2_000,
      targetSolBps: 8_000,
      volRatio: 0.5,
      maxDeltaExposureBpsPerDay: 500,
      maxTurnoverPerDayBps: 400
    });

    expect(decision.desiredAfterVolSolBps).toBe(8_450);
    expect(decision.targets.solBps).toBe(2_400);
    expect(decision.targets.usdcBps).toBe(7_600);
    expect(decision.capped).toBe(true);
  });
});
