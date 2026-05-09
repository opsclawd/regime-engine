import { describe, expect, it } from "vitest";
import { classifyRegimeForPlan } from "../classifyRegimeForPlan.js";
import { MARKET_REGIME_CONFIG } from "../config.js";

const config = MARKET_REGIME_CONFIG["15m"].regime;

const chopTelemetry = {
  realizedVolShort: 0.01,
  realizedVolLong: 0.01,
  volRatio: 0.5,
  trendStrength: 0,
  compression: 0.05
};

const upTelemetry = {
  realizedVolShort: 0.01,
  realizedVolLong: 0.01,
  volRatio: 0.5,
  trendStrength: 1.0,
  compression: 0.05
};

describe("classifyRegimeForPlan", () => {
  it("defaults to CHOP when no prior state", () => {
    const result = classifyRegimeForPlan(chopTelemetry, config);
    expect(result.regime).toBe("CHOP");
    expect(result.nextState).toEqual({
      current: "CHOP",
      barsInRegime: 1,
      pending: null,
      pendingBars: 0
    });
  });

  it("continues regime when prior state matches telemetry", () => {
    const priorState = { current: "CHOP" as const, barsInRegime: 4, pending: null, pendingBars: 0 };
    const result = classifyRegimeForPlan(chopTelemetry, config, priorState);
    expect(result.regime).toBe("CHOP");
    expect(result.nextState.barsInRegime).toBe(5);
    expect(result.reasons.map((r) => r.code)).toContain("REGIME_STABLE");
  });

  it("holds regime via minHoldBars even when telemetry flips", () => {
    const configWithHold = { ...config, minHoldBars: 3 };
    const priorState = { current: "UP" as const, barsInRegime: 1, pending: null, pendingBars: 0 };
    const result = classifyRegimeForPlan(chopTelemetry, configWithHold, priorState);
    expect(result.regime).toBe("UP");
    expect(result.reasons.map((r) => r.code)).toContain("REGIME_MIN_HOLD_ACTIVE");
  });

  it("does not switch regime pending confirmBars confirmation", () => {
    const result = classifyRegimeForPlan(upTelemetry, config);
    expect(result.nextState.pending).toBe("UP");
    expect(result.nextState.pendingBars).toBe(1);
  });

  it("emits REGIME_CONFIRM_PENDING during pending transition", () => {
    const priorState = {
      current: "CHOP" as const,
      barsInRegime: 10,
      pending: "UP" as const,
      pendingBars: 0
    };
    const result = classifyRegimeForPlan(upTelemetry, config, priorState);
    expect(result.regime).toBe("CHOP");
    expect(result.reasons.map((r) => r.code)).toContain("REGIME_CONFIRM_PENDING");
  });

  it("confirms regime switch after confirmBars consecutive bars", () => {
    const priorState = {
      current: "CHOP" as const,
      barsInRegime: 10,
      pending: "UP" as const,
      pendingBars: 0
    };
    const step1 = classifyRegimeForPlan(upTelemetry, config, priorState);
    expect(step1.regime).toBe("CHOP");
    expect(step1.nextState.pendingBars).toBe(1);

    const step2 = classifyRegimeForPlan(upTelemetry, config, step1.nextState);
    expect(step2.regime).toBe("UP");
    expect(step2.reasons.map((r) => r.code)).toContain("REGIME_SWITCH_CONFIRMED");
  });

  it("passes through all hysteresis reason codes", () => {
    const configWithHold = { ...config, minHoldBars: 5 };
    const priorState = { current: "UP" as const, barsInRegime: 1, pending: null, pendingBars: 0 };
    const result = classifyRegimeForPlan(chopTelemetry, configWithHold, priorState);
    const codes = result.reasons.map((r) => r.code);
    expect(codes).toContain("REGIME_MIN_HOLD_ACTIVE");
    expect(codes).not.toContain("REGIME_STABLE");
  });
});
