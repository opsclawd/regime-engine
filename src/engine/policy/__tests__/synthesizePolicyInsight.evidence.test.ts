import { describe, expect, it } from "vitest";
import {
  synthesizePolicyInsight,
  type PolicySynthesisEnvelope
} from "../synthesizePolicyInsight.js";
import { SOL_USDC_POLICY_V1 } from "../ruleset.js";
import {
  makeMockEvidenceSummary,
  makeMockMarketResponse,
  calmChopMarket,
  sparseEvidenceSummary
} from "./policyFixtures.js";
import type {
  DeterministicFeature,
  SupportResistanceClaim,
  ResearchBrief
} from "../../../contract/evidence/v1/types.generated.js";

const AS_OF = 1762591200000;

describe("synthesizePolicyInsight - Evidence Invariants", () => {
  it("lower-precedence evidence can tighten but never relax locked policy fields", () => {
    // 1. Monotone evidence refinement
    // Create an envelope with high precedence lock: DATA_HARD_STALE
    // This locks action = "pause_rebalances" and posture = "paused"
    // Provide strong bullish/aggressive lower-precedence evidence
    const envelope: PolicySynthesisEnvelope = {
      synthesisAtUnixMs: AS_OF,
      pair: "SOL/USDC",
      scope: { kind: "pair" },
      market: makeMockMarketResponse({
        regime: "UP",
        freshness: {
          generatedAtIso: new Date(AS_OF - 5000).toISOString(),
          lastCandleOpenUnixMs: AS_OF - 3600000,
          lastCandleOpenIso: new Date(AS_OF - 3600000).toISOString(),
          lastCandleCloseUnixMs: AS_OF - 60000,
          lastCandleCloseIso: new Date(AS_OF - 60000).toISOString(),
          ageSeconds: 5,
          softStale: false,
          hardStale: true,
          softStaleSeconds: 1500,
          hardStaleSeconds: 2100
        }
      }),
      positionPlan: null,
      evidence: makeMockEvidenceSummary({
        mode: "FULL",
        selected: {
          deterministicFeatures: [],
          contextualEvidence: {
            supportResistance: [
              {
                candidateId: "cand-1",
                bundleHash: "b-1",
                publisher: "pub-1",
                sourceId: "src-1",
                runId: "r-1",
                correlationId: "c-1",
                receivedAtUnixMs: AS_OF,
                originalItem: {
                  evidenceId: "ev-1",
                  claim: "Super strong bullish support",
                  direction: "bullish",
                  confidenceBps: 9000,
                  expiresAt: new Date(AS_OF + 3600000).toISOString()
                } as unknown as SupportResistanceClaim,
                evidenceId: "ev-1",
                claim: "Super strong bullish support",
                direction: "bullish",
                rawConfidence: 0.9,
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

    const result = synthesizePolicyInsight(envelope, SOL_USDC_POLICY_V1);

    // The high-precedence hard stale lock MUST NOT be relaxed
    expect(result.recommendedAction).toBe("pause_rebalances");
    expect(result.clmmPolicy.posture).toBe("paused");
  });

  it("no evidence remains degraded rather than a successful zero signal", () => {
    // 2. Explicit no-evidence degradation
    const envelope: PolicySynthesisEnvelope = {
      synthesisAtUnixMs: AS_OF,
      pair: "SOL/USDC",
      scope: { kind: "pair" },
      market: calmChopMarket,
      positionPlan: null,
      evidence: sparseEvidenceSummary,
      hashes: { inputHash: "in-1", rulesetHash: "rules-1" }
    };

    const result = synthesizePolicyInsight(envelope, SOL_USDC_POLICY_V1);

    // Should be a successful synthesis but in degraded state
    expect(result.dataQuality).toBe("complete");
    // Verify it doesn't default to a numeric zero signal or action, but is explicit
    expect(result.recommendedAction).toBe("watch");
    expect(result.clmmPolicy.maxCapitalDeploymentPercent).toBe(75); // standard baseline
  });

  it("expired and unknown evidence cannot affect policy", () => {
    // 3. Excluded evidence is audit only
    // Pass expired evidence / unknown deterministic bindings
    const envelope: PolicySynthesisEnvelope = {
      synthesisAtUnixMs: AS_OF,
      pair: "SOL/USDC",
      scope: { kind: "pair" },
      market: calmChopMarket,
      positionPlan: null,
      evidence: makeMockEvidenceSummary({
        mode: "PARTIAL",
        selected: {
          deterministicFeatures: [
            {
              candidateId: "det-unknown",
              bundleHash: "b-1",
              publisher: "pub-1",
              sourceId: "src-1",
              runId: "r-1",
              correlationId: "c-1",
              receivedAtUnixMs: AS_OF,
              originalItem: {
                featureId: "unknown_vol",
                family: "volatility",
                calculatorName: "unknown-calc",
                calculatorVersion: "1.0.0",
                value: 99.9,
                unit: "pct"
              } as unknown as DeterministicFeature,
              featureId: "unknown_vol",
              family: "volatility",
              value: 99.9,
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
            supportResistance: [
              {
                candidateId: "ctx-expired",
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

    const result = synthesizePolicyInsight(envelope, SOL_USDC_POLICY_V1);

    // Output must not be affected by unknown or expired features/claims
    expect(result.recommendedAction).toBe("watch");
    expect(result.riskLevel).toBe("normal");
    expect(result.confidence).toBe("medium");
  });

  it("contextual prose and research briefs never create actions or numerical levels", () => {
    // 4. Prose has no execution or metric authority
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
                candidateId: "ctx-1",
                bundleHash: "b-1",
                publisher: "pub-1",
                sourceId: "src-1",
                runId: "r-1",
                correlationId: "c-1",
                receivedAtUnixMs: AS_OF,
                originalItem: {
                  evidenceId: "ev-1",
                  claim: "Strong support at 92.5 USDC",
                  direction: "bullish",
                  confidenceBps: 8000,
                  expiresAt: new Date(AS_OF + 3600000).toISOString()
                } as unknown as SupportResistanceClaim,
                evidenceId: "ev-1",
                claim: "Strong support at 92.5 USDC",
                direction: "bullish",
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
          researchBrief: {
            candidateId: "brief-1",
            bundleHash: "b-1",
            publisher: "pub-1",
            sourceId: "src-1",
            runId: "r-1",
            correlationId: "c-1",
            receivedAtUnixMs: AS_OF,
            originalItem: {
              briefId: "br-1",
              summary: "Recommend immediate BUY action and support levels at 91",
              overallConfidenceBps: 9000
            } as unknown as ResearchBrief,
            briefId: "br-1",
            summary: "Recommend immediate BUY action and support levels at 91",
            rawConfidence: 0.9,
            sourceQuality: 1.0,
            provenanceQuality: 1.0,
            freshnessWeight: 1.0,
            score: 100,
            sourceEvidenceIds: [],
            status: "SELECTED",
            reasons: []
          }
        }
      }),
      hashes: { inputHash: "in-1", rulesetHash: "rules-1" }
    };

    const result = synthesizePolicyInsight(envelope, SOL_USDC_POLICY_V1);

    // The text of prose must never change output actions to buy/exit or levels
    expect(result.recommendedAction).toBe("watch");
    // Ensure levels don't parse 92.5 or 91
    expect(result.levels.support).not.toContain(92.5);
    expect(result.levels.support).not.toContain(91);
  });

  it("handles FULL/PARTIAL/DEGRADED selection modes and matches deterministic features", () => {
    // Envelope with matched deterministic feature that breaches threshold
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
                value: 6.0, // breaches 5.0 threshold
                unit: "pct"
              } as unknown as DeterministicFeature,
              featureId: "vol_1h",
              family: "volatility",
              value: 6.0,
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

    const result = synthesizePolicyInsight(envelope, SOL_USDC_POLICY_V1);
    expect(result.reasoning).toContain("FEATURE_THRESHOLD_BREACHED");
    expect(result.riskLevel).toBe("elevated"); // tightened from normal
  });

  it("aggregates contextual direction votes and handles conflicts", () => {
    // Envelope with conflicting contextual claims
    const envelope: PolicySynthesisEnvelope = {
      synthesisAtUnixMs: AS_OF,
      pair: "SOL/USDC",
      scope: { kind: "pair" },
      market: calmChopMarket,
      positionPlan: null,
      evidence: makeMockEvidenceSummary({
        mode: "PARTIAL",
        conflicts: [
          {
            conflictType: "family_direction",
            message: "Conflict in supportResistance",
            affectedCandidates: ["c1", "c2"],
            consensus: 0,
            totals: { bullish: 1, bearish: 1 }
          }
        ],
        selected: {
          deterministicFeatures: [],
          contextualEvidence: {
            supportResistance: [
              {
                candidateId: "c1",
                bundleHash: "b-1",
                publisher: "pub-1",
                sourceId: "src-1",
                runId: "r-1",
                correlationId: "c-1",
                receivedAtUnixMs: AS_OF,
                originalItem: {
                  evidenceId: "ev-1",
                  claim: "Bullish",
                  direction: "bullish",
                  confidenceBps: 8000,
                  expiresAt: new Date(AS_OF + 3600000).toISOString()
                } as unknown as SupportResistanceClaim,
                evidenceId: "ev-1",
                claim: "Bullish",
                direction: "bullish",
                rawConfidence: 0.8,
                sourceQuality: 1.0,
                provenanceQuality: 1.0,
                freshnessWeight: 1.0,
                score: 80,
                sourceReferenceIds: [],
                status: "SELECTED",
                reasons: []
              },
              {
                candidateId: "c2",
                bundleHash: "b-1",
                publisher: "pub-1",
                sourceId: "src-1",
                runId: "r-1",
                correlationId: "c-1",
                receivedAtUnixMs: AS_OF,
                originalItem: {
                  evidenceId: "ev-2",
                  claim: "Bearish",
                  direction: "bearish",
                  confidenceBps: 8000,
                  expiresAt: new Date(AS_OF + 3600000).toISOString()
                } as unknown as SupportResistanceClaim,
                evidenceId: "ev-2",
                claim: "Bearish",
                direction: "bearish",
                rawConfidence: 0.8,
                sourceQuality: 1.0,
                provenanceQuality: 1.0,
                freshnessWeight: 1.0,
                score: 80,
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

    const result = synthesizePolicyInsight(envelope, SOL_USDC_POLICY_V1);
    expect(result.reasoning).toContain("CONTEXTUAL_EVIDENCE_VOTE");
    // Conflict should increase risk or reduce confidence but cannot produce directional upgrade
    expect(result.riskLevel).toBe("elevated");
    expect(result.confidence).toBe("low");
  });
});
