import { describe, expect, it } from "vitest";
import { computeInsightCanonicalAndHash } from "../insights.js";
import { toCanonicalJson } from "../canonical.js";

const fixtureA = {
  schemaVersion: "1.0",
  pair: "SOL/USDC",
  asOf: "2026-04-27T13:00:00Z",
  source: "openclaw",
  runId: "clmm-daily-sol-usdc-insight-2026-04-27",
  marketRegime: "high_volatility_uptrend",
  fundamentalRegime: "constructive",
  recommendedAction: "widen_range",
  confidence: "medium",
  riskLevel: "elevated",
  dataQuality: "complete",
  clmmPolicy: {
    posture: "defensive",
    rangeBias: "wide",
    rebalanceSensitivity: "high",
    maxCapitalDeploymentPercent: 50
  },
  levels: {
    support: [138.5, 132.0],
    resistance: [154.0, 162.0]
  },
  reasoning: ["SOL volatility expanded.", "Range is near upper edge."],
  sourceRefs: ["openclaw:clmm-daily-sol-usdc-insight"],
  expiresAt: "2026-04-28T13:00:00Z"
} as const;

const fixtureB = {
  expiresAt: "2026-04-28T13:00:00Z",
  sourceRefs: ["openclaw:clmm-daily-sol-usdc-insight"],
  reasoning: ["SOL volatility expanded.", "Range is near upper edge."],
  levels: {
    resistance: [154.0, 162.0],
    support: [138.5, 132.0]
  },
  clmmPolicy: {
    rebalanceSensitivity: "high",
    rangeBias: "wide",
    posture: "defensive",
    maxCapitalDeploymentPercent: 50
  },
  dataQuality: "complete",
  riskLevel: "elevated",
  confidence: "medium",
  recommendedAction: "widen_range",
  fundamentalRegime: "constructive",
  marketRegime: "high_volatility_uptrend",
  runId: "clmm-daily-sol-usdc-insight-2026-04-27",
  source: "openclaw",
  asOf: "2026-04-27T13:00:00Z",
  pair: "SOL/USDC",
  schemaVersion: "1.0"
} as const;

describe("insight canonical JSON + payload hash", () => {
  it("canonical JSON snapshot is stable", () => {
    expect(toCanonicalJson(fixtureA)).toMatchSnapshot();
  });

  it("payload hash snapshot is stable", () => {
    expect(computeInsightCanonicalAndHash(fixtureA as never).hash).toMatchSnapshot();
  });

  it("is byte-identical for semantically equal payloads with different key order", () => {
    expect(toCanonicalJson(fixtureA)).toBe(toCanonicalJson(fixtureB));
    expect(computeInsightCanonicalAndHash(fixtureA as never).hash).toBe(
      computeInsightCanonicalAndHash(fixtureB as never).hash
    );
  });

  it("produces same hash for semantically identical timestamps in different ISO formats", () => {
    const noMillis = {
      ...fixtureA,
      asOf: "2026-04-27T13:00:00Z",
      expiresAt: "2026-04-28T13:00:00Z"
    } as const;
    const withMillis = {
      ...fixtureA,
      asOf: "2026-04-27T13:00:00.000Z",
      expiresAt: "2026-04-28T13:00:00.000Z"
    } as const;
    const withOffset = {
      ...fixtureA,
      asOf: "2026-04-27T13:00:00+00:00",
      expiresAt: "2026-04-28T13:00:00+00:00"
    } as const;

    const hashNoMillis = computeInsightCanonicalAndHash(noMillis as never).hash;
    const hashWithMillis = computeInsightCanonicalAndHash(withMillis as never).hash;
    const hashWithOffset = computeInsightCanonicalAndHash(withOffset as never).hash;

    expect(hashNoMillis).toBe(hashWithMillis);
    expect(hashNoMillis).toBe(hashWithOffset);
  });
});
