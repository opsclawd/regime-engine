import { describe, expect, it } from "vitest";
import { computeAllocationTargets } from "../policy.js";

const config = {
  upSolBps: 8_000,
  downSolBps: 1_500,
  chopSolBps: 5_000,
  maxDeltaExposureBpsPerDay: 1_000,
  maxTurnoverPerDayBps: 600
};

describe("allocation policy", () => {
  it("selects the uncapped UP regime target", () => {
    const decision = computeAllocationTargets({
      regime: "UP",
      currentSolBps: 5_000,
      config
    });

    expect(decision.desiredSolBps).toBe(8_000);
    expect(decision.targets).toEqual({
      solBps: 8_000,
      usdcBps: 2_000
    });
    expect(decision.appliedDeltaBps).toBe(3_000);
    expect(decision.capped).toBe(false);
  });

  it("selects the uncapped DOWN regime target", () => {
    const decision = computeAllocationTargets({
      regime: "DOWN",
      currentSolBps: 5_000,
      config
    });

    expect(decision.desiredSolBps).toBe(1_500);
    expect(decision.targets).toEqual({
      solBps: 1_500,
      usdcBps: 8_500
    });
    expect(decision.appliedDeltaBps).toBe(-3_500);
    expect(decision.capped).toBe(false);
  });

  it("keeps CHOP target near neutral and uncapped if already close", () => {
    const decision = computeAllocationTargets({
      regime: "CHOP",
      currentSolBps: 5_100,
      config
    });

    expect(decision.desiredSolBps).toBe(5_000);
    expect(decision.targets).toEqual({
      solBps: 5_000,
      usdcBps: 5_000
    });
    expect(decision.appliedDeltaBps).toBe(-100);
    expect(decision.capped).toBe(false);
  });

  it("keeps the regime target available for downstream volatility scaling", () => {
    const decision = computeAllocationTargets({
      regime: "UP",
      currentSolBps: 4_800,
      config: {
        ...config,
        maxDeltaExposureBpsPerDay: 100,
        maxTurnoverPerDayBps: 100
      }
    });

    expect(decision.targets.solBps).toBe(8_000);
    expect(decision.appliedDeltaBps).toBe(3_200);
  });

  it("always preserves 10_000 bps total exposure", () => {
    const regimes = ["UP", "DOWN", "CHOP"] as const;

    for (const regime of regimes) {
      const decision = computeAllocationTargets({
        regime,
        currentSolBps: 3_300,
        config
      });
      expect(decision.targets.solBps + decision.targets.usdcBps).toBe(10_000);
      expect(decision.targets.solBps).toBeGreaterThanOrEqual(0);
      expect(decision.targets.solBps).toBeLessThanOrEqual(10_000);
    }
  });
});
