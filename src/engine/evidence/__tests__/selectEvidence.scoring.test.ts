import { describe, expect, it } from "vitest";
import { buildEvidenceBundle, buildEvidenceRecord } from "./evidenceSelectionFixtures.js";
import { selectEvidence } from "../selectEvidence.js";
import { EVIDENCE_SELECTION_POLICY_V1, evidenceSourceQualityKey } from "../selectionPolicy.js";
import type { EvidenceSelectionPolicy } from "../selectionPolicy.js";

describe("Evidence selection and scoring", () => {
  it("selects fresh high-confidence features and claims with exact component scores", () => {
    // exact formula: confidence * source quality * provenance quality * freshness / 10000^3
    const confidenceBps = 9500;
    const sourceBps = 8000;
    const provenanceBps = 10000;
    const freshnessBps = 10000;

    const bundle = buildEvidenceBundle({
      deterministicFeatures: [
        {
          featureId: "feat-price-001",
          family: "market_state",
          featureKind: "number",
          status: "available",
          value: 150.25,
          unit: "usd",
          observedAt: "2024-01-15T10:00:00.000Z",
          freshUntil: "2024-01-15T11:00:00.000Z",
          confidenceBps,
          calculator: { name: "price-aggregator", version: "1.0.0" },
          inputLineage: ["ref-price-source"],
          warnings: []
        }
      ]
    });

    const record = buildEvidenceRecord(bundle, {
      lifecycle: "FRESH",
      evidenceHash: "hash123"
    });

    const policy: EvidenceSelectionPolicy = {
      ...EVIDENCE_SELECTION_POLICY_V1,
      defaultSourceQualityBps: sourceBps,
      minimumEffectiveScoreBps: 100
    };

    const input = {
      records: [record],
      selectedAtUnixMs: Date.parse("2024-01-15T10:30:00.000Z"),
      scope: { kind: "pair" as const },
      policy
    };

    const res = selectEvidence(input);
    expect(res.selected.deterministicFeatures).toHaveLength(1);
    const feat = res.selected.deterministicFeatures[0];
    expect(feat.featureId).toBe("feat-price-001");

    const expected = Number(
      (BigInt(confidenceBps) * BigInt(sourceBps) * BigInt(provenanceBps) * BigInt(freshnessBps)) /
        10_000n ** 3n
    );
    expect(feat.score).toBe(expected);
  });

  it("downweights a stale bundle once and emits STALE_EVIDENCE_DOWNWEIGHTED", () => {
    // stale weight is applied to the minimum of bundle/item freshness.
    // If bundle is stale and item is stale, weight is applied once.
    const bundle = buildEvidenceBundle({
      freshUntil: "2024-01-15T10:15:00.000Z",
      expiresAt: "2024-01-15T11:00:00.000Z",
      deterministicFeatures: [
        {
          featureId: "feat-price-001",
          family: "market_state",
          featureKind: "number",
          status: "available",
          value: 150.25,
          unit: "usd",
          observedAt: "2024-01-15T10:00:00.000Z",
          freshUntil: "2024-01-15T10:20:00.000Z",
          confidenceBps: 9000,
          calculator: { name: "price-aggregator", version: "1.0.0" },
          inputLineage: ["ref-price-source"],
          warnings: []
        }
      ]
    });

    const record = buildEvidenceRecord(bundle, {
      lifecycle: "STALE",
      evidenceHash: "hash123"
    });

    const policy: EvidenceSelectionPolicy = {
      ...EVIDENCE_SELECTION_POLICY_V1,
      staleWeightBps: 5000, // 0.5 stale penalty
      defaultSourceQualityBps: 10000,
      minimumEffectiveScoreBps: 100
    };

    // selected at 10:25: bundle is stale (fresh until 10:15), feature is stale (fresh until 10:20)
    const input = {
      records: [record],
      selectedAtUnixMs: Date.parse("2024-01-15T10:25:00.000Z"),
      scope: { kind: "pair" as const },
      policy
    };

    const res = selectEvidence(input);
    expect(res.selected.deterministicFeatures).toHaveLength(1);
    const feat = res.selected.deterministicFeatures[0];

    // Expected: confidence (9000) * source (10000) * provenance (10000) * freshness (5000) / 10000^3
    const expected = Number(
      (BigInt(9000) * BigInt(10000) * BigInt(10000) * BigInt(5000)) / 10_000n ** 3n
    );
    expect(feat.score).toBe(expected);

    // Decision contains warning/status
    const decision = res.decisions.find(
      (d) => d.candidateId === "hash123/deterministic_feature/feat-price-001"
    );
    expect(decision?.reasons).toContain("STALE_EVIDENCE_DOWNWEIGHTED");
  });

  it("uses inclusive feature freshness and claim expiry boundaries", () => {
    // equality is usable, strictly past is stale/expired
    const bundle = buildEvidenceBundle({
      freshUntil: "2024-01-15T11:00:00.000Z",
      expiresAt: "2024-01-15T12:00:00.000Z",
      deterministicFeatures: [
        {
          featureId: "feat-price-001",
          family: "market_state",
          featureKind: "number",
          status: "available",
          value: 150.25,
          unit: "usd",
          observedAt: "2024-01-15T10:00:00.000Z",
          freshUntil: "2024-01-15T11:00:00.000Z", // equal
          confidenceBps: 9000,
          calculator: { name: "price-aggregator", version: "1.0.0" },
          inputLineage: ["ref-price-source"],
          warnings: []
        }
      ],
      contextualEvidence: {
        supportResistance: [
          {
            evidenceId: "ctx-sr-001",
            kind: "support_zone",
            claim: "Support at 100",
            direction: "bullish",
            confidenceBps: 8000,
            observedAt: "2024-01-15T10:00:00.000Z",
            expiresAt: "2024-01-15T11:00:00.000Z", // equal
            sourceReferenceIds: ["ref-price-source"],
            provenanceMethod: "derived"
          }
        ]
      }
    });

    const record = buildEvidenceRecord(bundle, {
      lifecycle: "FRESH",
      evidenceHash: "hash123"
    });

    // select at exactly 11:00:00.000Z
    const input = {
      records: [record],
      selectedAtUnixMs: Date.parse("2024-01-15T11:00:00.000Z"),
      scope: { kind: "pair" as const },
      policy: EVIDENCE_SELECTION_POLICY_V1
    };

    const res = selectEvidence(input);
    expect(res.selected.deterministicFeatures[0].score).toBeGreaterThan(0);
    // contextual claim is not expired at 11:00:00 because it's inclusive
    expect(res.selected.contextualEvidence.supportResistance).toHaveLength(1);

    // strictly past (e.g. 11:00:00.001Z)
    const recordPast = buildEvidenceRecord(bundle, {
      lifecycle: "STALE",
      evidenceHash: "hash123"
    });
    const inputPast = {
      records: [recordPast],
      selectedAtUnixMs: Date.parse("2024-01-15T11:00:00.001Z"),
      scope: { kind: "pair" as const },
      policy: EVIDENCE_SELECTION_POLICY_V1
    };
    const resPast = selectEvidence(inputPast);
    const claimDecision = resPast.decisions.find(
      (d) => d.candidateId === "hash123/contextual_claim/ctx-sr-001"
    );
    expect(claimDecision?.status).toBe("EXCLUDED");
    expect(claimDecision?.reasons).toContain("CLAIM_EXPIRED");
  });

  it("excludes expired bundles and records every contained candidate as BUNDLE_EXPIRED", () => {
    const bundle = buildEvidenceBundle({
      freshUntil: "2024-01-15T10:30:00.000Z",
      expiresAt: "2024-01-15T11:00:00.000Z",
      deterministicFeatures: [
        {
          featureId: "feat-price-001",
          family: "market_state",
          featureKind: "number",
          status: "available",
          value: 150.25,
          unit: "usd",
          observedAt: "2024-01-15T10:00:00.000Z",
          freshUntil: "2024-01-15T10:30:00.000Z",
          confidenceBps: 9000,
          calculator: { name: "price-aggregator", version: "1.0.0" },
          inputLineage: ["ref-price-source"],
          warnings: []
        }
      ]
    });

    const record = buildEvidenceRecord(bundle, {
      lifecycle: "EXPIRED",
      evidenceHash: "hash123"
    });

    // select at 11:00:01
    const input = {
      records: [record],
      selectedAtUnixMs: Date.parse("2024-01-15T11:00:01.000Z"),
      scope: { kind: "pair" as const },
      policy: EVIDENCE_SELECTION_POLICY_V1
    };

    const res = selectEvidence(input);
    expect(res.selected.deterministicFeatures).toHaveLength(0);
    const decision = res.decisions.find(
      (d) => d.candidateId === "hash123/deterministic_feature/feat-price-001"
    );
    expect(decision?.status).toBe("EXCLUDED");
    expect(decision?.reasons).toContain("BUNDLE_EXPIRED");
  });

  it("excludes unavailable and invalid features with distinct terminal reasons", () => {
    const bundle = buildEvidenceBundle({
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
        },
        {
          featureId: "feat-price-invalid",
          family: "market_state",
          featureKind: "number",
          status: "invalid",
          value: null,
          unit: null,
          observedAt: null,
          freshUntil: null,
          confidenceBps: 0,
          calculator: { name: "price-aggregator", version: "1.0.0" },
          inputLineage: ["ref-price-source"],
          warnings: ["warning-002"]
        }
      ]
    });

    const record = buildEvidenceRecord(bundle, {
      lifecycle: "FRESH",
      evidenceHash: "hash123"
    });

    const input = {
      records: [record],
      selectedAtUnixMs: Date.parse("2024-01-15T10:00:00.000Z"),
      scope: { kind: "pair" as const },
      policy: EVIDENCE_SELECTION_POLICY_V1
    };

    const res = selectEvidence(input);
    expect(res.selected.deterministicFeatures).toHaveLength(0);

    const decUnavail = res.decisions.find(
      (d) => d.candidateId === "hash123/deterministic_feature/feat-price-unavailable"
    );
    expect(decUnavail?.status).toBe("EXCLUDED");
    expect(decUnavail?.reasons).toContain("FEATURE_UNAVAILABLE");

    const decInvalid = res.decisions.find(
      (d) => d.candidateId === "hash123/deterministic_feature/feat-price-invalid"
    );
    expect(decInvalid?.status).toBe("EXCLUDED");
    expect(decInvalid?.reasons).toContain("FEATURE_INVALID");
  });

  it("applies exact-source overrides before the conservative default and honors zero as disabled", () => {
    const bundle1 = buildEvidenceBundle({
      publisher: "sol-usdc-clmm-intelligence",
      sourceId: "src-overridden",
      deterministicFeatures: [
        {
          featureId: "feat-1",
          family: "market_state",
          featureKind: "number",
          status: "available",
          value: 1,
          unit: "usd",
          observedAt: "2024-01-15T10:00:00.000Z",
          freshUntil: "2024-01-15T11:00:00.000Z",
          confidenceBps: 10000,
          calculator: { name: "c", version: "1" },
          inputLineage: ["ref-price-source"],
          warnings: []
        }
      ]
    });
    const bundle2 = buildEvidenceBundle({
      publisher: "sol-usdc-clmm-intelligence",
      sourceId: "src-disabled",
      deterministicFeatures: [
        {
          featureId: "feat-2",
          family: "market_state",
          featureKind: "number",
          status: "available",
          value: 2,
          unit: "usd",
          observedAt: "2024-01-15T10:00:00.000Z",
          freshUntil: "2024-01-15T11:00:00.000Z",
          confidenceBps: 10000,
          calculator: { name: "c", version: "1" },
          inputLineage: ["ref-price-source"],
          warnings: []
        }
      ]
    });

    const record1 = buildEvidenceRecord(bundle1, { id: 1, evidenceHash: "hash1" });
    const record2 = buildEvidenceRecord(bundle2, { id: 2, evidenceHash: "hash2" });

    const keyOverridden = evidenceSourceQualityKey("sol-usdc-clmm-intelligence", "src-overridden");
    const keyDisabled = evidenceSourceQualityKey("sol-usdc-clmm-intelligence", "src-disabled");

    const policy: EvidenceSelectionPolicy = {
      ...EVIDENCE_SELECTION_POLICY_V1,
      defaultSourceQualityBps: 5000,
      sourceQualityBps: {
        [keyOverridden]: 9000,
        [keyDisabled]: 0
      },
      minimumEffectiveScoreBps: 100
    };

    const input = {
      records: [record1, record2],
      selectedAtUnixMs: Date.parse("2024-01-15T10:00:00.000Z"),
      scope: { kind: "pair" as const },
      policy
    };

    const res = selectEvidence(input);

    // feat-1 has exact-source quality 9000. score = 10000 * 9000 * 10000 * 10000 / 10000^3 = 9000
    const feat1 = res.selected.deterministicFeatures.find((f) => f.featureId === "feat-1");
    expect(feat1?.score).toBe(9000);

    // feat-2 is from disabled source, so its score components will have source 0, leading to final score 0, which is < threshold
    const feat2 = res.selected.deterministicFeatures.find((f) => f.featureId === "feat-2");
    expect(feat2).toBeUndefined();

    const dec2 = res.decisions.find((d) => d.candidateId === "hash2/deterministic_feature/feat-2");
    expect(dec2?.status).toBe("EXCLUDED");
    expect(dec2?.reasons).toContain("BUNDLE_DISABLED");
  });

  it("applies calculator derived collected and human-authored provenance weights exactly", () => {
    const bundle = buildEvidenceBundle({
      deterministicFeatures: [
        {
          featureId: "feat-calc",
          family: "market_state",
          featureKind: "number",
          status: "available",
          value: 1,
          unit: "usd",
          observedAt: "2024-01-15T10:00:00.000Z",
          freshUntil: "2024-01-15T11:00:00.000Z",
          confidenceBps: 10000,
          calculator: { name: "c", version: "1" },
          inputLineage: ["ref-price-source"],
          warnings: []
        }
      ],
      contextualEvidence: {
        supportResistance: [
          {
            evidenceId: "ctx-derived",
            kind: "support_zone",
            claim: "derived",
            direction: "bullish",
            confidenceBps: 10000,
            observedAt: "2024-01-15T10:00:00.000Z",
            expiresAt: "2024-01-15T11:00:00.000Z",
            sourceReferenceIds: ["ref-price-source"],
            provenanceMethod: "derived"
          },
          {
            evidenceId: "ctx-collected",
            kind: "support_zone",
            claim: "collected",
            direction: "bullish",
            confidenceBps: 10000,
            observedAt: "2024-01-15T10:00:00.000Z",
            expiresAt: "2024-01-15T11:00:00.000Z",
            sourceReferenceIds: ["ref-price-source"],
            provenanceMethod: "collected"
          },
          {
            evidenceId: "ctx-human",
            kind: "support_zone",
            claim: "human",
            direction: "bullish",
            confidenceBps: 10000,
            observedAt: "2024-01-15T10:00:00.000Z",
            expiresAt: "2024-01-15T11:00:00.000Z",
            sourceReferenceIds: ["ref-price-source"],
            provenanceMethod: "human_authored"
          }
        ]
      }
    });

    const record = buildEvidenceRecord(bundle, { lifecycle: "FRESH", evidenceHash: "hash" });
    const policy: EvidenceSelectionPolicy = {
      ...EVIDENCE_SELECTION_POLICY_V1,
      defaultSourceQualityBps: 10000,
      minimumEffectiveScoreBps: 100,
      provenanceQualityBps: {
        deterministic_calculator: 10000,
        derived: 9000,
        collected: 8000,
        human_authored: 7000
      }
    };

    const res = selectEvidence({
      records: [record],
      selectedAtUnixMs: Date.parse("2024-01-15T10:00:00.000Z"),
      scope: { kind: "pair" as const },
      policy
    });

    const feat = res.selected.deterministicFeatures.find((f) => f.featureId === "feat-calc");
    expect(feat?.score).toBe(10000); // 10000 * 10000 * 10000 * 10000 / 10^12

    const sr = res.selected.contextualEvidence.supportResistance;
    const der = sr.find((x) => x.evidenceId === "ctx-derived");
    expect(der?.score).toBe(9000);

    const col = sr.find((x) => x.evidenceId === "ctx-collected");
    expect(col?.score).toBe(8000);

    const hum = sr.find((x) => x.evidenceId === "ctx-human");
    expect(hum?.score).toBe(7000);
  });

  it("excludes scores below threshold while retaining score components", () => {
    // minimumEffectiveScoreBps = 5000. A score of 4999 is excluded, 5000 is included
    const bundle = buildEvidenceBundle({
      deterministicFeatures: [
        {
          featureId: "feat-low",
          family: "market_state",
          featureKind: "number",
          status: "available",
          value: 1,
          unit: "usd",
          observedAt: "2024-01-15T10:00:00.000Z",
          freshUntil: "2024-01-15T11:00:00.000Z",
          confidenceBps: 4990, // score component: 4990
          calculator: { name: "c", version: "1" },
          inputLineage: ["ref-price-source"],
          warnings: []
        },
        {
          featureId: "feat-ok",
          family: "market_state",
          featureKind: "number",
          status: "available",
          value: 2,
          unit: "usd",
          observedAt: "2024-01-15T10:00:00.000Z",
          freshUntil: "2024-01-15T11:00:00.000Z",
          confidenceBps: 5000,
          calculator: { name: "c", version: "1" },
          inputLineage: ["ref-price-source"],
          warnings: []
        }
      ]
    });

    const record = buildEvidenceRecord(bundle, { lifecycle: "FRESH", evidenceHash: "hash" });
    const policy: EvidenceSelectionPolicy = {
      ...EVIDENCE_SELECTION_POLICY_V1,
      defaultSourceQualityBps: 10000,
      minimumEffectiveScoreBps: 5000
    };

    const res = selectEvidence({
      records: [record],
      selectedAtUnixMs: Date.parse("2024-01-15T10:00:00.000Z"),
      scope: { kind: "pair" as const },
      policy
    });

    expect(res.selected.deterministicFeatures).toHaveLength(1);
    expect(res.selected.deterministicFeatures[0].featureId).toBe("feat-ok");

    const decLow = res.decisions.find(
      (d) => d.candidateId === "hash/deterministic_feature/feat-low"
    );
    expect(decLow?.status).toBe("EXCLUDED");
    expect(decLow?.reasons).toContain("score_threshold");
    expect(decLow?.score).toBe(4990);
    expect(decLow?.rawConfidence).toBe(4990);
    expect(decLow?.sourceQuality).toBe(10000);
    expect(decLow?.provenanceQuality).toBe(10000);
    expect(decLow?.freshnessWeight).toBe(10000);
  });

  it("isolates scope and lifecycle metadata mismatches without corrupting valid peers", () => {
    // Record with mismatched scope
    const bundleMismatchedScope = buildEvidenceBundle({
      scope: { kind: "wallet", network: "solana-mainnet", walletAddress: "some-wallet" },
      deterministicFeatures: [
        {
          featureId: "feat-mismatch-scope",
          family: "market_state",
          featureKind: "number",
          status: "available",
          value: 1,
          unit: "usd",
          observedAt: "2024-01-15T10:00:00.000Z",
          freshUntil: "2024-01-15T11:00:00.000Z",
          confidenceBps: 9000,
          calculator: { name: "c", version: "1" },
          inputLineage: ["ref-price-source"],
          warnings: []
        }
      ]
    });

    // Record with mismatched lifecycle (e.g. record metadata says FRESH, but recomputed from timestamps is EXPIRED)
    const bundleMismatchedLifecycle = buildEvidenceBundle({
      freshUntil: "2024-01-15T10:30:00.000Z",
      expiresAt: "2024-01-15T11:00:00.000Z",
      deterministicFeatures: [
        {
          featureId: "feat-mismatch-lifecycle",
          family: "market_state",
          featureKind: "number",
          status: "available",
          value: 1,
          unit: "usd",
          observedAt: "2024-01-15T10:00:00.000Z",
          freshUntil: "2024-01-15T10:30:00.000Z",
          confidenceBps: 9000,
          calculator: { name: "c", version: "1" },
          inputLineage: ["ref-price-source"],
          warnings: []
        }
      ]
    });

    const bundleValid = buildEvidenceBundle({
      deterministicFeatures: [
        {
          featureId: "feat-valid",
          family: "market_state",
          featureKind: "number",
          status: "available",
          value: 100,
          unit: "usd",
          observedAt: "2024-01-15T10:00:00.000Z",
          freshUntil: "2024-01-15T11:00:00.000Z",
          confidenceBps: 9000,
          calculator: { name: "c", version: "1" },
          inputLineage: ["ref-price-source"],
          warnings: []
        }
      ]
    });

    const recordMismatchedScope = buildEvidenceRecord(bundleMismatchedScope, {
      id: 1,
      evidenceHash: "hash-mismatch-scope",
      lifecycle: "FRESH"
    });
    const recordMismatchedLifecycle = buildEvidenceRecord(bundleMismatchedLifecycle, {
      id: 2,
      evidenceHash: "hash-mismatch-lifecycle",
      lifecycle: "FRESH"
    });
    const recordValid = buildEvidenceRecord(bundleValid, {
      id: 3,
      evidenceHash: "hash-valid",
      lifecycle: "FRESH"
    });

    // selectedAt is 11:00:01. So bundleMismatchedLifecycle (expired at 11:00:00) is recomputed as EXPIRED, but record has lifecycle: "FRESH". Mismatch!
    const input = {
      records: [recordMismatchedScope, recordMismatchedLifecycle, recordValid],
      selectedAtUnixMs: Date.parse("2024-01-15T11:00:01.000Z"),
      scope: { kind: "pair" as const },
      policy: EVIDENCE_SELECTION_POLICY_V1
    };

    const res = selectEvidence(input);
    expect(res.selected.deterministicFeatures).toHaveLength(0); // Valid is past freshUntil, so it is downweighted but maybe under threshold, or we can check its selection/exclusion

    // Check decisions
    const decScope = res.decisions.find(
      (d) => d.candidateId === "hash-mismatch-scope/deterministic_feature/feat-mismatch-scope"
    );
    expect(decScope?.status).toBe("EXCLUDED");
    expect(decScope?.reasons).toContain("record_mismatch");

    const decLife = res.decisions.find(
      (d) =>
        d.candidateId === "hash-mismatch-lifecycle/deterministic_feature/feat-mismatch-lifecycle"
    );
    expect(decLife?.status).toBe("EXCLUDED");
    expect(decLife?.reasons).toContain("record_mismatch");
  });

  it("rejects invalid input before returning partial output", () => {
    const policy = EVIDENCE_SELECTION_POLICY_V1;

    expect(() =>
      selectEvidence({
        records: [],
        selectedAtUnixMs: -5,
        scope: { kind: "pair" },
        policy
      })
    ).toThrow();

    expect(() =>
      selectEvidence({
        records: [],
        selectedAtUnixMs: NaN,
        scope: { kind: "pair" },
        policy
      })
    ).toThrow();

    expect(() =>
      selectEvidence({
        records: [],
        selectedAtUnixMs: Date.parse("2024-01-15T10:00:00.000Z"),
        scope: { kind: "pair" },
        policy: {
          ...policy,
          version: ""
        }
      })
    ).toThrow();
  });
});
