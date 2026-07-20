import { describe, expect, it } from "vitest";
import {
  synthesizePolicyInsightV1,
  type PolicySynthesisEnvelope
} from "../synthesizePolicyInsight.js";
import { SOL_USDC_POLICY_V1 } from "../ruleset.js";
import { makeMockEvidenceSummary, calmChopMarket } from "./policyFixtures.js";
import type { DeterministicFeature } from "../../../contract/evidence/v1/types.generated.js";

const AS_OF = 1762591200000;

describe("synthesizePolicyInsight - Determinism Invariants", () => {
  it("fixed input produces byte-identical canonical insight output", () => {
    // 5. Byte deterministic output
    const envelope: PolicySynthesisEnvelope = {
      synthesisAtUnixMs: AS_OF,
      pair: "SOL/USDC",
      scope: { kind: "pair" },
      market: calmChopMarket,
      positionPlan: null,
      evidence: makeMockEvidenceSummary({
        mode: "FULL",
        selected: {
          deterministicFeatures: [
            {
              candidateId: "det-1",
              bundleHash: "b-1",
              publisher: "pub-1",
              sourceId: "src-1",
              runId: "r-1",
              correlationId: "c-1",
              receivedAtUnixMs: AS_OF,
              originalItem: {
                status: "available",
                featureId: "vol_1h",
                family: "volatility",
                calculator: {
                  name: "std-vol",
                  version: "1.0.0"
                },
                value: 6.5, // > 5.0 threshold
                unit: "pct"
              } as unknown as DeterministicFeature,
              featureId: "vol_1h",
              family: "volatility",
              value: 6.5,
              rawConfidence: 1.0,
              sourceQuality: 1.0,
              provenanceQuality: 1.0,
              freshnessWeight: 1.0,
              score: 100,
              sourceReferenceIds: [],
              status: "SELECTED",
              reasons: []
            }
          ],
          contextualEvidence: {
            supportResistance: [],
            flows: [],
            derivatives: [],
            events: [],
            newsRegulatory: []
          },
          researchBrief: null
        }
      }),
      hashes: { inputHash: "in-1", rulesetHash: "rules-1" }
    };

    const result1 = synthesizePolicyInsightV1(envelope, SOL_USDC_POLICY_V1);
    const result2 = synthesizePolicyInsightV1(envelope, SOL_USDC_POLICY_V1);

    const json1 = JSON.stringify(result1);
    const json2 = JSON.stringify(result2);

    expect(json1).toBe(json2);
  });
});
