import { describe, expect, it } from "vitest";
import {
  synthesizePolicyInsightV1,
  type PolicySynthesisEnvelope,
  type PolicySynthesisSrThesis
} from "../synthesizePolicyInsight.js";
import { SOL_USDC_POLICY_V1 } from "../ruleset.js";
import { calmChopMarket, makeMockEvidenceSummary } from "./policyFixtures.js";
import type {
  SelectedDeterministicFeature,
  SelectedContextualClaim
} from "../../evidence/selectEvidence.js";

const AS_OF = 1762591200000;

describe("synthesizePolicyInsight - SR Theses", () => {
  it("adds valid SR thesis levels and identities without replacing evidence-derived inputs", () => {
    const srThesis1: PolicySynthesisSrThesis = {
      source: "mco",
      briefId: "mco-sol-2026-07-30",
      asset: "SOL",
      timeframe: "1d",
      bias: "bullish",
      setupType: null,
      supportLevels: ["90"],
      resistanceLevels: ["105"],
      entryZone: null,
      targets: [],
      invalidation: null,
      trigger: null,
      chartReference: null,
      sourceHandle: "morecryptoonline",
      sourceChannel: null,
      sourceKind: "youtube",
      sourceReliability: null,
      rawThesisText: null,
      collectedAt: null,
      publishedAt: null,
      sourceUrl: null,
      notes: null
    };

    const srThesis2: PolicySynthesisSrThesis = {
      ...srThesis1,
      supportLevels: ["85"],
      resistanceLevels: ["115"]
    };

    const evidence = makeMockEvidenceSummary({
      selected: {
        deterministicFeatures: [
          {
            family: "volatility",
            featureId: "realized_vol_short",
            value: 0.05,
            originalItem: {
              status: "available",
              calculator: { name: "realized_volatility", version: "1.0.0" },
              unit: "ratio"
            } as unknown as SelectedDeterministicFeature["originalItem"],
            candidateId: "feat-evidence-1"
          } as unknown as SelectedDeterministicFeature
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
    });

    const envelope: PolicySynthesisEnvelope = {
      synthesisAtUnixMs: AS_OF,
      pair: "SOL/USDC",
      scope: { kind: "pair" },
      market: calmChopMarket,
      positionPlan: null,
      evidence,
      hashes: { inputHash: "0x1", rulesetHash: "0x2" },
      srTheses: [srThesis1, srThesis2]
    };

    const result = synthesizePolicyInsightV1(envelope, SOL_USDC_POLICY_V1);

    expect(result.levels.supportsUsdcPerSol).toContain("90");
    expect(result.levels.supportsUsdcPerSol).toContain("85");
    expect(result.levels.resistancesUsdcPerSol).toContain("105");
    expect(result.levels.resistancesUsdcPerSol).toContain("115");

    const idMatches = result.reasoning
      .split(" | ")
      .filter((r) => r === "IDENTIFIER: mco-sol-2026-07-30");
    expect(idMatches).toHaveLength(1);
    expect(result.reasoning).toContain("IDENTIFIER: feat-evidence-1");
  });

  it("combines SR and evidence bias votes and treats opposition as conflict", () => {
    const bullishSrThesis: PolicySynthesisSrThesis = {
      source: "mco",
      briefId: "mco-sol-2026-07-30",
      asset: "SOL",
      timeframe: "1d",
      bias: "bullish",
      setupType: null,
      supportLevels: ["90"],
      resistanceLevels: ["110"],
      entryZone: null,
      targets: [],
      invalidation: null,
      trigger: null,
      chartReference: null,
      sourceHandle: "morecryptoonline",
      sourceChannel: null,
      sourceKind: "youtube",
      sourceReliability: null,
      rawThesisText: null,
      collectedAt: null,
      publishedAt: null,
      sourceUrl: null,
      notes: null
    };

    const bearishEvidence = makeMockEvidenceSummary({
      selected: {
        deterministicFeatures: [],
        contextualEvidence: {
          supportResistance: [
            {
              candidateId: "claim-bearish",
              direction: "bearish",
              rawConfidence: 0.8,
              summary: "bearish claim"
            } as unknown as SelectedContextualClaim
          ],
          flows: [],
          derivatives: [],
          events: [],
          newsRegulatory: []
        },
        researchBrief: null
      }
    });

    const conflictEnvelope: PolicySynthesisEnvelope = {
      synthesisAtUnixMs: AS_OF,
      pair: "SOL/USDC",
      scope: { kind: "pair" },
      market: calmChopMarket,
      positionPlan: null,
      evidence: bearishEvidence,
      hashes: { inputHash: "0x1", rulesetHash: "0x2" },
      srTheses: [bullishSrThesis]
    };

    const conflictResult = synthesizePolicyInsightV1(conflictEnvelope, SOL_USDC_POLICY_V1);
    expect(conflictResult.riskLevel).toBe("ELEVATED");
    expect(conflictResult.confidenceBps).toBe(2500);

    const emptyEvidence = makeMockEvidenceSummary();
    const alignedEnvelope: PolicySynthesisEnvelope = {
      synthesisAtUnixMs: AS_OF,
      pair: "SOL/USDC",
      scope: { kind: "pair" },
      market: calmChopMarket,
      positionPlan: null,
      evidence: emptyEvidence,
      hashes: { inputHash: "0x1", rulesetHash: "0x2" },
      srTheses: [bullishSrThesis]
    };

    const alignedResult = synthesizePolicyInsightV1(alignedEnvelope, SOL_USDC_POLICY_V1);
    expect(alignedResult.confidenceBps).toBe(7500);
  });

  it("ignores non-finite non-positive and side-ineligible SR level strings", () => {
    const invalidSrThesis: PolicySynthesisSrThesis = {
      source: "mco",
      briefId: "mco-sol-2026-07-30",
      asset: "SOL",
      timeframe: "1d",
      bias: "bullish",
      setupType: null,
      supportLevels: ["95", "90", "0", "-10", "105", "NaN", "Infinity", "not-a-number"],
      resistanceLevels: ["105", "110", "0", "-5", "95", "NaN", "Infinity", "invalid"],
      entryZone: null,
      targets: [],
      invalidation: null,
      trigger: null,
      chartReference: null,
      sourceHandle: "morecryptoonline",
      sourceChannel: null,
      sourceKind: "youtube",
      sourceReliability: null,
      rawThesisText: null,
      collectedAt: null,
      publishedAt: null,
      sourceUrl: null,
      notes: null
    };

    const envelope: PolicySynthesisEnvelope = {
      synthesisAtUnixMs: AS_OF,
      pair: "SOL/USDC",
      scope: { kind: "pair" },
      market: calmChopMarket,
      positionPlan: null,
      evidence: makeMockEvidenceSummary(),
      hashes: { inputHash: "0x1", rulesetHash: "0x2" },
      srTheses: [invalidSrThesis]
    };

    const result = synthesizePolicyInsightV1(envelope, SOL_USDC_POLICY_V1);
    expect(result.levels.supportsUsdcPerSol).toEqual(["95", "90"]);
    expect(result.levels.resistancesUsdcPerSol).toEqual(["105", "110"]);
  });

  it("deduplicates sorts and caps SR levels with existing output rules", () => {
    const manySupports = Array.from({ length: 20 }, (_, i) => `${99 - i}`);
    const srThesis: PolicySynthesisSrThesis = {
      source: "mco",
      briefId: "mco-sol-2026-07-30",
      asset: "SOL",
      timeframe: "1d",
      bias: "neutral",
      setupType: null,
      supportLevels: [...manySupports, "95.0", "95"],
      resistanceLevels: ["120", "105", "110", "105.00"],
      entryZone: null,
      targets: [],
      invalidation: null,
      trigger: null,
      chartReference: null,
      sourceHandle: "morecryptoonline",
      sourceChannel: null,
      sourceKind: "youtube",
      sourceReliability: null,
      rawThesisText: null,
      collectedAt: null,
      publishedAt: null,
      sourceUrl: null,
      notes: null
    };

    const envelope: PolicySynthesisEnvelope = {
      synthesisAtUnixMs: AS_OF,
      pair: "SOL/USDC",
      scope: { kind: "pair" },
      market: calmChopMarket,
      positionPlan: null,
      evidence: makeMockEvidenceSummary(),
      hashes: { inputHash: "0x1", rulesetHash: "0x2" },
      srTheses: [srThesis]
    };

    const result = synthesizePolicyInsightV1(envelope, SOL_USDC_POLICY_V1);
    expect(result.levels.supportsUsdcPerSol.length).toBeLessThanOrEqual(16);
    const supportsNum = result.levels.supportsUsdcPerSol.map(Number);
    expect(supportsNum).toEqual([...supportsNum].sort((a, b) => b - a));
    expect(new Set(result.levels.supportsUsdcPerSol).size).toBe(
      result.levels.supportsUsdcPerSol.length
    );

    const resistancesNum = result.levels.resistancesUsdcPerSol.map(Number);
    expect(resistancesNum).toEqual([...resistancesNum].sort((a, b) => a - b));
    expect(new Set(result.levels.resistancesUsdcPerSol).size).toBe(
      result.levels.resistancesUsdcPerSol.length
    );
    expect(result.levels.resistancesUsdcPerSol).toEqual(["105", "110", "120"]);
  });

  it("produces byte-identical output for the same canonical SR thesis input", () => {
    const srThesis: PolicySynthesisSrThesis = {
      source: "mco",
      briefId: "mco-sol-2026-07-30",
      asset: "SOL",
      timeframe: "1d",
      bias: "bullish",
      setupType: null,
      supportLevels: ["95", "90"],
      resistanceLevels: ["105", "110"],
      entryZone: null,
      targets: [],
      invalidation: null,
      trigger: null,
      chartReference: null,
      sourceHandle: "morecryptoonline",
      sourceChannel: null,
      sourceKind: "youtube",
      sourceReliability: null,
      rawThesisText: null,
      collectedAt: null,
      publishedAt: null,
      sourceUrl: null,
      notes: null
    };

    const envelope: PolicySynthesisEnvelope = {
      synthesisAtUnixMs: AS_OF,
      pair: "SOL/USDC",
      scope: { kind: "pair" },
      market: calmChopMarket,
      positionPlan: null,
      evidence: makeMockEvidenceSummary(),
      hashes: { inputHash: "0x1", rulesetHash: "0x2" },
      srTheses: [srThesis]
    };

    const res1 = JSON.stringify(synthesizePolicyInsightV1(envelope, SOL_USDC_POLICY_V1));
    const res2 = JSON.stringify(synthesizePolicyInsightV1(envelope, SOL_USDC_POLICY_V1));

    expect(res1).toBe(res2);
  });

  it("preserves legacy reducer behavior when SR theses are absent", () => {
    const baseEnvelope: PolicySynthesisEnvelope = {
      synthesisAtUnixMs: AS_OF,
      pair: "SOL/USDC",
      scope: { kind: "pair" },
      market: calmChopMarket,
      positionPlan: null,
      evidence: makeMockEvidenceSummary(),
      hashes: { inputHash: "0x1", rulesetHash: "0x2" }
    };

    const envelopeWithEmpty: PolicySynthesisEnvelope = {
      ...baseEnvelope,
      srTheses: []
    };

    const resBase = synthesizePolicyInsightV1(baseEnvelope, SOL_USDC_POLICY_V1);
    const resEmpty = synthesizePolicyInsightV1(envelopeWithEmpty, SOL_USDC_POLICY_V1);

    expect(resBase).toEqual(resEmpty);
  });
});
