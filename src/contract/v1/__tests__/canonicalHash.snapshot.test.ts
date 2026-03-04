import { describe, expect, it } from "vitest";
import { toCanonicalJson } from "../canonical.js";
import { planHashFromPlan } from "../hash.js";

const planFixtureA = {
  schemaVersion: "1.0",
  planId: "plan-001",
  regime: "CHOP",
  targets: {
    usdcBps: 5_200,
    allowClmm: true,
    solBps: 4_800
  },
  telemetry: {
    ratio: 0.012345,
    negZero: -0
  },
  actions: [{ reasonCode: "R001", type: "HOLD" }],
  reasons: [{ severity: "INFO", message: "neutral", code: "R001" }],
  constraints: {
    standDownUntilUnixMs: 0,
    notes: ["within_caps"],
    cooldownUntilUnixMs: 0
  }
} as const;

const planFixtureB = {
  constraints: {
    cooldownUntilUnixMs: 0,
    notes: ["within_caps"],
    standDownUntilUnixMs: 0
  },
  reasons: [{ code: "R001", message: "neutral", severity: "INFO" }],
  actions: [{ type: "HOLD", reasonCode: "R001" }],
  telemetry: {
    negZero: -0,
    ratio: 0.012345
  },
  targets: {
    solBps: 4_800,
    allowClmm: true,
    usdcBps: 5_200
  },
  regime: "CHOP",
  planId: "plan-001",
  schemaVersion: "1.0"
} as const;

describe("canonical JSON + plan hash", () => {
  it("generates canonical plan JSON snapshot", () => {
    expect(toCanonicalJson(planFixtureA)).toMatchSnapshot();
  });

  it("is stable for semantically identical objects", () => {
    expect(toCanonicalJson(planFixtureA)).toBe(toCanonicalJson(planFixtureB));
    expect(planHashFromPlan(planFixtureA)).toBe(planHashFromPlan(planFixtureB));
  });

  it("generates deterministic plan hash snapshot", () => {
    expect(planHashFromPlan(planFixtureA)).toMatchSnapshot();
  });
});
