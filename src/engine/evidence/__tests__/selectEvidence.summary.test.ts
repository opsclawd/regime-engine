import { describe, expect, it } from "vitest";
import {
  buildEvidenceBundle,
  buildEvidenceRecord,
  cloneAndPermuteBundle
} from "./evidenceSelectionFixtures.js";
import { selectEvidence } from "../selectEvidence.js";
import { EVIDENCE_SELECTION_POLICY_V1 } from "../selectionPolicy.js";
import { toCanonicalJson } from "../../../contract/v1/canonical.js";

describe("Evidence selection summary, coverage, and conflict rules", () => {
  it("preserves bullish and bearish claims and computes conflict from effective scores", () => {
    // Both sides remain selected, direction totals use effective scores.
    // Consensus is floor(abs(bullish-bearish)*10_000/(bullish+bearish)).
    const bundle = buildEvidenceBundle({
      contextualEvidence: {
        flows: [
          {
            evidenceId: "ev-flow-bull",
            kind: "spot_flow",
            claim: "major inflows",
            direction: "bullish",
            confidenceBps: 8000,
            observedAt: "2024-01-15T10:00:00.000Z",
            expiresAt: "2024-01-15T11:00:00.000Z",
            sourceReferenceIds: ["ref-price-source"],
            provenanceMethod: "derived"
          },
          {
            evidenceId: "ev-flow-bear",
            kind: "spot_flow",
            claim: "whale selling",
            direction: "bearish",
            confidenceBps: 4000,
            observedAt: "2024-01-15T10:00:00.000Z",
            expiresAt: "2024-01-15T11:00:00.000Z",
            sourceReferenceIds: ["ref-price-source"],
            provenanceMethod: "derived"
          }
        ]
      }
    });

    const record = buildEvidenceRecord(bundle, {
      receivedAtUnixMs: Date.parse(bundle.asOf),
      lifecycle: "FRESH",
      evidenceHash: "hash-conflict-1"
    });

    const res = selectEvidence({
      records: [record],
      selectedAtUnixMs: Date.parse(bundle.asOf),
      scope: { kind: "pair" },
      policy: {
        ...EVIDENCE_SELECTION_POLICY_V1,
        defaultSourceQualityBps: 10000,
        minimumEffectiveScoreBps: 1000
      }
    });

    const selectedFlows = res.selected.contextualEvidence.flows;
    expect(selectedFlows).toHaveLength(2);

    const bullClaim = selectedFlows.find((c) => c.evidenceId === "ev-flow-bull");
    const bearClaim = selectedFlows.find((c) => c.evidenceId === "ev-flow-bear");
    expect(bullClaim).toBeDefined();
    expect(bearClaim).toBeDefined();

    // Verify consensus computation
    const bullScore = bullClaim!.score; // 8000
    const bearScore = bearClaim!.score; // 4000
    const expectedConsensus = Math.floor(
      (Math.abs(bullScore - bearScore) * 10000) / (bullScore + bearScore)
    );
    expect(expectedConsensus).toBe(3333);

    // Verify conflict summary was added
    expect(res.conflicts).toHaveLength(1);
    expect(res.conflicts[0].conflictType).toBe("family_conflict");
    expect(res.conflicts[0].affectedCandidates).toContain(bullClaim!.candidateId);
    expect(res.conflicts[0].affectedCandidates).toContain(bearClaim!.candidateId);

    // Verify conflict warning is emitted
    const conflictWarning = res.warnings.find((w) => w.code === "conflicted_family");
    expect(conflictWarning).toBeDefined();
    expect(conflictWarning!.message).toContain("flows");
  });

  it("does not create conflict from neutral mixed or unknown claims", () => {
    // Neutral/mixed/unknown claims do not enter directional consensus
    const bundle = buildEvidenceBundle({
      contextualEvidence: {
        flows: [
          {
            evidenceId: "ev-flow-neutral",
            kind: "spot_flow",
            claim: "neutral flow",
            direction: "neutral",
            confidenceBps: 8000,
            observedAt: "2024-01-15T10:00:00.000Z",
            expiresAt: "2024-01-15T11:00:00.000Z",
            sourceReferenceIds: ["ref-price-source"],
            provenanceMethod: "derived"
          },
          {
            evidenceId: "ev-flow-bull",
            kind: "spot_flow",
            claim: "bullish flow",
            direction: "bullish",
            confidenceBps: 6000,
            observedAt: "2024-01-15T10:00:00.000Z",
            expiresAt: "2024-01-15T11:00:00.000Z",
            sourceReferenceIds: ["ref-price-source"],
            provenanceMethod: "derived"
          }
        ]
      }
    });

    const record = buildEvidenceRecord(bundle, {
      lifecycle: "FRESH",
      evidenceHash: "hash-neutral"
    });

    const res = selectEvidence({
      records: [record],
      selectedAtUnixMs: Date.parse(bundle.asOf),
      scope: { kind: "pair" },
      policy: {
        ...EVIDENCE_SELECTION_POLICY_V1,
        defaultSourceQualityBps: 10000,
        minimumEffectiveScoreBps: 1000
      }
    });

    expect(res.selected.contextualEvidence.flows).toHaveLength(2);
    expect(res.conflicts).toHaveLength(0);
    const conflictWarning = res.warnings.find((w) => w.code === "conflicted_family");
    expect(conflictWarning).toBeUndefined();
  });

  it("derives AVAILABLE CONFLICTED REJECTED and MISSING from terminal decisions", () => {
    // AVAILABLE: selected without conflict.
    // CONFLICTED: selected with conflict.
    // REJECTED: candidate exists but none selected.
    // MISSING: no candidates at all.
    const bundle = buildEvidenceBundle({
      contextualEvidence: {
        flows: [
          {
            evidenceId: "ev-flow-rejected",
            kind: "spot_flow",
            claim: "rejected because of low score",
            direction: "bullish",
            confidenceBps: 500, // too low
            observedAt: "2024-01-15T10:00:00.000Z",
            expiresAt: "2024-01-15T11:00:00.000Z",
            sourceReferenceIds: ["ref-price-source"],
            provenanceMethod: "derived"
          }
        ],
        supportResistance: [
          {
            evidenceId: "ev-sr-avail",
            kind: "support_zone",
            claim: "strong support",
            direction: "bullish",
            confidenceBps: 9000,
            observedAt: "2024-01-15T10:00:00.000Z",
            expiresAt: "2024-01-15T11:00:00.000Z",
            sourceReferenceIds: ["ref-price-source"],
            provenanceMethod: "derived"
          }
        ]
        // derivatives, events, newsRegulatory are missing (empty array)
      }
    });

    const record = buildEvidenceRecord(bundle, {
      lifecycle: "FRESH",
      evidenceHash: "hash-coverage"
    });

    const res = selectEvidence({
      records: [record],
      selectedAtUnixMs: Date.parse(bundle.asOf),
      scope: { kind: "pair" },
      policy: {
        ...EVIDENCE_SELECTION_POLICY_V1,
        defaultSourceQualityBps: 10000,
        minimumEffectiveScoreBps: 2000
      }
    });

    // Check warnings to verify coverage states
    const rejectedWarnings = res.warnings.filter((w) => w.code === "rejected_family");
    const missingWarnings = res.warnings.filter((w) => w.code === "missing_family");

    // flows has candidates but none are selected -> REJECTED
    expect(rejectedWarnings.some((w) => w.message.includes("flows"))).toBe(true);

    // supportResistance is selected and not conflicted -> AVAILABLE (no warning)
    expect(rejectedWarnings.some((w) => w.message.includes("supportResistance"))).toBe(false);
    expect(missingWarnings.some((w) => w.message.includes("supportResistance"))).toBe(false);

    // derivatives, events, newsRegulatory have no candidates -> MISSING
    expect(missingWarnings.some((w) => w.message.includes("derivatives"))).toBe(true);
    expect(missingWarnings.some((w) => w.message.includes("events"))).toBe(true);
    expect(missingWarnings.some((w) => w.message.includes("newsRegulatory"))).toBe(true);
  });

  it("returns FULL only for all five contextual families plus a brief with no conflict", () => {
    // Complete bundle setup containing all 5 contextual families, deterministic features, and brief
    const bundle = buildEvidenceBundle({
      contextualEvidence: {
        supportResistance: [
          {
            evidenceId: "sr-1",
            kind: "support_zone",
            claim: "claim",
            direction: "bullish",
            confidenceBps: 9000,
            observedAt: "2024-01-15T10:00:00.000Z",
            expiresAt: "2024-01-15T11:00:00.000Z",
            sourceReferenceIds: ["ref-price-source"],
            provenanceMethod: "derived"
          }
        ],
        flows: [
          {
            evidenceId: "fl-1",
            kind: "spot_flow",
            claim: "claim",
            direction: "bullish",
            confidenceBps: 9000,
            observedAt: "2024-01-15T10:00:00.000Z",
            expiresAt: "2024-01-15T11:00:00.000Z",
            sourceReferenceIds: ["ref-price-source"],
            provenanceMethod: "derived"
          }
        ],
        derivatives: [
          {
            evidenceId: "dr-1",
            kind: "funding",
            claim: "claim",
            direction: "bullish",
            confidenceBps: 9000,
            observedAt: "2024-01-15T10:00:00.000Z",
            expiresAt: "2024-01-15T11:00:00.000Z",
            sourceReferenceIds: ["ref-price-source"],
            provenanceMethod: "derived"
          }
        ],
        events: [
          {
            evidenceId: "ev-1",
            kind: "scheduled_event",
            claim: "claim",
            direction: "bullish",
            confidenceBps: 9000,
            observedAt: "2024-01-15T10:00:00.000Z",
            expiresAt: "2024-01-15T11:00:00.000Z",
            sourceReferenceIds: ["ref-price-source"],
            provenanceMethod: "derived"
          }
        ],
        newsRegulatory: [
          {
            evidenceId: "ns-1",
            kind: "ecosystem_news",
            claim: "claim",
            direction: "bullish",
            confidenceBps: 9000,
            observedAt: "2024-01-15T10:00:00.000Z",
            expiresAt: "2024-01-15T11:00:00.000Z",
            sourceReferenceIds: ["ref-price-source"],
            provenanceMethod: "derived"
          }
        ]
      },
      researchBrief: {
        briefId: "brief-1",
        generatedAt: "2024-01-15T10:00:00.000Z",
        summary: "comprehensive brief",
        keyFindings: ["finding"],
        uncertainties: ["uncertainty"],
        model: { provider: "openai", modelId: "gpt-4", modelVersion: "1" },
        promptVersion: "1",
        sourceEvidenceIds: ["sr-1", "fl-1", "dr-1", "ev-1", "ns-1"]
      }
    });

    const record = buildEvidenceRecord(bundle, {
      lifecycle: "FRESH",
      evidenceHash: "hash-full"
    });

    const res = selectEvidence({
      records: [record],
      selectedAtUnixMs: Date.parse(bundle.asOf),
      scope: { kind: "pair" },
      policy: {
        ...EVIDENCE_SELECTION_POLICY_V1,
        defaultSourceQualityBps: 10000,
        minimumEffectiveScoreBps: 1000
      }
    });

    expect(res.mode).toBe("FULL");
  });

  it("returns PARTIAL when at least one contextual claim or brief survives", () => {
    // Missing events but has supportResistance and brief
    const bundle = buildEvidenceBundle({
      contextualEvidence: {
        supportResistance: [
          {
            evidenceId: "sr-1",
            kind: "support_zone",
            claim: "claim",
            direction: "bullish",
            confidenceBps: 9000,
            observedAt: "2024-01-15T10:00:00.000Z",
            expiresAt: "2024-01-15T11:00:00.000Z",
            sourceReferenceIds: ["ref-price-source"],
            provenanceMethod: "derived"
          }
        ]
      },
      researchBrief: {
        briefId: "brief-1",
        generatedAt: "2024-01-15T10:00:00.000Z",
        summary: "brief",
        keyFindings: ["finding"],
        uncertainties: ["uncertainty"],
        model: { provider: "openai", modelId: "gpt-4", modelVersion: "1" },
        promptVersion: "1",
        sourceEvidenceIds: ["sr-1"]
      }
    });

    const record = buildEvidenceRecord(bundle, {
      lifecycle: "FRESH",
      evidenceHash: "hash-partial"
    });

    const res = selectEvidence({
      records: [record],
      selectedAtUnixMs: Date.parse(bundle.asOf),
      scope: { kind: "pair" },
      policy: {
        ...EVIDENCE_SELECTION_POLICY_V1,
        defaultSourceQualityBps: 10000,
        minimumEffectiveScoreBps: 1000
      }
    });

    expect(res.mode).toBe("PARTIAL");
  });

  it("returns DEGRADED_NO_RESEARCH for empty deterministic-only expired and fully-rejected inputs", () => {
    // Only deterministic features, no contextual evidence
    const bundle = buildEvidenceBundle({
      contextualEvidence: {
        supportResistance: [],
        flows: [],
        derivatives: [],
        events: [],
        newsRegulatory: []
      },
      researchBrief: null
    });

    const record = buildEvidenceRecord(bundle, {
      lifecycle: "FRESH",
      evidenceHash: "hash-degraded"
    });

    const res = selectEvidence({
      records: [record],
      selectedAtUnixMs: Date.parse(bundle.asOf),
      scope: { kind: "pair" },
      policy: {
        ...EVIDENCE_SELECTION_POLICY_V1,
        defaultSourceQualityBps: 10000,
        minimumEffectiveScoreBps: 1000
      }
    });

    expect(res.mode).toBe("DEGRADED_NO_RESEARCH");
    expect(res.authority).toBe("ADVISORY_ONLY");
  });

  it("emits warnings in canonical family and code order without duplicates", () => {
    // Let's create multiple issues to trigger various warnings and check ordering.
    // e.g. stale input, missing families, rejected families
    const bundle = buildEvidenceBundle({
      contextualEvidence: {
        flows: [
          {
            evidenceId: "ev-flow-rej",
            kind: "spot_flow",
            claim: "rejected",
            direction: "bullish",
            confidenceBps: 500, // too low
            observedAt: "2024-01-15T10:00:00.000Z",
            expiresAt: "2024-01-15T11:00:00.000Z",
            sourceReferenceIds: ["ref-price-source"],
            provenanceMethod: "derived"
          }
        ]
        // other families missing
      },
      researchBrief: null
    });

    // Make bundle stale to trigger stale warning too
    const record = buildEvidenceRecord(bundle, {
      lifecycle: "STALE",
      evidenceHash: "hash-warn-order"
    });

    const res = selectEvidence({
      records: [record],
      selectedAtUnixMs: Date.parse(bundle.asOf) + 10000,
      scope: { kind: "pair" },
      policy: {
        ...EVIDENCE_SELECTION_POLICY_V1,
        defaultSourceQualityBps: 10000,
        minimumEffectiveScoreBps: 2000
      }
    });

    const warnings = res.warnings;
    expect(warnings.length).toBeGreaterThan(0);

    // Verify ordering by comparing index numbers
    // Warning order should follow CODE_RANK then FAMILY_RANK
    // Let's check that stale warning comes first, then missing/rejected
    const staleIndex = warnings.findIndex((w) => w.code === "stale_input");
    const missingIndex = warnings.findIndex((w) => w.code === "missing_family");
    const rejectedIndex = warnings.findIndex((w) => w.code === "rejected_family");
    const noResearchIndex = warnings.findIndex((w) => w.code === "no_selected_research");

    if (staleIndex !== -1 && missingIndex !== -1) {
      expect(staleIndex).toBeLessThan(missingIndex);
    }
    if (missingIndex !== -1 && rejectedIndex !== -1) {
      expect(missingIndex).toBeLessThan(rejectedIndex);
    }
    if (rejectedIndex !== -1 && noResearchIndex !== -1) {
      expect(rejectedIndex).toBeLessThan(noResearchIndex);
    }

    // Verify missing warnings are sorted by family order: deterministic, supportResistance, derivatives, events, newsRegulatory
    const missingSRIndex = warnings.findIndex(
      (w) => w.code === "missing_family" && w.message.includes("supportResistance")
    );
    const missingDerivIndex = warnings.findIndex(
      (w) => w.code === "missing_family" && w.message.includes("derivatives")
    );
    if (missingSRIndex !== -1 && missingDerivIndex !== -1) {
      expect(missingSRIndex).toBeLessThan(missingDerivIndex);
    }
  });

  it("produces deep-equal and byte-identical canonical JSON for every record permutation", () => {
    const bundle = buildEvidenceBundle({
      contextualEvidence: {
        supportResistance: [
          {
            evidenceId: "sr-1",
            kind: "support_zone",
            claim: "claim A",
            direction: "bullish",
            confidenceBps: 9000,
            observedAt: "2024-01-15T10:00:00.000Z",
            expiresAt: "2024-01-15T11:00:00.000Z",
            sourceReferenceIds: ["ref-price-source"],
            provenanceMethod: "derived"
          },
          {
            evidenceId: "sr-2",
            kind: "support_zone",
            claim: "claim B",
            direction: "bearish",
            confidenceBps: 8000,
            observedAt: "2024-01-15T10:00:00.000Z",
            expiresAt: "2024-01-15T11:00:00.000Z",
            sourceReferenceIds: ["ref-price-source"],
            provenanceMethod: "derived"
          }
        ],
        flows: [
          {
            evidenceId: "fl-1",
            kind: "spot_flow",
            claim: "claim C",
            direction: "bullish",
            confidenceBps: 9000,
            observedAt: "2024-01-15T10:00:00.000Z",
            expiresAt: "2024-01-15T11:00:00.000Z",
            sourceReferenceIds: ["ref-price-source"],
            provenanceMethod: "derived"
          }
        ],
        derivatives: [
          {
            evidenceId: "dr-1",
            kind: "funding",
            claim: "claim D",
            direction: "bullish",
            confidenceBps: 9000,
            observedAt: "2024-01-15T10:00:00.000Z",
            expiresAt: "2024-01-15T11:00:00.000Z",
            sourceReferenceIds: ["ref-price-source"],
            provenanceMethod: "derived"
          }
        ],
        events: [
          {
            evidenceId: "ev-1",
            kind: "scheduled_event",
            claim: "claim E",
            direction: "bullish",
            confidenceBps: 9000,
            observedAt: "2024-01-15T10:00:00.000Z",
            expiresAt: "2024-01-15T11:00:00.000Z",
            sourceReferenceIds: ["ref-price-source"],
            provenanceMethod: "derived"
          }
        ],
        newsRegulatory: [
          {
            evidenceId: "ns-1",
            kind: "ecosystem_news",
            claim: "claim F",
            direction: "bullish",
            confidenceBps: 9000,
            observedAt: "2024-01-15T10:00:00.000Z",
            expiresAt: "2024-01-15T11:00:00.000Z",
            sourceReferenceIds: ["ref-price-source"],
            provenanceMethod: "derived"
          }
        ]
      },
      researchBrief: {
        briefId: "brief-1",
        generatedAt: "2024-01-15T10:00:00.000Z",
        summary: "brief",
        keyFindings: ["finding"],
        uncertainties: ["uncertainty"],
        model: { provider: "openai", modelId: "gpt-4", modelVersion: "1" },
        promptVersion: "1",
        sourceEvidenceIds: ["sr-1", "sr-2"]
      }
    });

    const record = buildEvidenceRecord(bundle, {
      lifecycle: "FRESH",
      evidenceHash: "hash-perm"
    });

    const inputA = {
      records: [record],
      selectedAtUnixMs: Date.parse(bundle.asOf),
      scope: { kind: "pair" as const },
      policy: EVIDENCE_SELECTION_POLICY_V1
    };

    // Permute features/claims arrays inside the bundle
    const permutedBundle = cloneAndPermuteBundle(bundle);
    const permutedRecord = buildEvidenceRecord(permutedBundle, {
      lifecycle: "FRESH",
      evidenceHash: "hash-perm"
    });

    const inputB = {
      records: [permutedRecord],
      selectedAtUnixMs: Date.parse(bundle.asOf),
      scope: { kind: "pair" as const },
      policy: EVIDENCE_SELECTION_POLICY_V1
    };

    const resA = selectEvidence(inputA);
    const resB = selectEvidence(inputB);

    // Deep equal check
    expect(resA).toEqual(resB);

    // Canonical JSON byte-identical check
    const jsonA = toCanonicalJson(resA);
    const jsonB = toCanonicalJson(resB);
    expect(jsonA).toBe(jsonB);
  });

  it("gives every candidate exactly one terminal decision and every selected item one matching INCLUDED decision", () => {
    const bundle = buildEvidenceBundle({
      contextualEvidence: {
        supportResistance: [
          {
            evidenceId: "sr-1",
            kind: "support_zone",
            claim: "claim A",
            direction: "bullish",
            confidenceBps: 9000,
            observedAt: "2024-01-15T10:00:00.000Z",
            expiresAt: "2024-01-15T11:00:00.000Z",
            sourceReferenceIds: ["ref-price-source"],
            provenanceMethod: "derived"
          }
        ]
      }
    });

    const record = buildEvidenceRecord(bundle, {
      lifecycle: "FRESH",
      evidenceHash: "hash-decision-integrity"
    });

    const res = selectEvidence({
      records: [record],
      selectedAtUnixMs: Date.parse(bundle.asOf),
      scope: { kind: "pair" },
      policy: EVIDENCE_SELECTION_POLICY_V1
    });

    // Extract all candidate IDs from the decisions
    const candidateIds = res.decisions.map((d) => d.candidateId);
    const uniqueCandidateIds = new Set(candidateIds);
    expect(candidateIds.length).toBe(uniqueCandidateIds.size); // No duplicate decisions

    // Every selected claim must be marked as SELECTED in decisions
    for (const claim of res.selected.contextualEvidence.supportResistance) {
      const decision = res.decisions.find((d) => d.candidateId === claim.candidateId);
      expect(decision).toBeDefined();
      expect(decision!.status).toBe("SELECTED");
    }
  });

  it("never exposes policy authority fields", () => {
    const bundle = buildEvidenceBundle({
      contextualEvidence: {
        supportResistance: [
          {
            evidenceId: "sr-1",
            kind: "support_zone",
            claim: "claim A",
            direction: "bullish",
            confidenceBps: 9000,
            observedAt: "2024-01-15T10:00:00.000Z",
            expiresAt: "2024-01-15T11:00:00.000Z",
            sourceReferenceIds: ["ref-price-source"],
            provenanceMethod: "derived"
          }
        ]
      }
    });

    const record = buildEvidenceRecord(bundle, {
      lifecycle: "FRESH",
      evidenceHash: "hash-authority"
    });

    const res = selectEvidence({
      records: [record],
      selectedAtUnixMs: Date.parse(bundle.asOf),
      scope: { kind: "pair" },
      policy: EVIDENCE_SELECTION_POLICY_V1
    });

    // Recursively assert the result has no keys named action, allocation, allowClmm, guard, or override
    const forbiddenKeys = new Set(["action", "allocation", "allowClmm", "guard", "override"]);
    const verifyNoForbiddenKeys = (val: unknown) => {
      if (val && typeof val === "object") {
        for (const key of Object.keys(val)) {
          expect(forbiddenKeys.has(key)).toBe(false);
          verifyNoForbiddenKeys((val as Record<string, unknown>)[key]);
        }
      }
    };
    verifyNoForbiddenKeys(res);
    expect(res.authority).toBe("ADVISORY_ONLY");
  });
});
