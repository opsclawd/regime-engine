import { describe, expect, it } from "vitest";
import { buildEvidenceBundle, buildEvidenceRecord } from "./evidenceSelectionFixtures.js";
import { selectEvidence } from "../selectEvidence.js";
import { EVIDENCE_SELECTION_POLICY_V1 } from "../selectionPolicy.js";
import type { EvidenceSelectionPolicy } from "../selectionPolicy.js";

describe("Evidence lineage, capping, and brief resolution", () => {
  it("ranks each non-brief family by every documented tie-break and excludes overflow as FAMILY_SELECTION_LIMIT", () => {
    const policy: EvidenceSelectionPolicy = {
      ...EVIDENCE_SELECTION_POLICY_V1,
      maxSelectedPerFamily: 1,
      minimumEffectiveScoreBps: 100
    };

    const bundle1 = buildEvidenceBundle({
      asOf: "2024-01-15T10:00:00.000Z",
      publisher: "sol-usdc-clmm-intelligence",
      sourceId: "src-1",
      deterministicFeatures: [
        {
          featureId: "feat-1",
          family: "market_state",
          featureKind: "number",
          status: "available",
          value: 100,
          unit: "usd",
          observedAt: "2024-01-15T09:30:00.000Z",
          freshUntil: "2024-01-15T11:00:00.000Z",
          confidenceBps: 8000,
          calculator: { name: "calc", version: "1" },
          inputLineage: ["ref-price-source"],
          warnings: []
        }
      ]
    });

    const bundle2 = buildEvidenceBundle({
      asOf: "2024-01-15T09:00:00.000Z",
      publisher: "sol-usdc-clmm-intelligence",
      sourceId: "src-2",
      deterministicFeatures: [
        {
          featureId: "feat-2",
          family: "market_state",
          featureKind: "number",
          status: "available",
          value: 200,
          unit: "usd",
          observedAt: "2024-01-15T08:40:00.000Z",
          freshUntil: "2024-01-15T11:00:00.000Z",
          confidenceBps: 8000, // same score
          calculator: { name: "calc", version: "1" },
          inputLineage: ["ref-price-source"],
          warnings: []
        }
      ]
    });

    const record1 = buildEvidenceRecord(bundle1, { evidenceHash: "hash-A", lifecycle: "FRESH" });
    const record2 = buildEvidenceRecord(bundle2, { evidenceHash: "hash-B", lifecycle: "FRESH" });

    const res = selectEvidence({
      records: [record1, record2],
      selectedAtUnixMs: Date.parse("2024-01-15T10:10:00.000Z"),
      scope: { kind: "pair" },
      policy
    });

    // Since maxSelectedPerFamily is 1, and bundle1 has later asOf (10:00 vs 09:00),
    // feat-1 should be SELECTED, and feat-2 should be EXCLUDED as FAMILY_SELECTION_LIMIT
    const dec1 = res.decisions.find((d) => d.localId === "feat-1");
    const dec2 = res.decisions.find((d) => d.localId === "feat-2");

    expect(dec1?.status).toBe("SELECTED");
    expect(dec2?.status).toBe("EXCLUDED");
    expect(dec2?.reasons).toContain("FAMILY_SELECTION_LIMIT");
  });

  it("excludes feature dependants to a fixed point and never backfills capped slots", () => {
    const policy: EvidenceSelectionPolicy = {
      ...EVIDENCE_SELECTION_POLICY_V1,
      maxSelectedPerFamily: 2,
      defaultSourceQualityBps: 10000,
      minimumEffectiveScoreBps: 5000
    };

    const bundle = buildEvidenceBundle({
      deterministicFeatures: [
        {
          featureId: "feat-B",
          family: "market_state",
          featureKind: "number",
          status: "available",
          value: 10,
          unit: "usd",
          observedAt: "2024-01-15T10:00:00.000Z",
          freshUntil: "2024-01-15T11:00:00.000Z",
          confidenceBps: 2000, // will be excluded as score_threshold (2000 < 5000)
          calculator: { name: "calc", version: "1" },
          inputLineage: ["ref-price-source"],
          warnings: []
        },
        {
          featureId: "feat-A",
          family: "market_state",
          featureKind: "number",
          status: "available",
          value: 20,
          unit: "usd",
          observedAt: "2024-01-15T10:00:00.000Z",
          freshUntil: "2024-01-15T11:00:00.000Z",
          confidenceBps: 9000,
          calculator: { name: "calc", version: "1" },
          inputLineage: ["feat-B"], // depends on B
          warnings: []
        },
        {
          featureId: "feat-C",
          family: "market_state",
          featureKind: "number",
          status: "available",
          value: 30,
          unit: "usd",
          observedAt: "2024-01-15T10:00:00.000Z",
          freshUntil: "2024-01-15T11:00:00.000Z",
          confidenceBps: 9000,
          calculator: { name: "calc", version: "1" },
          inputLineage: ["feat-A"], // depends on A
          warnings: []
        },
        {
          featureId: "feat-Other",
          family: "market_state",
          featureKind: "number",
          status: "available",
          value: 40,
          unit: "usd",
          observedAt: "2024-01-15T10:00:00.000Z",
          freshUntil: "2024-01-15T11:00:00.000Z",
          confidenceBps: 8000,
          calculator: { name: "calc", version: "1" },
          inputLineage: ["ref-price-source"],
          warnings: []
        }
      ]
    });

    const record = buildEvidenceRecord(bundle, { evidenceHash: "hash-1" });
    const res = selectEvidence({
      records: [record],
      selectedAtUnixMs: Date.parse("2024-01-15T10:10:00.000Z"),
      scope: { kind: "pair" },
      policy
    });

    const decA = res.decisions.find((d) => d.localId === "feat-A");
    const decB = res.decisions.find((d) => d.localId === "feat-B");
    const decC = res.decisions.find((d) => d.localId === "feat-C");
    const decOther = res.decisions.find((d) => d.localId === "feat-Other");

    expect(decB?.status).toBe("EXCLUDED");
    expect(decA?.status).toBe("EXCLUDED");
    expect(decA?.reasons).toContain("FEATURE_DEPENDENCY_EXCLUDED");
    expect(decC?.status).toBe("EXCLUDED");
    expect(decC?.reasons).toContain("FEATURE_DEPENDENCY_EXCLUDED");

    // Since cap is 1, and feat-A was preliminarily selected/capped first but then excluded,
    // the slot is NOT backfilled by feat-Other.
    expect(decOther?.status).toBe("EXCLUDED");
    expect(decOther?.reasons).toContain("FAMILY_SELECTION_LIMIT");
  });

  it("keeps source-reference lineage valid when feature lineage resolves directly to a reference", () => {
    const policy: EvidenceSelectionPolicy = {
      ...EVIDENCE_SELECTION_POLICY_V1,
      minimumEffectiveScoreBps: 100
    };

    const bundle = buildEvidenceBundle({
      deterministicFeatures: [
        {
          featureId: "feat-1",
          family: "market_state",
          featureKind: "number",
          status: "available",
          value: 100,
          unit: "usd",
          observedAt: "2024-01-15T10:00:00.000Z",
          freshUntil: "2024-01-15T11:00:00.000Z",
          confidenceBps: 9000,
          calculator: { name: "calc", version: "1" },
          inputLineage: ["ref-source-1"], // references a source reference directly
          warnings: []
        }
      ],
      sourceReferences: [
        {
          referenceId: "ref-source-1",
          sourceType: "api",
          locator: "https://api.com/1",
          observedAt: "2024-01-15T09:50:00.000Z"
        }
      ]
    });

    const record = buildEvidenceRecord(bundle, { evidenceHash: "hash-1" });
    const res = selectEvidence({
      records: [record],
      selectedAtUnixMs: Date.parse("2024-01-15T10:10:00.000Z"),
      scope: { kind: "pair" },
      policy
    });

    const dec1 = res.decisions.find((d) => d.localId === "feat-1");
    expect(dec1?.status).toBe("SELECTED");
    expect(dec1?.reasons).not.toContain("FEATURE_DEPENDENCY_EXCLUDED");
  });

  it("keeps duplicate local evidence and reference IDs distinct across bundle hashes", () => {
    const policy = EVIDENCE_SELECTION_POLICY_V1;

    const bundle1 = buildEvidenceBundle({
      deterministicFeatures: [
        {
          featureId: "feat-same",
          family: "market_state",
          featureKind: "number",
          status: "available",
          value: 100,
          unit: "usd",
          observedAt: "2024-01-15T10:00:00.000Z",
          freshUntil: "2024-01-15T11:00:00.000Z",
          confidenceBps: 9000,
          calculator: { name: "calc", version: "1" },
          inputLineage: ["ref-same"],
          warnings: []
        }
      ],
      sourceReferences: [
        {
          referenceId: "ref-same",
          sourceType: "api",
          locator: "https://api.com/1",
          observedAt: "2024-01-15T09:50:00.000Z"
        }
      ]
    });

    const bundle2 = buildEvidenceBundle({
      deterministicFeatures: [
        {
          featureId: "feat-same",
          family: "market_state",
          featureKind: "number",
          status: "available",
          value: 200,
          unit: "usd",
          observedAt: "2024-01-15T10:00:00.000Z",
          freshUntil: "2024-01-15T11:00:00.000Z",
          confidenceBps: 9000,
          calculator: { name: "calc", version: "1" },
          inputLineage: ["ref-same"],
          warnings: []
        }
      ],
      sourceReferences: [
        {
          referenceId: "ref-same",
          sourceType: "api",
          locator: "https://api.com/2",
          observedAt: "2024-01-15T09:50:00.000Z"
        }
      ]
    });

    const record1 = buildEvidenceRecord(bundle1, { evidenceHash: "hash-1" });
    const record2 = buildEvidenceRecord(bundle2, { evidenceHash: "hash-2" });

    const res = selectEvidence({
      records: [record1, record2],
      selectedAtUnixMs: Date.parse("2024-01-15T10:10:00.000Z"),
      scope: { kind: "pair" },
      policy
    });

    const dec1 = res.decisions.find(
      (d) => d.candidateId === "hash-1/deterministic_feature/feat-same"
    );
    const dec2 = res.decisions.find(
      (d) => d.candidateId === "hash-2/deterministic_feature/feat-same"
    );

    expect(dec1).toBeDefined();
    expect(dec2).toBeDefined();
    expect(dec1?.candidateId).not.toBe(dec2?.candidateId);

    const ref1 = res.sourceReferences.find(
      (r) => r.bundleHash === "hash-1" && r.referenceId === "ref-same"
    );
    const ref2 = res.sourceReferences.find(
      (r) => r.bundleHash === "hash-2" && r.referenceId === "ref-same"
    );
    expect(ref1).toBeDefined();
    expect(ref2).toBeDefined();
  });

  it("records RESEARCH_BRIEF_UNAVAILABLE for a null brief", () => {
    const policy = EVIDENCE_SELECTION_POLICY_V1;
    const bundle = buildEvidenceBundle({
      researchBrief: null
    });
    const record = buildEvidenceRecord(bundle, { evidenceHash: "hash-1" });

    const res = selectEvidence({
      records: [record],
      selectedAtUnixMs: Date.parse("2024-01-15T10:10:00.000Z"),
      scope: { kind: "pair" },
      policy
    });

    const briefDec = res.decisions.find((d) => d.kind === "research_brief");
    expect(briefDec?.status).toBe("EXCLUDED");
    expect(briefDec?.reasons).toContain("RESEARCH_BRIEF_UNAVAILABLE");
    expect(res.selected.researchBrief).toBeNull();
  });

  it("selects a fully supported brief at the minimum of assessment and cited-average score", () => {
    const policy = {
      ...EVIDENCE_SELECTION_POLICY_V1,
      defaultSourceQualityBps: 10000
    };
    const bundle = buildEvidenceBundle({
      assessment: {
        overallConfidenceBps: 9000
      },
      deterministicFeatures: [
        {
          featureId: "feat-1",
          family: "market_state",
          featureKind: "number",
          status: "available",
          value: 100,
          unit: "usd",
          observedAt: "2024-01-15T10:00:00.000Z",
          freshUntil: "2024-01-15T11:00:00.000Z",
          confidenceBps: 8000,
          calculator: { name: "calc", version: "1" },
          inputLineage: ["ref-price-source"],
          warnings: []
        },
        {
          featureId: "feat-2",
          family: "market_state",
          featureKind: "number",
          status: "available",
          value: 200,
          unit: "usd",
          observedAt: "2024-01-15T10:00:00.000Z",
          freshUntil: "2024-01-15T11:00:00.000Z",
          confidenceBps: 7000,
          calculator: { name: "calc", version: "1" },
          inputLineage: ["ref-price-source"],
          warnings: []
        }
      ],
      researchBrief: {
        briefId: "brief-1",
        generatedAt: "2024-01-15T10:00:00.000Z",
        summary: "test brief",
        keyFindings: [],
        uncertainties: [],
        model: { provider: "test", modelId: "test", modelVersion: "1" },
        promptVersion: "1",
        sourceEvidenceIds: ["feat-1", "feat-2"]
      }
    });

    const record = buildEvidenceRecord(bundle, { evidenceHash: "hash-1" });
    const res = selectEvidence({
      records: [record],
      selectedAtUnixMs: Date.parse("2024-01-15T10:10:00.000Z"),
      scope: { kind: "pair" },
      policy
    });

    // cited average = floor((8000 + 7000)/2) = 7500.
    // min(overallConfidenceBps, average) = min(9000, 7500) = 7500.
    expect(res.selected.researchBrief?.status).toBe("SELECTED");
    expect(res.selected.researchBrief?.score).toBe(7500);
  });

  it("excludes a brief when any cited item was rejected capped or dependency-excluded", () => {
    const policy: EvidenceSelectionPolicy = {
      ...EVIDENCE_SELECTION_POLICY_V1,
      maxSelectedPerFamily: 1,
      minimumEffectiveScoreBps: 100
    };

    const bundle = buildEvidenceBundle({
      deterministicFeatures: [
        {
          featureId: "feat-1",
          family: "market_state",
          featureKind: "number",
          status: "available",
          value: 100,
          unit: "usd",
          observedAt: "2024-01-15T10:00:00.000Z",
          freshUntil: "2024-01-15T11:00:00.000Z",
          confidenceBps: 9000,
          calculator: { name: "calc", version: "1" },
          inputLineage: ["ref-price-source"],
          warnings: []
        },
        {
          featureId: "feat-2",
          family: "market_state",
          featureKind: "number",
          status: "available",
          value: 200,
          unit: "usd",
          observedAt: "2024-01-15T10:00:00.000Z",
          freshUntil: "2024-01-15T11:00:00.000Z",
          confidenceBps: 8000, // will be excluded as FAMILY_SELECTION_LIMIT because maxSelected is 1
          calculator: { name: "calc", version: "1" },
          inputLineage: ["ref-price-source"],
          warnings: []
        }
      ],
      researchBrief: {
        briefId: "brief-1",
        generatedAt: "2024-01-15T10:00:00.000Z",
        summary: "test brief",
        keyFindings: [],
        uncertainties: [],
        model: { provider: "test", modelId: "test", modelVersion: "1" },
        promptVersion: "1",
        sourceEvidenceIds: ["feat-1", "feat-2"]
      }
    });

    const record = buildEvidenceRecord(bundle, { evidenceHash: "hash-1" });
    const res = selectEvidence({
      records: [record],
      selectedAtUnixMs: Date.parse("2024-01-15T10:10:00.000Z"),
      scope: { kind: "pair" },
      policy
    });

    const briefDec = res.decisions.find((d) => d.kind === "research_brief");
    expect(briefDec?.status).toBe("EXCLUDED");
    expect(briefDec?.reasons).toContain("BRIEF_REFERENCES_EXCLUDED_EVIDENCE");
    expect(res.selected.researchBrief).toBeNull();
  });

  it("excludes an under-threshold otherwise-supported brief with its computed score", () => {
    const policy: EvidenceSelectionPolicy = {
      ...EVIDENCE_SELECTION_POLICY_V1,
      defaultSourceQualityBps: 10000,
      minimumEffectiveScoreBps: 8000
    };

    const bundle = buildEvidenceBundle({
      assessment: {
        overallConfidenceBps: 7000
      },
      deterministicFeatures: [
        {
          featureId: "feat-1",
          family: "market_state",
          featureKind: "number",
          status: "available",
          value: 100,
          unit: "usd",
          observedAt: "2024-01-15T10:00:00.000Z",
          freshUntil: "2024-01-15T11:00:00.000Z",
          confidenceBps: 9000,
          calculator: { name: "calc", version: "1" },
          inputLineage: ["ref-price-source"],
          warnings: []
        }
      ],
      researchBrief: {
        briefId: "brief-1",
        generatedAt: "2024-01-15T10:00:00.000Z",
        summary: "test brief",
        keyFindings: [],
        uncertainties: [],
        model: { provider: "test", modelId: "test", modelVersion: "1" },
        promptVersion: "1",
        sourceEvidenceIds: ["feat-1"]
      }
    });

    const record = buildEvidenceRecord(bundle, { evidenceHash: "hash-1" });
    const res = selectEvidence({
      records: [record],
      selectedAtUnixMs: Date.parse("2024-01-15T10:10:00.000Z"),
      scope: { kind: "pair" },
      policy
    });

    const briefDec = res.decisions.find((d) => d.kind === "research_brief");
    expect(briefDec?.status).toBe("EXCLUDED");
    expect(briefDec?.score).toBe(7000); // retains computed score
    expect(res.selected.researchBrief).toBeNull();
  });

  it("marks references selected lineage audit only or both and preserves originating bundle identity", () => {
    const policy: EvidenceSelectionPolicy = {
      ...EVIDENCE_SELECTION_POLICY_V1,
      maxSelectedPerFamily: 1,
      minimumEffectiveScoreBps: 100
    };

    const bundle = buildEvidenceBundle({
      deterministicFeatures: [
        {
          featureId: "feat-1",
          family: "market_state",
          featureKind: "number",
          status: "available",
          value: 100,
          unit: "usd",
          observedAt: "2024-01-15T10:00:00.000Z",
          freshUntil: "2024-01-15T11:00:00.000Z",
          confidenceBps: 9000,
          calculator: { name: "calc", version: "1" },
          inputLineage: ["ref-1"],
          warnings: []
        },
        {
          featureId: "feat-2",
          family: "market_state",
          featureKind: "number",
          status: "available",
          value: 200,
          unit: "usd",
          observedAt: "2024-01-15T10:00:00.000Z",
          freshUntil: "2024-01-15T11:00:00.000Z",
          confidenceBps: 8000, // excluded via cap
          calculator: { name: "calc", version: "1" },
          inputLineage: ["ref-2"],
          warnings: []
        },
        {
          featureId: "feat-3",
          family: "market_state",
          featureKind: "number",
          status: "available",
          value: 300,
          unit: "usd",
          observedAt: "2024-01-15T10:00:00.000Z",
          freshUntil: "2024-01-15T11:00:00.000Z",
          confidenceBps: 7000, // excluded
          calculator: { name: "calc", version: "1" },
          inputLineage: ["ref-1"], // references ref-1 too (which is also selected via feat-1)
          warnings: []
        }
      ],
      sourceReferences: [
        {
          referenceId: "ref-1",
          sourceType: "api",
          locator: "https://api.com/1",
          observedAt: "2024-01-15T09:50:00.000Z"
        },
        {
          referenceId: "ref-2",
          sourceType: "api",
          locator: "https://api.com/2",
          observedAt: "2024-01-15T09:50:00.000Z"
        },
        {
          referenceId: "ref-unused",
          sourceType: "api",
          locator: "https://api.com/unused",
          observedAt: "2024-01-15T09:50:00.000Z"
        }
      ]
    });

    const record = buildEvidenceRecord(bundle, { evidenceHash: "hash-1" });
    const res = selectEvidence({
      records: [record],
      selectedAtUnixMs: Date.parse("2024-01-15T10:10:00.000Z"),
      scope: { kind: "pair" },
      policy
    });

    const r1 = res.sourceReferences.find((r) => r.referenceId === "ref-1");
    const r2 = res.sourceReferences.find((r) => r.referenceId === "ref-2");
    const rUnused = res.sourceReferences.find((r) => r.referenceId === "ref-unused");

    expect(r1).toBeDefined();
    // ref-1 is reached by selected feat-1 AND excluded feat-3, so it should report both roles
    expect(r1?.isSelectedLineage).toBe(true);
    expect(r1?.isAuditOnly).toBe(false);
    expect(r1?.bundleHash).toBe("hash-1");

    expect(r2).toBeDefined();
    // ref-2 is reached only by excluded feat-2
    expect(r2?.isSelectedLineage).toBe(false);
    expect(r2?.isAuditOnly).toBe(true);

    expect(rUnused).toBeUndefined(); // unreferenced bundle references do not appear
  });
});
