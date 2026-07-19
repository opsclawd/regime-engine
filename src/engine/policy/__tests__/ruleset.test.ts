import { describe, expect, it } from "vitest";
import {
  POLICY_RULESET_VERSION,
  validatePolicyRuleset,
  SOL_USDC_POLICY_V1,
  type PolicyRuleset
} from "../ruleset.js";

describe("policy ruleset", () => {
  it("accepts and freezes sol-usdc-policy.v1", () => {
    const validated = validatePolicyRuleset(SOL_USDC_POLICY_V1);
    expect(validated.version).toBe(POLICY_RULESET_VERSION);
    expect(Object.isFrozen(validated)).toBe(true);
    expect(Object.isFrozen(validated.confidenceOrder)).toBe(true);
    expect(Object.isFrozen(validated.riskOrder)).toBe(true);
    expect(Object.isFrozen(validated.postureOrder)).toBe(true);
    expect(Object.isFrozen(validated.rangeBiasOrder)).toBe(true);
    expect(Object.isFrozen(validated.reasonOrder)).toBe(true);
    expect(Object.isFrozen(validated.featureBindings)).toBe(true);
    if (validated.featureBindings.length > 0) {
      expect(Object.isFrozen(validated.featureBindings[0])).toBe(true);
    }
  });

  it("rejects non-monotone thresholds", () => {
    // A ruleset whose confidence, risk, posture, range, or threshold ordering can relax a higher guard is rejected.
    const invalidConfidence: PolicyRuleset = {
      ...SOL_USDC_POLICY_V1,
      confidenceOrder: ["high", "medium", "low"] // incorrect order: low must be first (increasing confidence/safety)
    };
    expect(() => validatePolicyRuleset(invalidConfidence)).toThrow("Invalid confidence order");

    const invalidRisk: PolicyRuleset = {
      ...SOL_USDC_POLICY_V1,
      riskOrder: ["critical", "elevated", "normal"] // incorrect order: critical must be last
    };
    expect(() => validatePolicyRuleset(invalidRisk)).toThrow("Invalid risk order");

    const invalidPosture: PolicyRuleset = {
      ...SOL_USDC_POLICY_V1,
      postureOrder: ["paused", "defensive", "neutral", "moderately_aggressive", "aggressive"] // incorrect order: paused must be last
    };
    expect(() => validatePolicyRuleset(invalidPosture)).toThrow("Invalid posture order");

    const invalidRangeBias: PolicyRuleset = {
      ...SOL_USDC_POLICY_V1,
      rangeBiasOrder: ["passive", "wide", "medium", "tight"] // incorrect order: passive must be last
    };
    expect(() => validatePolicyRuleset(invalidRangeBias)).toThrow("Invalid range bias order");
  });

  it("rejects duplicate reason ordering", () => {
    const invalidReasons: PolicyRuleset = {
      ...SOL_USDC_POLICY_V1,
      reasonOrder: {
        REASON_A: 1,
        REASON_B: 1 // duplicate order value
      }
    };
    expect(() => validatePolicyRuleset(invalidReasons)).toThrow("Duplicate reason precedence");
  });

  it("rejects unsupported binding type or unit", () => {
    const invalidKind: PolicyRuleset = {
      ...SOL_USDC_POLICY_V1,
      featureBindings: [
        {
          bindingId: "test-binding",
          family: "volatility",
          featureId: "vol_1h",
          calculatorName: "vol-calc",
          calculatorVersion: "1.0.0",
          kind: "string" as unknown as "number", // invalid kind
          unit: "pct",
          tighten: "risk",
          threshold: 0.5
        }
      ]
    };
    expect(() => validatePolicyRuleset(invalidKind)).toThrow("Unsupported binding kind");

    const invalidUnit: PolicyRuleset = {
      ...SOL_USDC_POLICY_V1,
      featureBindings: [
        {
          bindingId: "test-binding",
          family: "volatility",
          featureId: "vol_1h",
          calculatorName: "vol-calc",
          calculatorVersion: "1.0.0",
          kind: "number",
          unit: "invalid-unit", // unsupported unit
          tighten: "risk",
          threshold: 0.5
        }
      ]
    };
    expect(() => validatePolicyRuleset(invalidUnit)).toThrow("Unsupported binding unit");
  });

  it("rejects an expiry configuration without a positive safety ttl", () => {
    const invalidTtl: PolicyRuleset = {
      ...SOL_USDC_POLICY_V1,
      degradedSafetyTtlMs: 0
    };
    expect(() => validatePolicyRuleset(invalidTtl)).toThrow("degradedSafetyTtlMs must be positive");
  });
});
