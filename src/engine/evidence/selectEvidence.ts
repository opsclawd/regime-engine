import { validateEvidenceSelectionPolicy, evidenceSourceQualityKey } from "./selectionPolicy.js";
import type { EvidenceSelectionPolicy } from "./selectionPolicy.js";
import type {
  Scope,
  DeterministicFeature,
  ResearchBrief,
  SupportResistanceClaim,
  FlowClaim,
  DerivativesClaim,
  EventClaim,
  NewsRegulatoryClaim
} from "../../contract/evidence/v1/types.generated.js";
import type {
  EvidenceBundleRecord,
  EvidenceLifecycle
} from "../../application/ports/evidenceBundleRepositoryPort.js";

export interface SelectEvidenceInput {
  readonly records: readonly EvidenceBundleRecord[];
  readonly selectedAtUnixMs: number;
  readonly scope: Scope;
  readonly policy: EvidenceSelectionPolicy;
}

export interface SelectedDeterministicFeature {
  readonly candidateId: string;
  readonly bundleHash: string;
  readonly publisher: string;
  readonly sourceId: string;
  readonly runId: string;
  readonly correlationId: string;
  readonly receivedAtUnixMs: number;
  readonly originalItem: DeterministicFeature;
  readonly featureId: string;
  readonly family: string;
  readonly value: number | boolean | string;
  readonly rawConfidence: number;
  readonly sourceQuality: number;
  readonly provenanceQuality: number;
  readonly freshnessWeight: number;
  readonly score: number;
  readonly sourceReferenceIds: readonly string[];
  readonly status: "SELECTED";
  readonly reasons: readonly string[];
}

export interface SelectedContextualClaim {
  readonly candidateId: string;
  readonly bundleHash: string;
  readonly publisher: string;
  readonly sourceId: string;
  readonly runId: string;
  readonly correlationId: string;
  readonly receivedAtUnixMs: number;
  readonly originalItem:
    | SupportResistanceClaim
    | FlowClaim
    | DerivativesClaim
    | EventClaim
    | NewsRegulatoryClaim;
  readonly evidenceId: string;
  readonly claim: string;
  readonly direction: string;
  readonly rawConfidence: number;
  readonly sourceQuality: number;
  readonly provenanceQuality: number;
  readonly freshnessWeight: number;
  readonly score: number;
  readonly sourceReferenceIds: readonly string[];
  readonly status: "SELECTED";
  readonly reasons: readonly string[];
}

export interface SelectedResearchBrief {
  readonly candidateId: string;
  readonly bundleHash: string;
  readonly publisher: string;
  readonly sourceId: string;
  readonly runId: string;
  readonly correlationId: string;
  readonly receivedAtUnixMs: number;
  readonly originalItem: ResearchBrief;
  readonly briefId: string;
  readonly summary: string;
  readonly rawConfidence: number;
  readonly sourceQuality: number;
  readonly provenanceQuality: number;
  readonly freshnessWeight: number;
  readonly score: number | null;
  readonly sourceReferenceIds: readonly string[];
  readonly status: "SELECTED";
  readonly reasons: readonly string[];
}

export interface SelectedContextualFamilies {
  readonly supportResistance: readonly SelectedContextualClaim[];
  readonly flows: readonly SelectedContextualClaim[];
  readonly derivatives: readonly SelectedContextualClaim[];
  readonly events: readonly SelectedContextualClaim[];
  readonly newsRegulatory: readonly SelectedContextualClaim[];
}

export interface FamilyCoverageSummary {
  readonly deterministicCount: number;
  readonly supportResistanceCount: number;
  readonly flowsCount: number;
  readonly derivativesCount: number;
  readonly eventsCount: number;
  readonly newsRegulatoryCount: number;
  readonly researchBriefCount: number;
}

export interface DeterministicCoverageSummary {
  readonly availableCount: number;
  readonly unavailableCount: number;
  readonly invalidCount: number;
}

export interface ConflictSummary {
  readonly conflictType: string;
  readonly message: string;
  readonly affectedCandidates: readonly string[];
}

export interface SelectionWarning {
  readonly code:
    | "stale_input"
    | "missing_family"
    | "rejected_family"
    | "conflicted_family"
    | "no_selected_research";
  readonly message: string;
}

export interface SelectedSourceReference {
  readonly referenceId: string;
  readonly sourceType: string;
  readonly locator: string;
  readonly observedAt: string;
}

export interface BundleSelectionLineage {
  readonly bundleHash: string;
  readonly publisher: string;
  readonly sourceId: string;
  readonly runId: string;
  readonly correlationId: string;
  readonly receivedAtUnixMs: number;
  readonly status: "ACCEPTED" | "REJECTED";
  readonly reasons: readonly string[];
}

export interface EvidenceSelectionDecision {
  readonly candidateId: string;
  readonly bundleHash: string;
  readonly publisher: string;
  readonly sourceId: string;
  readonly runId: string;
  readonly correlationId: string;
  readonly receivedAtUnixMs: number;
  readonly kind: "deterministic_feature" | "contextual_claim" | "research_brief";
  readonly localId: string;
  readonly rawConfidence: number;
  readonly sourceQuality: number;
  readonly provenanceQuality: number;
  readonly freshnessWeight: number;
  readonly score: number | null;
  readonly status: "SELECTED" | "EXCLUDED";
  readonly reasons: readonly string[];
}

