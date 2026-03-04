import { describe, expect, it } from "vitest";
import type { PlanRequest } from "../../../contract/v1/types.js";
import { applyChurnGovernor } from "../governor.js";

const churnConfig: PlanRequest["config"]["churn"] = {
  maxStopouts24h: 2,
  maxRedeploys24h: 2,
  cooldownMsAfterStopout: 86_400_000,
  standDownTriggerStrikes: 2
};

const baseState: PlanRequest["autopilotState"] = {
  activeClmm: false,
  stopouts24h: 0,
  redeploys24h: 0,
  cooldownUntilUnixMs: 0,
  standDownUntilUnixMs: 0,
  strikeCount: 0
};

const AS_OF = 1_762_591_200_000;

describe("churn governor", () => {
  it("allows activity when counters are within limits", () => {
    const decision = applyChurnGovernor({
      asOfUnixMs: AS_OF,
      state: baseState,
      config: churnConfig
    });

    expect(decision.shouldStandDown).toBe(false);
    expect(decision.action).toBe("HOLD");
    expect(decision.constraints.stopoutsRemaining).toBe(2);
    expect(decision.constraints.redeploysRemaining).toBe(2);
    expect(decision.reasons[0].code).toBe("CHURN_WITHIN_LIMITS");
  });

  it("enters stand-down while cooldown is active", () => {
    const decision = applyChurnGovernor({
      asOfUnixMs: AS_OF,
      state: {
        ...baseState,
        cooldownUntilUnixMs: AS_OF + 1_000
      },
      config: churnConfig
    });

    expect(decision.shouldStandDown).toBe(true);
    expect(decision.action).toBe("STAND_DOWN");
    expect(decision.reasons.some((item) => item.code === "CHURN_COOLDOWN_ACTIVE")).toBe(
      true
    );
  });

  it("enters stand-down when stopout budget is exceeded", () => {
    const decision = applyChurnGovernor({
      asOfUnixMs: AS_OF,
      state: {
        ...baseState,
        stopouts24h: 2
      },
      config: churnConfig
    });

    expect(decision.shouldStandDown).toBe(true);
    expect(decision.constraints.stopoutsRemaining).toBe(0);
    expect(
      decision.reasons.some(
        (item) => item.code === "CHURN_STOPOUT_BUDGET_EXCEEDED"
      )
    ).toBe(true);
  });

  it("enters stand-down when two-strike trigger is reached", () => {
    const decision = applyChurnGovernor({
      asOfUnixMs: AS_OF,
      state: {
        ...baseState,
        strikeCount: 2
      },
      config: churnConfig
    });

    expect(decision.shouldStandDown).toBe(true);
    expect(decision.action).toBe("STAND_DOWN");
    expect(
      decision.reasons.some(
        (item) => item.code === "CHURN_TWO_STRIKE_STAND_DOWN"
      )
    ).toBe(true);
  });

  it("halts fakeout progression once thresholds are crossed", () => {
    const fakeoutSequence: PlanRequest["autopilotState"][] = [
      {
        ...baseState,
        stopouts24h: 0,
        redeploys24h: 0,
        strikeCount: 0
      },
      {
        ...baseState,
        stopouts24h: 1,
        redeploys24h: 1,
        strikeCount: 1
      },
      {
        ...baseState,
        stopouts24h: 2,
        redeploys24h: 1,
        strikeCount: 2
      },
      {
        ...baseState,
        stopouts24h: 2,
        redeploys24h: 2,
        strikeCount: 2
      }
    ];

    const actions = fakeoutSequence.map((state) =>
      applyChurnGovernor({
        asOfUnixMs: AS_OF,
        state,
        config: churnConfig
      }).action
    );

    expect(actions).toEqual(["HOLD", "HOLD", "STAND_DOWN", "STAND_DOWN"]);
  });
});
