import { describe, expect, it } from "vitest";
import { selectEvidence } from "../selectEvidence.js";
import { EVIDENCE_SELECTION_POLICY_V1 } from "../selectionPolicy.js";
import { buildEvidenceBundle, buildEvidenceRecord } from "./evidenceSelectionFixtures.js";

function selectWithThreshold(
  bundle: ReturnType<typeof buildEvidenceBundle>,
  minimumEffectiveScoreBps: number
) {
  return selectEvidence({
    records: [
      buildEvidenceRecord(bundle, {
        lifecycle: "FRESH",
        evidenceHash: "hash-deterministic-coverage"
      })
    ],
    selectedAtUnixMs: Date.parse(bundle.asOf),
    scope: { kind: "pair" },
    policy: {
      ...EVIDENCE_SELECTION_POLICY_V1,
      defaultSourceQualityBps: 10_000,
      minimumEffectiveScoreBps
    }
  });
}

function deterministicWarnings(result: ReturnType<typeof selectEvidence>) {
  return result.warnings.filter((warning) => warning.message.includes("deterministic"));
}

describe("deterministic evidence coverage status", () => {
  it("does not warn that deterministic evidence is missing when a registered feature is selected", () => {
    const result = selectWithThreshold(buildEvidenceBundle(), 1_000);

    expect(result.selected.deterministicFeatures).toHaveLength(1);
    expect(deterministicWarnings(result)).toEqual([]);
    expect(result.mode).toBe("DEGRADED_NO_RESEARCH");
  });

  it("warns that deterministic evidence was rejected when registered features fail selection", () => {
    const result = selectWithThreshold(buildEvidenceBundle(), 10_000);

    expect(result.selected.deterministicFeatures).toHaveLength(0);
    expect(deterministicWarnings(result)).toEqual([
      {
        code: "rejected_family",
        message: "Family deterministic has candidates but none were selected"
      }
    ]);
  });

  it("warns that deterministic evidence is missing when no feature is registered", () => {
    const result = selectWithThreshold(
      buildEvidenceBundle({
        deterministicFeatures: [
          {
            featureId: "feat-price-unavailable",
            family: "market_state",
            featureKind: "number",
            status: "unavailable",
            value: null,
            unit: null,
            observedAt: null,
            freshUntil: null,
            confidenceBps: 0,
            calculator: { name: "price-aggregator", version: "1.0.0" },
            inputLineage: ["ref-price-source"],
            warnings: ["warning-001"]
          }
        ]
      }),
      1_000
    );

    expect(result.selected.deterministicFeatures).toHaveLength(0);
    expect(deterministicWarnings(result)).toEqual([
      {
        code: "missing_family",
        message: "Family deterministic is missing from selected evidence"
      }
    ]);
  });
});
