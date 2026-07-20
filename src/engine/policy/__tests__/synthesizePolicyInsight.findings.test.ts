import { describe, expect, it } from "vitest";
import {
  synthesizePolicyInsightV1,
  type PolicySynthesisEnvelope
} from "../synthesizePolicyInsight.js";
import { SOL_USDC_POLICY_V1 } from "../ruleset.js";
import { makeMockEvidenceSummary, calmChopMarket } from "./policyFixtures.js";
import type { SupportResistanceClaim } from "../../../contract/evidence/v1/types.generated.js";

const AS_OF = 1762591200000;

describe("synthesizePolicyInsight - Findings reproduction", () => {
  it("excludes expired contextual claims from evidenceExpiresAt and boundedIdentifiers", () => {
    const envelope: PolicySynthesisEnvelope = {
      synthesisAtUnixMs: AS_OF,
      pair: "SOL/USDC",
      scope: { kind: "pair" },
      market: calmChopMarket,
      positionPlan: null,
      evidence: makeMockEvidenceSummary({
        mode: "FULL",
        selected: {
          deterministicFeatures: [],
          contextualEvidence: {
            supportResistance: [
              {
                candidateId: "expired-claim",
                bundleHash: "b-1",
                publisher: "pub-1",
                sourceId: "src-1",
                runId: "r-1",
                correlationId: "c-1",
                receivedAtUnixMs: AS_OF,
                originalItem: {
                  evidenceId: "ev-expired",
                  claim: "Expired support level",
                  direction: "bearish",
                  confidenceBps: 8000,
                  expiresAt: new Date(AS_OF - 1000).toISOString() // Expired!
                } as unknown as SupportResistanceClaim,
                evidenceId: "ev-expired",
                claim: "Expired support level",
                direction: "bearish",
                rawConfidence: 0.8,
                sourceQuality: 1.0,
                provenanceQuality: 1.0,
                freshnessWeight: 1.0,
                score: 100,
                sourceReferenceIds: [],
                status: "SELECTED",
                reasons: []
              },
              {
                candidateId: "valid-claim",
                bundleHash: "b-1",
                publisher: "pub-1",
                sourceId: "src-1",
                runId: "r-1",
                correlationId: "c-1",
                receivedAtUnixMs: AS_OF,
                originalItem: {
                  evidenceId: "ev-valid",
                  claim: "Valid support level",
                  direction: "bearish",
                  confidenceBps: 8000,
                  expiresAt: new Date(AS_OF + 3600000).toISOString() // Valid!
                } as unknown as SupportResistanceClaim,
                evidenceId: "ev-valid",
                claim: "Valid support level",
                direction: "bearish",
                rawConfidence: 0.8,
                sourceQuality: 1.0,
                provenanceQuality: 1.0,
                freshnessWeight: 1.0,
                score: 100,
                sourceReferenceIds: [],
                status: "SELECTED",
                reasons: []
              }
            ],
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

    const result = synthesizePolicyInsightV1(envelope, SOL_USDC_POLICY_V1);

    // Expired claim has expiry at AS_OF - 1000, valid has AS_OF + 3600000.
    // If expired claim is included, expiresAt will be AS_OF - 1000.
    // If not, it should be AS_OF + 3600000 or max lifetime.
    const expiresAtMs = Date.parse(result.expiresAt);
    expect(expiresAtMs).toBeGreaterThan(AS_OF);

    // Also verify that the expired claim is not in boundedIdentifiers (which feeds into reasoning)
    const hasExpiredIdentifier = result.reasoning.includes("expired-claim");
    expect(hasExpiredIdentifier).toBe(false);

    // The valid claim should be in reasoning
    const hasValidIdentifier = result.reasoning.includes("valid-claim");
    expect(hasValidIdentifier).toBe(true);
  });

  it("sorts bounded identifiers lexicographically in reasoning", () => {
    const envelope: PolicySynthesisEnvelope = {
      synthesisAtUnixMs: AS_OF,
      pair: "SOL/USDC",
      scope: { kind: "pair" },
      market: calmChopMarket,
      positionPlan: null,
      evidence: makeMockEvidenceSummary({
        mode: "FULL",
        selected: {
          deterministicFeatures: [],
          contextualEvidence: {
            supportResistance: [
              {
                candidateId: "z-claim",
                bundleHash: "b-1",
                publisher: "pub-1",
                sourceId: "src-1",
                runId: "r-1",
                correlationId: "c-1",
                receivedAtUnixMs: AS_OF,
                originalItem: {
                  evidenceId: "ev-z",
                  claim: "Z level",
                  direction: "bearish",
                  confidenceBps: 8000,
                  expiresAt: new Date(AS_OF + 3600000).toISOString()
                } as unknown as SupportResistanceClaim,
                evidenceId: "ev-z",
                claim: "Z level",
                direction: "bearish",
                rawConfidence: 0.8,
                sourceQuality: 1.0,
                provenanceQuality: 1.0,
                freshnessWeight: 1.0,
                score: 100,
                sourceReferenceIds: [],
                status: "SELECTED",
                reasons: []
              },
              {
                candidateId: "a-claim",
                bundleHash: "b-1",
                publisher: "pub-1",
                sourceId: "src-1",
                runId: "r-1",
                correlationId: "c-1",
                receivedAtUnixMs: AS_OF,
                originalItem: {
                  evidenceId: "ev-a",
                  claim: "A level",
                  direction: "bearish",
                  confidenceBps: 8000,
                  expiresAt: new Date(AS_OF + 3600000).toISOString()
                } as unknown as SupportResistanceClaim,
                evidenceId: "ev-a",
                claim: "A level",
                direction: "bearish",
                rawConfidence: 0.8,
                sourceQuality: 1.0,
                provenanceQuality: 1.0,
                freshnessWeight: 1.0,
                score: 100,
                sourceReferenceIds: [],
                status: "SELECTED",
                reasons: []
              }
            ],
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

    const result = synthesizePolicyInsightV1(envelope, SOL_USDC_POLICY_V1);

    // Find lines starting with "IDENTIFIER: "
    const idents = result.reasoning
      .split(" | ")
      .filter((r) => r.startsWith("IDENTIFIER: "))
      .map((r) => r.replace("IDENTIFIER: ", ""));

    expect(idents).toEqual(["a-claim", "z-claim"]);
  });
});