export interface SelectedEvidenceSummary {
  readonly selectionPolicyVersion: string;
  readonly selectedAtUnixMs: number;
  readonly pair: "SOL/USDC";
  readonly scope: Scope;
  readonly authority: "ADVISORY_ONLY";
  readonly mode: "FULL" | "PARTIAL" | "DEGRADED_NO_RESEARCH";
  readonly selected: {
    readonly deterministicFeatures: readonly SelectedDeterministicFeature[];
    readonly contextualEvidence: SelectedContextualFamilies;
    readonly researchBrief: SelectedResearchBrief | null;
  };
  readonly familyCoverage: FamilyCoverageSummary;
  readonly deterministicEvidenceCoverage: DeterministicCoverageSummary;
  readonly conflicts: readonly ConflictSummary[];
  readonly warnings: readonly SelectionWarning[];
  readonly sourceReferences: readonly SelectedSourceReference[];
  readonly bundles: readonly BundleSelectionLineage[];
  readonly decisions: readonly EvidenceSelectionDecision[];
}

const LENGTH_PREFIX = (s: string): string => `${s.length}:${s}`;

function localEvidenceScopeKey(scope: Scope): string {
  switch (scope.kind) {
    case "pair":
      return "pair";
    case "whirlpool":
      return `whirlpool:${scope.whirlpoolAddress}`;
    case "wallet":
      return `wallet:${scope.walletAddress}`;
    case "position":
      return (
        "position:" +
        LENGTH_PREFIX(scope.walletAddress) +
        LENGTH_PREFIX(scope.whirlpoolAddress) +
        LENGTH_PREFIX(scope.positionId)
      );
  }
}

