import { describe, expect, it } from "vitest";
import {
  synthesizePolicyInsightV1,
  type PolicySynthesisEnvelope
} from "../synthesizePolicyInsight.js";
import { SOL_USDC_POLICY_V1 } from "../ruleset.js";
import type { Scope } from "../../../contract/evidence/v1/types.generated.js";
import {
  makeMockEvidenceSummary,
  makeMockMarketResponse,
  makeMockPosition,
  makeMockPlan
} from "./policyFixtures.js";
import type {
  DeterministicFeature,
  SupportResistanceClaim
} from "../../../contract/evidence/v1/types.generated.js";

const AS_OF = 1762591200000;

const pairScope: Scope = { kind: "pair" };
const positionScope: Scope = {
  kind: "position",
  network: "solana-mainnet",
  walletAddress: "wallet-1",
  whirlpoolAddress: "pool-1",
  positionId: "pos-1"
};

describe("synthesizePolicyInsightV1 - Content, Quality, and Reasoning", () => {
  it("maps integer deployment percentages to exact basis points and rejects invalid transitional values", () => {
    const envelope: PolicySynthesisEnvelope = {
      synthesisAtUnixMs: AS_OF,
      pair: "SOL/USDC",
      scope: positionScope,
      market: makeMockMarketResponse({ regime: "UP" }),
      positionPlan: {
        position: makeMockPosition(),
        plan: makeMockPlan({
          targets: {
            solBps: 7500,
            usdcBps: 2500,
            allowClmm: true
          }
        })
      },
      evidence: makeMockEvidenceSummary(),
      hashes: { inputHash: "in-1", rulesetHash: "rules-1" }
    };

    const result = synthesizePolicyInsightV1(envelope, SOL_USDC_POLICY_V1);

    expect(result.clmmPolicy.maxCapitalDeploymentBps).toBe(10000);
    expect(result.clmmPolicy.maxCapitalDeploymentBps).toBeGreaterThanOrEqual(0);
    expect(result.clmmPolicy.maxCapitalDeploymentBps).toBeLessThanOrEqual(10000);
  });

  it("maps low medium and high confidence to 2500 5000 and 7500 basis points", () => {
    const lowEnvelope: PolicySynthesisEnvelope = {
      synthesisAtUnixMs: AS_OF,
      pair: "SOL/USDC",
      scope: pairScope,
      market: makeMockMarketResponse({ regime: "CHOP" }),
      positionPlan: null,
      evidence: makeMockEvidenceSummary({
        selected: {
          deterministicFeatures: [],
          contextualEvidence: {
            supportResistance: [],
            flows: [],
            derivatives: [],
            events: [],
            newsRegulatory: []
          },
          researchBrief: null
        },
        conflicts: [
          {
            conflictType: "test",
            message: "conflict",
            affectedCandidates: [],
            consensus: 5000,
            totals: { bullish: 5000, bearish: 0 }
          }
        ]
      }),
      hashes: { inputHash: "in-1", rulesetHash: "rules-1" }
    };

    const lowResult = synthesizePolicyInsightV1(lowEnvelope, SOL_USDC_POLICY_V1);
    expect(lowResult.confidenceBps).toBe(2500);

    const mediumEnvelope: PolicySynthesisEnvelope = {
      synthesisAtUnixMs: AS_OF,
      pair: "SOL/USDC",
      scope: pairScope,
      market: makeMockMarketResponse({ regime: "UP" }),
      positionPlan: null,
      evidence: makeMockEvidenceSummary({
        selected: {
          deterministicFeatures: [],
          contextualEvidence: {
            supportResistance: [],
            flows: [],
            derivatives: [],
            events: [],
            newsRegulatory: []
          },
          researchBrief: null
        },
        conflicts: []
      }),
      hashes: { inputHash: "in-1", rulesetHash: "rules-1" }
    };

    const mediumResult = synthesizePolicyInsightV1(mediumEnvelope, SOL_USDC_POLICY_V1);
    expect(mediumResult.confidenceBps).toBe(5000);

    const highEnvelope: PolicySynthesisEnvelope = {
      synthesisAtUnixMs: AS_OF,
      pair: "SOL/USDC",
      scope: pairScope,
      market: makeMockMarketResponse({ regime: "UP" }),
      positionPlan: null,
      evidence: makeMockEvidenceSummary({
        selected: {
          deterministicFeatures: [],
          contextualEvidence: {
            supportResistance: [
              {
                candidateId: "sr-high",
                bundleHash: "bundle-high",
                publisher: "pub-high",
                sourceId: "src-high",
                runId: "run-high",
                correlationId: "corr-high",
                receivedAtUnixMs: AS_OF,
                originalItem: {
                  status: "available",
                  evidenceId: "sr-high",
                  claim: "strong support",
                  direction: "bullish",
                  priceLowerBound: "95.0",
                  priceUpperBound: "100.0",
                  pricePoint: "98.0",
                  provenanceMethod: "on_chain",
                  expiresAt: null,
                  observedAt: new Date(AS_OF).toISOString(),
                  inputLineage: [],
                  confidenceBps: 9000
                } as unknown as SupportResistanceClaim,
                evidenceId: "sr-high",
                claim: "strong support",
                direction: "bullish",
                rawConfidence: 9000,
                sourceQuality: 10000,
                provenanceQuality: 10000,
                freshnessWeight: 10000,
                score: 9000,
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
        },
        conflicts: []
      }),
      hashes: { inputHash: "in-1", rulesetHash: "rules-1" }
    };

    const highResult = synthesizePolicyInsightV1(highEnvelope, SOL_USDC_POLICY_V1);
    expect(highResult.confidenceBps).toBe(7500);
  });

  it("emits only selected non-audit bundle and source references in canonical tuple order", () => {
    const envelope: PolicySynthesisEnvelope = {
      synthesisAtUnixMs: AS_OF,
      pair: "SOL/USDC",
      scope: pairScope,
      market: makeMockMarketResponse({ regime: "CHOP" }),
      positionPlan: null,
      evidence: makeMockEvidenceSummary({
        sourceReferences: [
          {
            referenceId: "ref-1",
            sourceType: "api",
            locator: "https://api.example.com/price",
            observedAt: new Date(AS_OF).toISOString(),
            bundleHash: "bundle-1",
            publisher: "pub-a",
            sourceId: "src-b",
            runId: "run-c",
            correlationId: "corr-d",
            receivedAtUnixMs: AS_OF,
            isSelectedLineage: true,
            isAuditOnly: false
          },
          {
            referenceId: "ref-2",
            sourceType: "api",
            locator: "https://api.example.com/volume",
            observedAt: new Date(AS_OF).toISOString(),
            bundleHash: "bundle-2",
            publisher: "pub-a",
            sourceId: "src-b",
            runId: "run-c",
            correlationId: "corr-d",
            receivedAtUnixMs: AS_OF,
            isSelectedLineage: true,
            isAuditOnly: false
          },
          {
            referenceId: "ref-3",
            sourceType: "database",
            locator: "db://prices",
            observedAt: new Date(AS_OF).toISOString(),
            bundleHash: "bundle-3",
            publisher: "pub-a",
            sourceId: "src-b",
            runId: "run-c",
            correlationId: "corr-d",
            receivedAtUnixMs: AS_OF,
            isSelectedLineage: false,
            isAuditOnly: true
          }
        ],
        bundles: [
          {
            bundleHash: "bundle-1",
            publisher: "pub-a",
            sourceId: "src-b",
            runId: "run-c",
            correlationId: "corr-d",
            receivedAtUnixMs: AS_OF,
            status: "ACCEPTED",
            reasons: []
          },
          {
            bundleHash: "bundle-2",
            publisher: "pub-a",
            sourceId: "src-b",
            runId: "run-c",
            correlationId: "corr-d",
            receivedAtUnixMs: AS_OF,
            status: "ACCEPTED",
            reasons: []
          },
          {
            bundleHash: "bundle-3",
            publisher: "pub-a",
            sourceId: "src-b",
            runId: "run-c",
            correlationId: "corr-d",
            receivedAtUnixMs: AS_OF,
            status: "REJECTED",
            reasons: ["AUDIT_ONLY"]
          }
        ]
      }),
      hashes: { inputHash: "in-1", rulesetHash: "rules-1" }
    };

    const result = synthesizePolicyInsightV1(envelope, SOL_USDC_POLICY_V1);

    expect(result.evidence.selectedBundleRefs.length).toBe(2);
    expect(result.evidence.selectedSourceRefs.length).toBe(2);
    expect(result.evidence.selectedBundleRefs[0].bundleHash).toBe("bundle-1");
    expect(result.evidence.selectedBundleRefs[1].bundleHash).toBe("bundle-2");
  });

  it("emits descending supports and ascending resistances from eligible structured price evidence only", () => {
    const envelope: PolicySynthesisEnvelope = {
      synthesisAtUnixMs: AS_OF,
      pair: "SOL/USDC",
      scope: positionScope,
      market: makeMockMarketResponse({ regime: "CHOP" }),
      positionPlan: {
        position: makeMockPosition({
          lowerBoundPrice: 95,
          upperBoundPrice: 110,
          currentPrice: 100
        }),
        plan: makeMockPlan()
      },
      evidence: makeMockEvidenceSummary({
        selected: {
          deterministicFeatures: [],
          contextualEvidence: {
            supportResistance: [
              {
                candidateId: "sr-1",
                bundleHash: "bundle-1",
                publisher: "pub-1",
                sourceId: "src-1",
                runId: "run-1",
                correlationId: "corr-1",
                receivedAtUnixMs: AS_OF,
                originalItem: {
                  status: "available",
                  evidenceId: "sr-1",
                  claim: "support at 98",
                  direction: "bullish",
                  priceLowerBound: "97.0",
                  priceUpperBound: "99.0",
                  pricePoint: "98.0",
                  provenanceMethod: "on_chain",
                  expiresAt: null,
                  observedAt: new Date(AS_OF).toISOString(),
                  inputLineage: [],
                  confidenceBps: 8000
                } as unknown as SupportResistanceClaim,
                evidenceId: "sr-1",
                claim: "support at 98",
                direction: "bullish",
                rawConfidence: 8000,
                sourceQuality: 10000,
                provenanceQuality: 10000,
                freshnessWeight: 10000,
                score: 8000,
                sourceReferenceIds: [],
                status: "SELECTED",
                reasons: []
              },
              {
                candidateId: "sr-2",
                bundleHash: "bundle-1",
                publisher: "pub-1",
                sourceId: "src-1",
                runId: "run-1",
                correlationId: "corr-1",
                receivedAtUnixMs: AS_OF,
                originalItem: {
                  status: "available",
                  evidenceId: "sr-2",
                  claim: "resistance at 105",
                  direction: "bearish",
                  priceLowerBound: "104.0",
                  priceUpperBound: "106.0",
                  pricePoint: "105.0",
                  provenanceMethod: "on_chain",
                  expiresAt: null,
                  observedAt: new Date(AS_OF).toISOString(),
                  inputLineage: [],
                  confidenceBps: 8000
                } as unknown as SupportResistanceClaim,
                evidenceId: "sr-2",
                claim: "resistance at 105",
                direction: "bearish",
                rawConfidence: 8000,
                sourceQuality: 10000,
                provenanceQuality: 10000,
                freshnessWeight: 10000,
                score: 8000,
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

    expect(result.levels.supportsUsdcPerSol.length).toBeGreaterThan(0);
    expect(result.levels.resistancesUsdcPerSol.length).toBeGreaterThan(0);
    const supportValues = result.levels.supportsUsdcPerSol.map((s) => parseFloat(s));
    for (let i = 1; i < supportValues.length; i++) {
      expect(supportValues[i - 1]).toBeGreaterThanOrEqual(supportValues[i]);
    }
    const resistanceValues = result.levels.resistancesUsdcPerSol.map((r) => parseFloat(r));
    for (let i = 1; i < resistanceValues.length; i++) {
      expect(resistanceValues[i - 1]).toBeLessThanOrEqual(resistanceValues[i]);
    }
  });

  it("emits empty level arrays and NO_ELIGIBLE_PRICE_LEVELS instead of fallback prices", () => {
    const envelope: PolicySynthesisEnvelope = {
      synthesisAtUnixMs: AS_OF,
      pair: "SOL/USDC",
      scope: pairScope,
      market: makeMockMarketResponse({ regime: "CHOP" }),
      positionPlan: null,
      evidence: makeMockEvidenceSummary({
        selected: {
          deterministicFeatures: [],
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

    const result = synthesizePolicyInsightV1(envelope, SOL_USDC_POLICY_V1);

    expect(result.levels.supportsUsdcPerSol.length).toBe(0);
    expect(result.levels.resistancesUsdcPerSol.length).toBe(0);
    expect(result.reasonCodes).toContain("NO_ELIGIBLE_PRICE_LEVELS");
  });

  it("orders reason codes by ruleset precedence and warnings by code then message", () => {
    const envelope: PolicySynthesisEnvelope = {
      synthesisAtUnixMs: AS_OF,
      pair: "SOL/USDC",
      scope: positionScope,
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
      positionPlan: {
        position: makeMockPosition({
          rangeState: "below-range",
          breachQualified: true
        }),
        plan: makeMockPlan({
          actions: [{ type: "REQUEST_EXIT_CLMM", reasonCode: "BREACH" }]
        })
      },
      evidence: makeMockEvidenceSummary(),
      hashes: { inputHash: "in-1", rulesetHash: "rules-1" }
    };

    const result = synthesizePolicyInsightV1(envelope, SOL_USDC_POLICY_V1);

    const reasonCodeOrder = result.reasonCodes;
    const dataStaleIndex = reasonCodeOrder.indexOf("DATA_HARD_STALE");
    const breachLowerIndex = reasonCodeOrder.indexOf("CLMM_BREACH_LOWER");
    expect(dataStaleIndex).toBeLessThan(breachLowerIndex);
  });

  it("renders bounded deterministic reasoning without copying research prose", () => {
    const envelope: PolicySynthesisEnvelope = {
      synthesisAtUnixMs: AS_OF,
      pair: "SOL/USDC",
      scope: pairScope,
      market: makeMockMarketResponse({ regime: "UP" }),
      positionPlan: null,
      evidence: makeMockEvidenceSummary({
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
                value: 6.5,
                unit: "pct"
              } as unknown as DeterministicFeature,
              featureId: "vol_1h",
              family: "volatility",
              value: 6.5,
              rawConfidence: 10000,
              sourceQuality: 10000,
              provenanceQuality: 10000,
              freshnessWeight: 10000,
              score: 10000,
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

    const result = synthesizePolicyInsightV1(envelope, SOL_USDC_POLICY_V1);

    expect(result.reasoning.length).toBeLessThanOrEqual(1024);
    expect(result.reasonCodes).toContain("FEATURE_THRESHOLD_BREACHED");
  });

  it("maps worst authoritative quality to STALE PARTIAL or COMPLETE", () => {
    const hardStaleEnvelope: PolicySynthesisEnvelope = {
      synthesisAtUnixMs: AS_OF,
      pair: "SOL/USDC",
      scope: pairScope,
      market: makeMockMarketResponse({
        regime: "CHOP",
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
      evidence: makeMockEvidenceSummary(),
      hashes: { inputHash: "in-1", rulesetHash: "rules-1" }
    };

    const hardStaleResult = synthesizePolicyInsightV1(hardStaleEnvelope, SOL_USDC_POLICY_V1);
    expect(hardStaleResult.dataQuality).toBe("STALE");

    const partialEnvelope: PolicySynthesisEnvelope = {
      synthesisAtUnixMs: AS_OF,
      pair: "SOL/USDC",
      scope: pairScope,
      market: makeMockMarketResponse({
        regime: "CHOP",
        clmmSuitability: {
          status: "UNKNOWN",
          reasons: [
            { code: "INSUFFICIENT_SAMPLES", severity: "WARN", message: "Insufficient samples" }
          ]
        }
      }),
      positionPlan: null,
      evidence: makeMockEvidenceSummary(),
      hashes: { inputHash: "in-1", rulesetHash: "rules-1" }
    };

    const partialResult = synthesizePolicyInsightV1(partialEnvelope, SOL_USDC_POLICY_V1);
    expect(partialResult.dataQuality).toBe("PARTIAL");

    const completeEnvelope: PolicySynthesisEnvelope = {
      synthesisAtUnixMs: AS_OF,
      pair: "SOL/USDC",
      scope: pairScope,
      market: makeMockMarketResponse({ regime: "CHOP" }),
      positionPlan: null,
      evidence: makeMockEvidenceSummary(),
      hashes: { inputHash: "in-1", rulesetHash: "rules-1" }
    };

    const completeResult = synthesizePolicyInsightV1(completeEnvelope, SOL_USDC_POLICY_V1);
    expect(completeResult.dataQuality).toBe("COMPLETE");
  });
});