export function selectEvidence(input: SelectEvidenceInput): SelectedEvidenceSummary {
  const { records, selectedAtUnixMs, scope, policy } = input;

  // Validate inputs
  if (
    typeof selectedAtUnixMs !== "number" ||
    !Number.isFinite(selectedAtUnixMs) ||
    !Number.isInteger(selectedAtUnixMs) ||
    selectedAtUnixMs < 0
  ) {
    throw new RangeError("selectedAtUnixMs must be a non-negative finite integer");
  }

  const validatedPolicy = validateEvidenceSelectionPolicy(policy);
  const targetScopeKey = localEvidenceScopeKey(scope);

  // Copy records so we can sort them without modifying the input
  const sortedRecords = [...records];
  sortedRecords.sort((a, b) => {
    const pubA = a.bundle.source.publisher;
    const pubB = b.bundle.source.publisher;
    if (pubA < pubB) return -1;
    if (pubA > pubB) return 1;

    const srcA = a.bundle.source.sourceId;
    const srcB = b.bundle.source.sourceId;
    if (srcA < srcB) return -1;
    if (srcA > srcB) return 1;

    const asOfA = a.bundle.asOf;
    const asOfB = b.bundle.asOf;
    if (asOfA < asOfB) return -1;
    if (asOfA > asOfB) return 1;

    if (a.receivedAtUnixMs !== b.receivedAtUnixMs) {
      return a.receivedAtUnixMs - b.receivedAtUnixMs;
    }

    if (a.id !== b.id) {
      return a.id - b.id;
    }

    if (a.evidenceHash < b.evidenceHash) return -1;
    if (a.evidenceHash > b.evidenceHash) return 1;

    return 0;
  });

  const decisions: EvidenceSelectionDecision[] = [];
  const bundles: BundleSelectionLineage[] = [];
  const selectedSourceRefs = new Map<string, SelectedSourceReference>();

  interface IntermediateCandidate {
    candidateId: string;
    bundleHash: string;
    publisher: string;
    sourceId: string;
    runId: string;
    correlationId: string;
    receivedAtUnixMs: number;
    kind: "deterministic_feature" | "contextual_claim" | "research_brief";
    localId: string;
    originalItem:
      | DeterministicFeature
      | SupportResistanceClaim
      | FlowClaim
      | DerivativesClaim
      | EventClaim
      | NewsRegulatoryClaim
      | ResearchBrief;
    rawConfidence: number;
    sourceQuality: number;
    provenanceQuality: number;
    freshnessWeight: number;
    score: number | null;
    sourceReferenceIds: readonly string[];
    reasons: string[];
    family: string;
    value?: number | boolean | string;
    direction?: string;
  }

  const candidatesByFamily = new Map<string, IntermediateCandidate[]>();

  const registerCandidate = (c: IntermediateCandidate) => {
    if (!candidatesByFamily.has(c.family)) {
      candidatesByFamily.set(c.family, []);
    }
    candidatesByFamily.get(c.family)!.push(c);
  };

  for (const record of sortedRecords) {
    const recordScopeKey = localEvidenceScopeKey(record.bundle.scope);
    const scopeMatch = recordScopeKey === targetScopeKey;

    const freshUntilMs = Date.parse(record.bundle.freshUntil);
    const expiresAtMs = Date.parse(record.bundle.expiresAt);
    let computedLifecycle: EvidenceLifecycle = "FRESH";
    if (selectedAtUnixMs <= freshUntilMs) {
      computedLifecycle = "FRESH";
    } else if (selectedAtUnixMs <= expiresAtMs) {
      computedLifecycle = "STALE";
    } else {
      computedLifecycle = "EXPIRED";
    }

    const lifecycleMatch = record.lifecycle === computedLifecycle;

    if (!scopeMatch || !lifecycleMatch) {
      const reasons = ["record_mismatch"];
      bundles.push({
        bundleHash: record.evidenceHash,
        publisher: record.bundle.source.publisher,
        sourceId: record.bundle.source.sourceId,
        runId: record.bundle.runId,
        correlationId: record.bundle.correlationId,
        receivedAtUnixMs: record.receivedAtUnixMs,
        status: "REJECTED",
        reasons
      });

      // Exclude all items
      for (const feature of record.bundle.deterministicFeatures) {
        decisions.push({
          candidateId: `${record.evidenceHash}/deterministic_feature/${feature.featureId}`,
          bundleHash: record.evidenceHash,
          publisher: record.bundle.source.publisher,
          sourceId: record.bundle.source.sourceId,
          runId: record.bundle.runId,
          correlationId: record.bundle.correlationId,
          receivedAtUnixMs: record.receivedAtUnixMs,
          kind: "deterministic_feature",
          localId: feature.featureId,
          rawConfidence: 0,
          sourceQuality: 0,
          provenanceQuality: 0,
          freshnessWeight: 0,
          score: null,
          status: "EXCLUDED",
          reasons
        });
      }
      const ctx = record.bundle.contextualEvidence;
      const claims = [
        ...ctx.supportResistance.map((x) => ({ id: x.evidenceId, kind: "supportResistance" })),
        ...ctx.flows.map((x) => ({ id: x.evidenceId, kind: "flows" })),
        ...ctx.derivatives.map((x) => ({ id: x.evidenceId, kind: "derivatives" })),
        ...ctx.events.map((x) => ({ id: x.evidenceId, kind: "events" })),
        ...ctx.newsRegulatory.map((x) => ({ id: x.evidenceId, kind: "newsRegulatory" }))
      ];
      for (const claim of claims) {
        decisions.push({
          candidateId: `${record.evidenceHash}/contextual_claim/${claim.id}`,
          bundleHash: record.evidenceHash,
          publisher: record.bundle.source.publisher,
          sourceId: record.bundle.source.sourceId,
          runId: record.bundle.runId,
          correlationId: record.bundle.correlationId,
          receivedAtUnixMs: record.receivedAtUnixMs,
          kind: "contextual_claim",
          localId: claim.id,
          rawConfidence: 0,
          sourceQuality: 0,
          provenanceQuality: 0,
          freshnessWeight: 0,
          score: null,
          status: "EXCLUDED",
          reasons
        });
      }
      decisions.push({
        candidateId: `${record.evidenceHash}/research_brief/${record.bundle.researchBrief ? record.bundle.researchBrief.briefId : "<unavailable>"}`,
        bundleHash: record.evidenceHash,
        publisher: record.bundle.source.publisher,
        sourceId: record.bundle.source.sourceId,
        runId: record.bundle.runId,
        correlationId: record.bundle.correlationId,
        receivedAtUnixMs: record.receivedAtUnixMs,
        kind: "research_brief",
        localId: record.bundle.researchBrief
          ? record.bundle.researchBrief.briefId
          : "<unavailable>",
        rawConfidence: 0,
        sourceQuality: 0,
        provenanceQuality: 0,
        freshnessWeight: 0,
        score: null,
        status: "EXCLUDED",
        reasons
      });

      continue;
    }

    const sourceKey = evidenceSourceQualityKey(
      record.bundle.source.publisher,
      record.bundle.source.sourceId
    );
    const sourceQuality =
      validatedPolicy.sourceQualityBps[sourceKey] !== undefined
        ? validatedPolicy.sourceQualityBps[sourceKey]
        : validatedPolicy.defaultSourceQualityBps;

    if (sourceQuality === 0) {
      const reasons = ["BUNDLE_DISABLED"];
      bundles.push({
        bundleHash: record.evidenceHash,
        publisher: record.bundle.source.publisher,
        sourceId: record.bundle.source.sourceId,
        runId: record.bundle.runId,
        correlationId: record.bundle.correlationId,
        receivedAtUnixMs: record.receivedAtUnixMs,
        status: "REJECTED",
        reasons
      });

      for (const feature of record.bundle.deterministicFeatures) {
        decisions.push({
          candidateId: `${record.evidenceHash}/deterministic_feature/${feature.featureId}`,
          bundleHash: record.evidenceHash,
          publisher: record.bundle.source.publisher,
          sourceId: record.bundle.source.sourceId,
          runId: record.bundle.runId,
          correlationId: record.bundle.correlationId,
          receivedAtUnixMs: record.receivedAtUnixMs,
          kind: "deterministic_feature",
          localId: feature.featureId,
          rawConfidence: 0,
          sourceQuality: 0,
          provenanceQuality: 0,
          freshnessWeight: 0,
          score: null,
          status: "EXCLUDED",
          reasons
        });
      }
      const ctx = record.bundle.contextualEvidence;
      const claims = [
        ...ctx.supportResistance.map((x) => ({ id: x.evidenceId, kind: "supportResistance" })),
        ...ctx.flows.map((x) => ({ id: x.evidenceId, kind: "flows" })),
        ...ctx.derivatives.map((x) => ({ id: x.evidenceId, kind: "derivatives" })),
        ...ctx.events.map((x) => ({ id: x.evidenceId, kind: "events" })),
        ...ctx.newsRegulatory.map((x) => ({ id: x.evidenceId, kind: "newsRegulatory" }))
      ];
      for (const claim of claims) {
        decisions.push({
          candidateId: `${record.evidenceHash}/contextual_claim/${claim.id}`,
          bundleHash: record.evidenceHash,
          publisher: record.bundle.source.publisher,
          sourceId: record.bundle.source.sourceId,
          runId: record.bundle.runId,
          correlationId: record.bundle.correlationId,
          receivedAtUnixMs: record.receivedAtUnixMs,
          kind: "contextual_claim",
          localId: claim.id,
          rawConfidence: 0,
          sourceQuality: 0,
          provenanceQuality: 0,
          freshnessWeight: 0,
          score: null,
          status: "EXCLUDED",
          reasons
        });
      }
      decisions.push({
        candidateId: `${record.evidenceHash}/research_brief/${record.bundle.researchBrief ? record.bundle.researchBrief.briefId : "<unavailable>"}`,
        bundleHash: record.evidenceHash,
        publisher: record.bundle.source.publisher,
        sourceId: record.bundle.source.sourceId,
        runId: record.bundle.runId,
        correlationId: record.bundle.correlationId,
        receivedAtUnixMs: record.receivedAtUnixMs,
        kind: "research_brief",
        localId: record.bundle.researchBrief
          ? record.bundle.researchBrief.briefId
          : "<unavailable>",
        rawConfidence: 0,
        sourceQuality: 0,
        provenanceQuality: 0,
        freshnessWeight: 0,
        score: null,
        status: "EXCLUDED",
        reasons
      });

      continue;
    }

    if (computedLifecycle === "EXPIRED") {
      const reasons = ["BUNDLE_EXPIRED"];
      bundles.push({
        bundleHash: record.evidenceHash,
        publisher: record.bundle.source.publisher,
        sourceId: record.bundle.source.sourceId,
        runId: record.bundle.runId,
        correlationId: record.bundle.correlationId,
        receivedAtUnixMs: record.receivedAtUnixMs,
        status: "REJECTED",
        reasons
      });

      for (const feature of record.bundle.deterministicFeatures) {
        decisions.push({
          candidateId: `${record.evidenceHash}/deterministic_feature/${feature.featureId}`,
          bundleHash: record.evidenceHash,
          publisher: record.bundle.source.publisher,
          sourceId: record.bundle.source.sourceId,
          runId: record.bundle.runId,
          correlationId: record.bundle.correlationId,
          receivedAtUnixMs: record.receivedAtUnixMs,
          kind: "deterministic_feature",
          localId: feature.featureId,
          rawConfidence: 0,
          sourceQuality: 0,
          provenanceQuality: 0,
          freshnessWeight: 0,
          score: null,
          status: "EXCLUDED",
          reasons
        });
      }
      const ctx = record.bundle.contextualEvidence;
      const claims = [
        ...ctx.supportResistance.map((x) => ({ id: x.evidenceId, kind: "supportResistance" })),
        ...ctx.flows.map((x) => ({ id: x.evidenceId, kind: "flows" })),
        ...ctx.derivatives.map((x) => ({ id: x.evidenceId, kind: "derivatives" })),
        ...ctx.events.map((x) => ({ id: x.evidenceId, kind: "events" })),
        ...ctx.newsRegulatory.map((x) => ({ id: x.evidenceId, kind: "newsRegulatory" }))
      ];
      for (const claim of claims) {
        decisions.push({
          candidateId: `${record.evidenceHash}/contextual_claim/${claim.id}`,
          bundleHash: record.evidenceHash,
          publisher: record.bundle.source.publisher,
          sourceId: record.bundle.source.sourceId,
          runId: record.bundle.runId,
          correlationId: record.bundle.correlationId,
          receivedAtUnixMs: record.receivedAtUnixMs,
          kind: "contextual_claim",
          localId: claim.id,
          rawConfidence: 0,
          sourceQuality: 0,
          provenanceQuality: 0,
          freshnessWeight: 0,
          score: null,
          status: "EXCLUDED",
          reasons
        });
      }
      decisions.push({
        candidateId: `${record.evidenceHash}/research_brief/${record.bundle.researchBrief ? record.bundle.researchBrief.briefId : "<unavailable>"}`,
        bundleHash: record.evidenceHash,
        publisher: record.bundle.source.publisher,
        sourceId: record.bundle.source.sourceId,
        runId: record.bundle.runId,
        correlationId: record.bundle.correlationId,
        receivedAtUnixMs: record.receivedAtUnixMs,
        kind: "research_brief",
        localId: record.bundle.researchBrief
          ? record.bundle.researchBrief.briefId
          : "<unavailable>",
        rawConfidence: 0,
        sourceQuality: 0,
        provenanceQuality: 0,
        freshnessWeight: 0,
        score: null,
        status: "EXCLUDED",
        reasons
      });

      continue;
    }

    // Bundle is ACCEPTED
    bundles.push({
      bundleHash: record.evidenceHash,
      publisher: record.bundle.source.publisher,
      sourceId: record.bundle.source.sourceId,
      runId: record.bundle.runId,
      correlationId: record.bundle.correlationId,
      receivedAtUnixMs: record.receivedAtUnixMs,
      status: "ACCEPTED",
      reasons: []
    });

    // Populate source references
    for (const ref of record.bundle.sourceReferences) {
      selectedSourceRefs.set(ref.referenceId, {
        referenceId: ref.referenceId,
        sourceType: ref.sourceType,
        locator: ref.locator,
        observedAt: ref.observedAt
      });
    }

    // Score deterministic features
    for (const feature of record.bundle.deterministicFeatures) {
      const candidateId = `${record.evidenceHash}/deterministic_feature/${feature.featureId}`;
      if (feature.status === "unavailable") {
        decisions.push({
          candidateId,
          bundleHash: record.evidenceHash,
          publisher: record.bundle.source.publisher,
          sourceId: record.bundle.source.sourceId,
          runId: record.bundle.runId,
          correlationId: record.bundle.correlationId,
          receivedAtUnixMs: record.receivedAtUnixMs,
          kind: "deterministic_feature",
          localId: feature.featureId,
          rawConfidence: 0,
          sourceQuality,
          provenanceQuality: 0,
          freshnessWeight: 0,
          score: null,
          status: "EXCLUDED",
          reasons: ["FEATURE_UNAVAILABLE"]
        });
        continue;
      }
      if (feature.status === "invalid") {
        decisions.push({
          candidateId,
          bundleHash: record.evidenceHash,
          publisher: record.bundle.source.publisher,
          sourceId: record.bundle.source.sourceId,
          runId: record.bundle.runId,
          correlationId: record.bundle.correlationId,
          receivedAtUnixMs: record.receivedAtUnixMs,
          kind: "deterministic_feature",
          localId: feature.featureId,
          rawConfidence: 0,
          sourceQuality,
          provenanceQuality: 0,
          freshnessWeight: 0,
          score: null,
          status: "EXCLUDED",
          reasons: ["FEATURE_INVALID"]
        });
        continue;
      }

      // Feature is available
      const isFeatureFresh = selectedAtUnixMs <= Date.parse(feature.freshUntil);
      const isBundleFresh = computedLifecycle === "FRESH";
      const freshnessWeight =
        isBundleFresh && isFeatureFresh ? 10_000 : validatedPolicy.staleWeightBps;

      const provenanceQuality = validatedPolicy.provenanceQualityBps.deterministic_calculator;

      const scoreNumerator =
        BigInt(feature.confidenceBps) *
        BigInt(sourceQuality) *
        BigInt(provenanceQuality) *
        BigInt(freshnessWeight);
      const scoreDenominator = 10_000n ** 3n;
      const scoreBig = scoreNumerator / scoreDenominator;
      if (scoreBig < 0n || scoreBig > 10_000n) {
        throw new Error("Impossible final score");
      }
      const score = Number(scoreBig);

      const reasons: string[] = [];
      if (freshnessWeight === validatedPolicy.staleWeightBps) {
        reasons.push("STALE_EVIDENCE_DOWNWEIGHTED");
      }

      registerCandidate({
        candidateId,
        bundleHash: record.evidenceHash,
        publisher: record.bundle.source.publisher,
        sourceId: record.bundle.source.sourceId,
        runId: record.bundle.runId,
        correlationId: record.bundle.correlationId,
        receivedAtUnixMs: record.receivedAtUnixMs,
        kind: "deterministic_feature",
        localId: feature.featureId,
        originalItem: feature,
        rawConfidence: feature.confidenceBps,
        sourceQuality,
        provenanceQuality,
        freshnessWeight,
        score,
        sourceReferenceIds: feature.inputLineage,
        reasons,
        family: feature.family,
        value: feature.value
      });
    }

    // Score contextual claims
    const ctx = record.bundle.contextualEvidence;
    const allClaims = [
      ...ctx.supportResistance.map((x) => ({ claim: x, family: "supportResistance" })),
      ...ctx.flows.map((x) => ({ claim: x, family: "flows" })),
      ...ctx.derivatives.map((x) => ({ claim: x, family: "derivatives" })),
      ...ctx.events.map((x) => ({ claim: x, family: "events" })),
      ...ctx.newsRegulatory.map((x) => ({ claim: x, family: "newsRegulatory" }))
    ];

    for (const { claim, family } of allClaims) {
      const candidateId = `${record.evidenceHash}/contextual_claim/${claim.evidenceId}`;
      if (claim.expiresAt !== null && selectedAtUnixMs > Date.parse(claim.expiresAt)) {
        decisions.push({
          candidateId,
          bundleHash: record.evidenceHash,
          publisher: record.bundle.source.publisher,
          sourceId: record.bundle.source.sourceId,
          runId: record.bundle.runId,
          correlationId: record.bundle.correlationId,
          receivedAtUnixMs: record.receivedAtUnixMs,
          kind: "contextual_claim",
          localId: claim.evidenceId,
          rawConfidence: claim.confidenceBps,
          sourceQuality,
          provenanceQuality: validatedPolicy.provenanceQualityBps[claim.provenanceMethod],
          freshnessWeight: 0,
          score: null,
          status: "EXCLUDED",
          reasons: ["CLAIM_EXPIRED"]
        });
        continue;
      }

      const isBundleFresh = computedLifecycle === "FRESH";
      const freshnessWeight = isBundleFresh ? 10_000 : validatedPolicy.staleWeightBps;
      const provenanceQuality = validatedPolicy.provenanceQualityBps[claim.provenanceMethod];

      const scoreNumerator =
        BigInt(claim.confidenceBps) *
        BigInt(sourceQuality) *
        BigInt(provenanceQuality) *
        BigInt(freshnessWeight);
      const scoreDenominator = 10_000n ** 3n;
      const scoreBig = scoreNumerator / scoreDenominator;
      if (scoreBig < 0n || scoreBig > 10_000n) {
        throw new Error("Impossible final score");
      }
      const score = Number(scoreBig);

      const reasons: string[] = [];
      if (freshnessWeight === validatedPolicy.staleWeightBps) {
        reasons.push("STALE_EVIDENCE_DOWNWEIGHTED");
      }

      registerCandidate({
        candidateId,
        bundleHash: record.evidenceHash,
        publisher: record.bundle.source.publisher,
        sourceId: record.bundle.source.sourceId,
        runId: record.bundle.runId,
        correlationId: record.bundle.correlationId,
        receivedAtUnixMs: record.receivedAtUnixMs,
        kind: "contextual_claim",
        localId: claim.evidenceId,
        originalItem: claim,
        rawConfidence: claim.confidenceBps,
        sourceQuality,
        provenanceQuality,
        freshnessWeight,
        score,
        sourceReferenceIds: claim.sourceReferenceIds,
        reasons,
        family,
        direction: claim.direction
      });
    }

    // Process research brief
    if (record.bundle.researchBrief) {
      const brief = record.bundle.researchBrief;
      const candidateId = `${record.evidenceHash}/research_brief/${brief.briefId}`;
      const isBundleFresh = computedLifecycle === "FRESH";
      const freshnessWeight = isBundleFresh ? 10_000 : validatedPolicy.staleWeightBps;

      const reasons = isBundleFresh
        ? ["fresh_inclusion"]
        : ["stale_inclusion", "STALE_EVIDENCE_DOWNWEIGHTED"];

      registerCandidate({
        candidateId,
        bundleHash: record.evidenceHash,
        publisher: record.bundle.source.publisher,
        sourceId: record.bundle.source.sourceId,
        runId: record.bundle.runId,
        correlationId: record.bundle.correlationId,
        receivedAtUnixMs: record.receivedAtUnixMs,
        kind: "research_brief",
        localId: brief.briefId,
        originalItem: brief,
        rawConfidence: 10000,
        sourceQuality,
        provenanceQuality: 10000,
        freshnessWeight,
        score: null, // research brief has no score
        sourceReferenceIds: brief.sourceEvidenceIds,
        reasons,
        family: "researchBrief"
      });
    } else {
      const candidateId = `${record.evidenceHash}/research_brief/<unavailable>`;
      decisions.push({
        candidateId,
        bundleHash: record.evidenceHash,
        publisher: record.bundle.source.publisher,
        sourceId: record.bundle.source.sourceId,
        runId: record.bundle.runId,
        correlationId: record.bundle.correlationId,
        receivedAtUnixMs: record.receivedAtUnixMs,
        kind: "research_brief",
        localId: "<unavailable>",
        rawConfidence: 0,
        sourceQuality: 0,
        provenanceQuality: 0,
        freshnessWeight: 0,
        score: null,
        status: "EXCLUDED",
        reasons: ["brief_unavailable"]
      });
    }
  }

  // Resolve selection, thresholding, and family caps
  const selectedDeterministic: SelectedDeterministicFeature[] = [];
  const selectedSR: SelectedContextualClaim[] = [];
  const selectedFlows: SelectedContextualClaim[] = [];
  const selectedDerivatives: SelectedContextualClaim[] = [];
  const selectedEvents: SelectedContextualClaim[] = [];
  const selectedNews: SelectedContextualClaim[] = [];
  let selectedBrief: SelectedResearchBrief | null = null;

  const countForCoverage: Record<string, number> = {
    deterministic: 0,
    supportResistance: 0,
    flows: 0,
    derivatives: 0,
    events: 0,
    newsRegulatory: 0,
    researchBrief: 0
  };

  let detAvailable = 0;
  let detUnavailable = 0;
  let detInvalid = 0;

  for (const record of sortedRecords) {
    for (const f of record.bundle.deterministicFeatures) {
      if (f.status === "available") detAvailable++;
      else if (f.status === "unavailable") detUnavailable++;
      else if (f.status === "invalid") detInvalid++;
    }
  }

  for (const [familyName, candList] of candidatesByFamily.entries()) {
    // 1. Filter out under threshold (for scored items)
    const thresholdPassed: IntermediateCandidate[] = [];
    for (const c of candList) {
      if (c.score === null) {
        // research brief bypasses threshold
        thresholdPassed.push(c);
        continue;
      }
      if (c.score >= validatedPolicy.minimumEffectiveScoreBps) {
        thresholdPassed.push(c);
      } else {
        decisions.push({
          candidateId: c.candidateId,
          bundleHash: c.bundleHash,
          publisher: c.publisher,
          sourceId: c.sourceId,
          runId: c.runId,
          correlationId: c.correlationId,
          receivedAtUnixMs: c.receivedAtUnixMs,
          kind: c.kind,
          localId: c.localId,
          rawConfidence: c.rawConfidence,
          sourceQuality: c.sourceQuality,
          provenanceQuality: c.provenanceQuality,
          freshnessWeight: c.freshnessWeight,
          score: c.score,
          status: "EXCLUDED",
          reasons: [...c.reasons, "score_threshold"]
        });
      }
    }

    // 2. Sort by score desc, then candidateId asc
    thresholdPassed.sort((a, b) => {
      const scoreA = a.score ?? 100000;
      const scoreB = b.score ?? 100000;
      if (scoreA !== scoreB) {
        return scoreB - scoreA;
      }
      if (a.candidateId < b.candidateId) return -1;
      if (a.candidateId > b.candidateId) return 1;
      return 0;
    });

    // 3. Apply family cap
    for (let i = 0; i < thresholdPassed.length; i++) {
      const c = thresholdPassed[i];
      if (i < validatedPolicy.maxSelectedPerFamily) {
        // SELECTED
        const inclusionReason =
          c.freshnessWeight === validatedPolicy.staleWeightBps
            ? "stale_inclusion"
            : "fresh_inclusion";
        const finalReasons = [...c.reasons];
        if (!finalReasons.includes(inclusionReason) && c.kind !== "research_brief") {
          finalReasons.push(inclusionReason);
        }

        decisions.push({
          candidateId: c.candidateId,
          bundleHash: c.bundleHash,
          publisher: c.publisher,
          sourceId: c.sourceId,
          runId: c.runId,
          correlationId: c.correlationId,
          receivedAtUnixMs: c.receivedAtUnixMs,
          kind: c.kind,
          localId: c.localId,
          rawConfidence: c.rawConfidence,
          sourceQuality: c.sourceQuality,
          provenanceQuality: c.provenanceQuality,
          freshnessWeight: c.freshnessWeight,
          score: c.score,
          status: "SELECTED",
          reasons: finalReasons
        });

        countForCoverage[
          familyName === "researchBrief"
            ? "researchBrief"
            : c.kind === "deterministic_feature"
              ? "deterministic"
              : familyName
        ]++;

        if (c.kind === "deterministic_feature") {
          selectedDeterministic.push({
            candidateId: c.candidateId,
            bundleHash: c.bundleHash,
            publisher: c.publisher,
            sourceId: c.sourceId,
            runId: c.runId,
            correlationId: c.correlationId,
            receivedAtUnixMs: c.receivedAtUnixMs,
            originalItem: c.originalItem as DeterministicFeature,
            featureId: c.localId,
            family: c.family,
            value: c.value!,
            rawConfidence: c.rawConfidence,
            sourceQuality: c.sourceQuality,
            provenanceQuality: c.provenanceQuality,
            freshnessWeight: c.freshnessWeight,
            score: c.score!,
            sourceReferenceIds: c.sourceReferenceIds,
            status: "SELECTED",
            reasons: finalReasons
          });
        } else if (c.kind === "contextual_claim") {
          const item = c.originalItem as
            | SupportResistanceClaim
            | FlowClaim
            | DerivativesClaim
            | EventClaim
            | NewsRegulatoryClaim;
          const selectedClaim: SelectedContextualClaim = {
            candidateId: c.candidateId,
            bundleHash: c.bundleHash,
            publisher: c.publisher,
            sourceId: c.sourceId,
            runId: c.runId,
            correlationId: c.correlationId,
            receivedAtUnixMs: c.receivedAtUnixMs,
            originalItem: item,
            evidenceId: c.localId,
            claim: item.claim,
            direction: c.direction!,
            rawConfidence: c.rawConfidence,
            sourceQuality: c.sourceQuality,
            provenanceQuality: c.provenanceQuality,
            freshnessWeight: c.freshnessWeight,
            score: c.score!,
            sourceReferenceIds: c.sourceReferenceIds,
            status: "SELECTED",
            reasons: finalReasons
          };

          if (familyName === "supportResistance") selectedSR.push(selectedClaim);
          else if (familyName === "flows") selectedFlows.push(selectedClaim);
          else if (familyName === "derivatives") selectedDerivatives.push(selectedClaim);
          else if (familyName === "events") selectedEvents.push(selectedClaim);
          else if (familyName === "newsRegulatory") selectedNews.push(selectedClaim);
        } else if (c.kind === "research_brief") {
          const item = c.originalItem as ResearchBrief;
          selectedBrief = {
            candidateId: c.candidateId,
            bundleHash: c.bundleHash,
            publisher: c.publisher,
            sourceId: c.sourceId,
            runId: c.runId,
            correlationId: c.correlationId,
            receivedAtUnixMs: c.receivedAtUnixMs,
            originalItem: item,
            briefId: c.localId,
            summary: item.summary,
            rawConfidence: c.rawConfidence,
            sourceQuality: c.sourceQuality,
            provenanceQuality: c.provenanceQuality,
            freshnessWeight: c.freshnessWeight,
            score: null,
            sourceReferenceIds: c.sourceReferenceIds,
            status: "SELECTED",
            reasons: finalReasons
          };
        }
      } else {
        // EXCLUDED due to cap
        decisions.push({
          candidateId: c.candidateId,
          bundleHash: c.bundleHash,
          publisher: c.publisher,
          sourceId: c.sourceId,
          runId: c.runId,
          correlationId: c.correlationId,
          receivedAtUnixMs: c.receivedAtUnixMs,
          kind: c.kind,
          localId: c.localId,
          rawConfidence: c.rawConfidence,
          sourceQuality: c.sourceQuality,
          provenanceQuality: c.provenanceQuality,
          freshnessWeight: c.freshnessWeight,
          score: c.score,
          status: "EXCLUDED",
          reasons: [...c.reasons, "family_cap"]
        });
      }
    }
  }

  // Sort decisions by candidateId ascending to keep deterministic
  decisions.sort((a, b) => (a.candidateId < b.candidateId ? -1 : 1));

  // Determine mode
  let mode: "FULL" | "PARTIAL" | "DEGRADED_NO_RESEARCH" = "FULL";
  const hasDeterministic = countForCoverage.deterministic > 0;
  const hasSR = countForCoverage.supportResistance > 0;
  const hasFlows = countForCoverage.flows > 0;
  const hasDerivatives = countForCoverage.derivatives > 0;
  const hasEvents = countForCoverage.events > 0;
  const hasNews = countForCoverage.newsRegulatory > 0;
  const hasBrief = selectedBrief !== null;

  if (!hasBrief) {
    mode = "DEGRADED_NO_RESEARCH";
  } else if (
    !hasDeterministic ||
    !hasSR ||
    !hasFlows ||
    !hasDerivatives ||
    !hasEvents ||
    !hasNews
  ) {
    mode = "PARTIAL";
  }

  // Warnings
  const warnings: SelectionWarning[] = [];
  let hasStaleInput = false;

  const checkStale = (s: { freshnessWeight: number }) => {
    if (s.freshnessWeight === validatedPolicy.staleWeightBps) {
      hasStaleInput = true;
    }
  };
  selectedDeterministic.forEach(checkStale);
  selectedSR.forEach(checkStale);
  selectedFlows.forEach(checkStale);
  selectedDerivatives.forEach(checkStale);
  selectedEvents.forEach(checkStale);
  selectedNews.forEach(checkStale);

  if (hasStaleInput) {
    warnings.push({
      code: "stale_input",
      message: "Stale input evidence was selected and downweighted"
    });
  }
  if (!hasBrief) {
    warnings.push({ code: "no_selected_research", message: "No research brief was selected" });
  }

  const expectedFamilies = [
    "deterministic",
    "supportResistance",
    "flows",
    "derivatives",
    "events",
    "newsRegulatory"
  ];
  for (const fam of expectedFamilies) {
    if (countForCoverage[fam] === 0) {
      warnings.push({
        code: "missing_family",
        message: `Family ${fam} is missing from selected evidence`
      });
    }
  }

  return {
    selectionPolicyVersion: validatedPolicy.version,
    selectedAtUnixMs,
    pair: "SOL/USDC",
    scope,
    authority: "ADVISORY_ONLY",
    mode,
    selected: {
      deterministicFeatures: selectedDeterministic,
      contextualEvidence: {
        supportResistance: selectedSR,
        flows: selectedFlows,
        derivatives: selectedDerivatives,
        events: selectedEvents,
        newsRegulatory: selectedNews
      },
      researchBrief: selectedBrief
    },
    familyCoverage: {
      deterministicCount: countForCoverage.deterministic,
      supportResistanceCount: countForCoverage.supportResistance,
      flowsCount: countForCoverage.flows,
      derivativesCount: countForCoverage.derivatives,
      eventsCount: countForCoverage.events,
      newsRegulatoryCount: countForCoverage.newsRegulatory,
      researchBriefCount: countForCoverage.researchBrief
    },
    deterministicEvidenceCoverage: {
      availableCount: detAvailable,
      unavailableCount: detUnavailable,
      invalidCount: detInvalid
    },
    conflicts: [],
    warnings,
    sourceReferences: [...selectedSourceRefs.values()].sort((a, b) =>
      a.referenceId < b.referenceId ? -1 : 1
    ),
    bundles,
    decisions
  };
}
