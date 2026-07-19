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
  readonly sourceEvidenceIds: readonly string[];
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
  readonly consensus: number;
  readonly totals: {
    readonly bullish: number;
    readonly bearish: number;
  };
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
  readonly bundleHash: string;
  readonly publisher: string;
  readonly sourceId: string;
  readonly runId: string;
  readonly correlationId: string;
  readonly receivedAtUnixMs: number;
  readonly isSelectedLineage: boolean;
  readonly isAuditOnly: boolean;
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
  readonly status: "INCLUDED" | "EXCLUDED";
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
    asOf: string;
    observedAt: string | null;
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
        asOf: record.bundle.asOf,
        observedAt: feature.observedAt,
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
        asOf: record.bundle.asOf,
        observedAt: (claim as { observedAt?: string | null }).observedAt ?? null,
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
        asOf: record.bundle.asOf,
        observedAt: brief.generatedAt,
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
        reasons: ["RESEARCH_BRIEF_UNAVAILABLE"]
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

  // A map of qualified candidateId -> IntermediateCandidate to easily retrieve candidate details
  const allRegisteredCandidates = new Map<string, IntermediateCandidate>();
  for (const [, list] of candidatesByFamily.entries()) {
    for (const c of list) {
      allRegisteredCandidates.set(c.candidateId, c);
    }
  }

  const decisionMap = new Map<string, EvidenceSelectionDecision>();

  // Helper to build a complete decision object
  const buildDecisionObj = (
    c: IntermediateCandidate,
    status: "INCLUDED" | "EXCLUDED",
    reasons: readonly string[],
    score: number | null
  ): EvidenceSelectionDecision => ({
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
    score,
    status,
    reasons
  });

  // 1. Populate decisionMap with initial exclusions
  for (const dec of decisions) {
    decisionMap.set(dec.candidateId, dec);
  }

  // 2. Filter non-brief family candidates by threshold and sort by documented tie-breakers
  const preliminaryInclusions = new Map<string, IntermediateCandidate>();

  for (const [familyName, candList] of candidatesByFamily.entries()) {
    if (familyName === "researchBrief") {
      continue;
    }

    const thresholdPassed: IntermediateCandidate[] = [];
    for (const c of candList) {
      if (c.score === null) {
        thresholdPassed.push(c);
        continue;
      }
      if (c.score >= validatedPolicy.minimumEffectiveScoreBps) {
        thresholdPassed.push(c);
      } else {
        decisionMap.set(
          c.candidateId,
          buildDecisionObj(c, "EXCLUDED", [...c.reasons, "score_threshold"], c.score)
        );
      }
    }

    // Sort using full comparator: score desc, bundle asOf desc, item observedAt desc (null last), publisher/sourceId/localId/bundleHash asc
    thresholdPassed.sort((a, b) => {
      const scoreA = a.score ?? 0;
      const scoreB = b.score ?? 0;
      if (scoreA !== scoreB) {
        return scoreB - scoreA;
      }

      if (a.asOf !== b.asOf) {
        return a.asOf > b.asOf ? -1 : 1;
      }

      const obsA = a.observedAt;
      const obsB = b.observedAt;
      if (obsA !== obsB) {
        if (obsA === null || obsA === undefined) return 1;
        if (obsB === null || obsB === undefined) return -1;
        return obsA > obsB ? -1 : 1;
      }

      if (a.publisher !== b.publisher) {
        return a.publisher < b.publisher ? -1 : 1;
      }

      if (a.sourceId !== b.sourceId) {
        return a.sourceId < b.sourceId ? -1 : 1;
      }

      if (a.localId !== b.localId) {
        return a.localId < b.localId ? -1 : 1;
      }

      if (a.bundleHash !== b.bundleHash) {
        return a.bundleHash < b.bundleHash ? -1 : 1;
      }

      return 0;
    });

    for (let i = 0; i < thresholdPassed.length; i++) {
      const c = thresholdPassed[i];
      if (i < validatedPolicy.maxSelectedPerFamily) {
        preliminaryInclusions.set(c.candidateId, c);
      } else {
        decisionMap.set(
          c.candidateId,
          buildDecisionObj(c, "EXCLUDED", [...c.reasons, "FAMILY_SELECTION_LIMIT"], c.score)
        );
      }
    }
  }

  // 3. Repeatedly scan deterministic feature dependency closure until a pass makes no changes
  let changed = true;
  while (changed) {
    changed = false;
    const preliminaryFeatures = [...preliminaryInclusions.values()]
      .filter((c) => c.kind === "deterministic_feature")
      .sort((a, b) => (a.candidateId < b.candidateId ? -1 : 1));

    for (const feat of preliminaryFeatures) {
      const record = sortedRecords.find((r) => r.evidenceHash === feat.bundleHash)!;
      const bundle = record.bundle;
      const dependencies = feat.sourceReferenceIds; // feature.inputLineage

      let hasExcludedDependency = false;
      for (const depId of dependencies) {
        const isFeature = bundle.deterministicFeatures.some((f) => f.featureId === depId);
        if (isFeature) {
          const depCandidateId = `${feat.bundleHash}/deterministic_feature/${depId}`;
          const depDecision = decisionMap.get(depCandidateId);
          const isExcluded =
            (depDecision && depDecision.status === "EXCLUDED") ||
            !preliminaryInclusions.has(depCandidateId);
          if (isExcluded) {
            hasExcludedDependency = true;
            break;
          }
        }
      }

      if (hasExcludedDependency) {
        preliminaryInclusions.delete(feat.candidateId);
        decisionMap.set(
          feat.candidateId,
          buildDecisionObj(
            feat,
            "EXCLUDED",
            [...feat.reasons, "FEATURE_DEPENDENCY_EXCLUDED"],
            feat.score
          )
        );
        changed = true;
      }
    }
  }

  // 4. Finalize the non-brief preliminary inclusions as selected
  for (const [candId, c] of preliminaryInclusions.entries()) {
    const inclusionReason =
      c.freshnessWeight === validatedPolicy.staleWeightBps ? "stale_inclusion" : "fresh_inclusion";
    const finalReasons = [...c.reasons];
    if (!finalReasons.includes(inclusionReason)) {
      finalReasons.push(inclusionReason);
    }
    decisionMap.set(candId, buildDecisionObj(c, "INCLUDED", finalReasons, c.score));
  }

  // 5. Evaluate briefs after non-brief decisions are terminal
  const briefCandidates = candidatesByFamily.get("researchBrief") || [];
  for (const brief of briefCandidates) {
    const missingOrExcludedIds: string[] = [];
    const bundle = sortedRecords.find((r) => r.evidenceHash === brief.bundleHash)!.bundle;

    for (const refId of brief.sourceReferenceIds) {
      const featId = `${brief.bundleHash}/deterministic_feature/${refId}`;
      const claimId = `${brief.bundleHash}/contextual_claim/${refId}`;
      const featDec = decisionMap.get(featId);
      const claimDec = decisionMap.get(claimId);

      const isSelected =
        (featDec && featDec.status === "INCLUDED") || (claimDec && claimDec.status === "INCLUDED");
      if (!isSelected) {
        missingOrExcludedIds.push(refId);
      }
    }

    if (missingOrExcludedIds.length > 0) {
      missingOrExcludedIds.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      decisionMap.set(
        brief.candidateId,
        buildDecisionObj(
          brief,
          "EXCLUDED",
          ["BRIEF_REFERENCES_EXCLUDED_EVIDENCE", ...missingOrExcludedIds],
          null
        )
      );
    } else {
      let sum = 0;
      let count = 0;
      for (const refId of brief.sourceReferenceIds) {
        const featId = `${brief.bundleHash}/deterministic_feature/${refId}`;
        const claimId = `${brief.bundleHash}/contextual_claim/${refId}`;
        const dec = decisionMap.get(featId) ?? decisionMap.get(claimId);
        if (dec && dec.score !== null) {
          sum += dec.score;
          count++;
        }
      }
      const average = count > 0 ? Math.floor(sum / count) : 0;
      const computedScore = Math.min(bundle.assessment.overallConfidenceBps, average);

      if (computedScore >= validatedPolicy.minimumEffectiveScoreBps) {
        decisionMap.set(
          brief.candidateId,
          buildDecisionObj(brief, "INCLUDED", [...brief.reasons], computedScore)
        );
      } else {
        decisionMap.set(
          brief.candidateId,
          buildDecisionObj(brief, "EXCLUDED", [...brief.reasons, "score_threshold"], computedScore)
        );
      }
    }
  }

  // Re-populate selected lists and coverage counters based on final decisionMap status
  for (const [candId, dec] of decisionMap.entries()) {
    if (dec.status === "INCLUDED") {
      const c = allRegisteredCandidates.get(candId);
      if (!c) continue;

      countForCoverage[
        c.family === "researchBrief"
          ? "researchBrief"
          : c.kind === "deterministic_feature"
            ? "deterministic"
            : c.family
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
          score: dec.score!,
          sourceReferenceIds: c.sourceReferenceIds,
          status: "SELECTED",
          reasons: dec.reasons
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
          score: dec.score!,
          sourceReferenceIds: c.sourceReferenceIds,
          status: "SELECTED",
          reasons: dec.reasons
        };

        if (c.family === "supportResistance") selectedSR.push(selectedClaim);
        else if (c.family === "flows") selectedFlows.push(selectedClaim);
        else if (c.family === "derivatives") selectedDerivatives.push(selectedClaim);
        else if (c.family === "events") selectedEvents.push(selectedClaim);
        else if (c.family === "newsRegulatory") selectedNews.push(selectedClaim);
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
          score: dec.score,
          sourceEvidenceIds: c.sourceReferenceIds,
          status: "SELECTED",
          reasons: dec.reasons
        };
      }
    }
  }

  // Clear and rebuild decisions array to ensure it matches decisionMap
  decisions.length = 0;
  decisions.push(...decisionMap.values());

  // Sort decisions by candidateId ascending to keep deterministic
  decisions.sort((a, b) => (a.candidateId < b.candidateId ? -1 : 1));

  // 5. Derive coverage, modes, warnings, conflicts, and canonically sort the result

  const contextualFamilies = [
    "supportResistance",
    "flows",
    "derivatives",
    "events",
    "newsRegulatory"
  ] as const;

  const familyClaimsMap = {
    supportResistance: selectedSR,
    flows: selectedFlows,
    derivatives: selectedDerivatives,
    events: selectedEvents,
    newsRegulatory: selectedNews
  };

  const familyStatus: Record<string, "MISSING" | "REJECTED" | "CONFLICTED" | "AVAILABLE"> = {};

  // For every contextual family, derive AVAILABLE/CONFLICTED, REJECTED, and MISSING
  for (const fam of contextualFamilies) {
    const candidates = candidatesByFamily.get(fam) || [];
    if (candidates.length === 0) {
      familyStatus[fam] = "MISSING";
    } else {
      const selectedList = familyClaimsMap[fam];
      if (selectedList.length === 0) {
        familyStatus[fam] = "REJECTED";
      } else {
        const hasBullish = selectedList.some((c) => c.direction.toLowerCase() === "bullish");
        const hasBearish = selectedList.some((c) => c.direction.toLowerCase() === "bearish");
        if (hasBullish && hasBearish) {
          familyStatus[fam] = "CONFLICTED";
        } else {
          familyStatus[fam] = "AVAILABLE";
        }
      }
    }
  }

  // Derive deterministic family coverage status separately
  let deterministicStatus: "MISSING" | "REJECTED" | "AVAILABLE" = "AVAILABLE";
  const detCandidates = candidatesByFamily.get("deterministic") || [];
  if (detCandidates.length === 0) {
    deterministicStatus = "MISSING";
  } else if (selectedDeterministic.length === 0) {
    deterministicStatus = "REJECTED";
  }

  // Determine mode
  // FULL: all five contextual families are AVAILABLE, and brief is selected
  // PARTIAL: not FULL, and at least one contextual claim or brief is selected
  // DEGRADED_NO_RESEARCH: neither contextual claims nor brief survive
  const allContextualAvailable = contextualFamilies.every(
    (fam) => familyStatus[fam] === "AVAILABLE"
  );
  const briefSelected = selectedBrief !== null;

  let mode: "FULL" | "PARTIAL" | "DEGRADED_NO_RESEARCH";
  if (allContextualAvailable && briefSelected) {
    mode = "FULL";
  } else {
    const hasAnySelectedContextual = contextualFamilies.some(
      (fam) => familyClaimsMap[fam].length > 0
    );
    if (hasAnySelectedContextual || briefSelected) {
      mode = "PARTIAL";
    } else {
      mode = "DEGRADED_NO_RESEARCH";
    }
  }

  // Conflicts
  const conflicts: ConflictSummary[] = [];
  for (const fam of contextualFamilies) {
    if (familyStatus[fam] === "CONFLICTED") {
      const selectedList = familyClaimsMap[fam];
      const affectedCandidates = selectedList
        .filter(
          (c) => c.direction.toLowerCase() === "bullish" || c.direction.toLowerCase() === "bearish"
        )
        .map((c) => c.candidateId)
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

      let bullish = 0;
      let bearish = 0;
      for (const c of selectedList) {
        if (c.direction.toLowerCase() === "bullish") {
          bullish += c.score;
        } else if (c.direction.toLowerCase() === "bearish") {
          bearish += c.score;
        }
      }
      const consensus = Math.floor((Math.abs(bullish - bearish) * 10000) / (bullish + bearish));

      conflicts.push({
        conflictType: "family_conflict",
        message: `Family ${fam} has conflicting bullish and bearish claims`,
        affectedCandidates,
        consensus,
        totals: {
          bullish,
          bearish
        }
      });
    }
  }
  conflicts.sort((a, b) => (a.message < b.message ? -1 : a.message > b.message ? 1 : 0));

  // Warnings
  const rawWarnings: SelectionWarning[] = [];

  // 1. stale_input
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
  if (selectedBrief) checkStale(selectedBrief);

  if (hasStaleInput) {
    rawWarnings.push({
      code: "stale_input",
      message: "Stale input evidence was selected and downweighted"
    });
  }

  // 2. conflicted_family
  for (const fam of contextualFamilies) {
    if (familyStatus[fam] === "CONFLICTED") {
      rawWarnings.push({
        code: "conflicted_family",
        message: `Family ${fam} has conflicting bullish and bearish claims`
      });
    }
  }

  // 3. missing_family / rejected_family
  // Include deterministic family in warnings
  if (deterministicStatus === "MISSING") {
    rawWarnings.push({
      code: "missing_family",
      message: "Family deterministic is missing from selected evidence"
    });
  } else if (deterministicStatus === "REJECTED") {
    rawWarnings.push({
      code: "rejected_family",
      message: "Family deterministic has candidates but none were selected"
    });
  }

  for (const fam of contextualFamilies) {
    if (familyStatus[fam] === "MISSING") {
      rawWarnings.push({
        code: "missing_family",
        message: `Family ${fam} is missing from selected evidence`
      });
    } else if (familyStatus[fam] === "REJECTED") {
      rawWarnings.push({
        code: "rejected_family",
        message: `Family ${fam} has candidates but none were selected`
      });
    }
  }

  // 4. no_selected_research
  if (!briefSelected) {
    rawWarnings.push({
      code: "no_selected_research",
      message: "No research brief was selected"
    });
  }

  // Deduplicate warnings by code plus message
  const seenWarnings = new Set<string>();
  const warnings: SelectionWarning[] = [];
  for (const w of rawWarnings) {
    const key = `${w.code}:${w.message}`;
    if (!seenWarnings.has(key)) {
      seenWarnings.add(key);
      warnings.push(w);
    }
  }

  // Sort warnings: code rank, family rank, message string
  const CODE_RANK: Record<string, number> = {
    stale_input: 1,
    conflicted_family: 2,
    missing_family: 3,
    rejected_family: 4,
    no_selected_research: 5
  };

  const FAMILY_RANK: Record<string, number> = {
    deterministic: 1,
    supportResistance: 2,
    flows: 3,
    derivatives: 4,
    events: 5,
    newsRegulatory: 6,
    researchBrief: 7
  };

  function getFamilyFromWarning(w: SelectionWarning): string {
    if (w.message.includes("deterministic")) return "deterministic";
    if (w.message.includes("supportResistance")) return "supportResistance";
    if (w.message.includes("flows")) return "flows";
    if (w.message.includes("derivatives")) return "derivatives";
    if (w.message.includes("events")) return "events";
    if (w.message.includes("newsRegulatory")) return "newsRegulatory";
    if (w.code === "no_selected_research") return "researchBrief";
    return "";
  }

  warnings.sort((a, b) => {
    const codeRankA = CODE_RANK[a.code] ?? 999;
    const codeRankB = CODE_RANK[b.code] ?? 999;
    if (codeRankA !== codeRankB) return codeRankA - codeRankB;

    const famA = getFamilyFromWarning(a);
    const famB = getFamilyFromWarning(b);
    const famRankA = FAMILY_RANK[famA] ?? 999;
    const famRankB = FAMILY_RANK[famB] ?? 999;
    if (famRankA !== famRankB) return famRankA - famRankB;

    return a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
  });

  // 6. Build the qualified source-reference union
  interface MutableSelectedSourceReference {
    referenceId: string;
    sourceType: string;
    locator: string;
    observedAt: string;
    bundleHash: string;
    publisher: string;
    sourceId: string;
    runId: string;
    correlationId: string;
    receivedAtUnixMs: number;
    isSelectedLineage: boolean;
    isAuditOnly: boolean;
  }

  const referenceUnion = new Map<string, MutableSelectedSourceReference>();

  const getRefEntry = (
    refId: string,
    record: EvidenceBundleRecord
  ): MutableSelectedSourceReference | null => {
    const bundle = record.bundle;
    const bundleHash = record.evidenceHash;
    const key = `${bundleHash}/${refId}`;
    if (!referenceUnion.has(key)) {
      const ref = bundle.sourceReferences.find((r) => r.referenceId === refId);
      if (!ref) return null;
      referenceUnion.set(key, {
        referenceId: ref.referenceId,
        sourceType: ref.sourceType,
        locator: ref.locator,
        observedAt: ref.observedAt,
        bundleHash,
        publisher: bundle.source.publisher,
        sourceId: bundle.source.sourceId,
        runId: bundle.runId,
        correlationId: bundle.correlationId,
        receivedAtUnixMs: record.receivedAtUnixMs,
        isSelectedLineage: false,
        isAuditOnly: false
      });
    }
    return referenceUnion.get(key)!;
  };

  for (const record of sortedRecords) {
    const bundle = record.bundle;
    const bundleHash = record.evidenceHash;

    // Scan all deterministic features in this bundle
    for (const feature of bundle.deterministicFeatures) {
      const candidateId = `${bundleHash}/deterministic_feature/${feature.featureId}`;
      const dec = decisionMap.get(candidateId);
      if (!dec) continue;

      for (const refId of feature.inputLineage) {
        const entry = getRefEntry(refId, record);
        if (entry) {
          if (dec.status === "INCLUDED") {
            entry.isSelectedLineage = true;
          } else {
            entry.isAuditOnly = true;
          }
        }
      }
    }

    // Scan all contextual claims in this bundle
    const ctx = bundle.contextualEvidence;
    const allClaims = [
      ...ctx.supportResistance,
      ...ctx.flows,
      ...ctx.derivatives,
      ...ctx.events,
      ...ctx.newsRegulatory
    ];
    for (const claim of allClaims) {
      const candidateId = `${bundleHash}/contextual_claim/${claim.evidenceId}`;
      const dec = decisionMap.get(candidateId);
      if (!dec) continue;

      for (const refId of claim.sourceReferenceIds) {
        const entry = getRefEntry(refId, record);
        if (entry) {
          if (dec.status === "INCLUDED") {
            entry.isSelectedLineage = true;
          } else {
            entry.isAuditOnly = true;
          }
        }
      }
    }
  }

  const sortedSourceRefs = [...referenceUnion.values()].sort((a, b) => {
    if (a.publisher !== b.publisher) return a.publisher < b.publisher ? -1 : 1;
    if (a.sourceId !== b.sourceId) return a.sourceId < b.sourceId ? -1 : 1;
    if (a.bundleHash !== b.bundleHash) return a.bundleHash < b.bundleHash ? -1 : 1;
    if (a.referenceId !== b.referenceId) return a.referenceId < b.referenceId ? -1 : 1;
    return 0;
  });

  // Canonically normalize and sort the arrays
  // Do not sort publisher-owned arrays inside original item objects in place; clone them.
  const finalDeterministic = selectedDeterministic
    .map((f) => {
      const originalItem = {
        ...f.originalItem,
        inputLineage: [...f.originalItem.inputLineage].sort((a, b) =>
          a < b ? -1 : a > b ? 1 : 0
        ) as [string, ...string[]],
        warnings: f.originalItem.warnings
          ? [...f.originalItem.warnings].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
          : undefined
      };
      return {
        ...f,
        sourceReferenceIds: [...f.sourceReferenceIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
        originalItem: originalItem as unknown as SelectedDeterministicFeature["originalItem"]
      };
    })
    .sort((a, b) => (a.candidateId < b.candidateId ? -1 : a.candidateId > b.candidateId ? 1 : 0));

  const normalizeContextualClaim = (c: SelectedContextualClaim) => {
    const originalItem = {
      ...c.originalItem,
      sourceReferenceIds: [...c.originalItem.sourceReferenceIds].sort((a, b) =>
        a < b ? -1 : a > b ? 1 : 0
      ) as [string, ...string[]]
    };
    return {
      ...c,
      sourceReferenceIds: [...c.sourceReferenceIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      originalItem: originalItem as unknown as SelectedContextualClaim["originalItem"]
    };
  };

  const finalSR = selectedSR
    .map(normalizeContextualClaim)
    .sort((a, b) => (a.candidateId < b.candidateId ? -1 : a.candidateId > b.candidateId ? 1 : 0));
  const finalFlows = selectedFlows
    .map(normalizeContextualClaim)
    .sort((a, b) => (a.candidateId < b.candidateId ? -1 : a.candidateId > b.candidateId ? 1 : 0));
  const finalDerivatives = selectedDerivatives
    .map(normalizeContextualClaim)
    .sort((a, b) => (a.candidateId < b.candidateId ? -1 : a.candidateId > b.candidateId ? 1 : 0));
  const finalEvents = selectedEvents
    .map(normalizeContextualClaim)
    .sort((a, b) => (a.candidateId < b.candidateId ? -1 : a.candidateId > b.candidateId ? 1 : 0));
  const finalNews = selectedNews
    .map(normalizeContextualClaim)
    .sort((a, b) => (a.candidateId < b.candidateId ? -1 : a.candidateId > b.candidateId ? 1 : 0));

  let finalBrief: SelectedResearchBrief | null = null;
  if (selectedBrief) {
    const originalItem = {
      ...selectedBrief.originalItem,
      sourceEvidenceIds: [...selectedBrief.originalItem.sourceEvidenceIds].sort((a, b) =>
        a < b ? -1 : a > b ? 1 : 0
      ) as [string, ...string[]],
      keyFindings: selectedBrief.originalItem.keyFindings
        ? [...selectedBrief.originalItem.keyFindings].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
        : [],
      uncertainties: selectedBrief.originalItem.uncertainties
        ? [...selectedBrief.originalItem.uncertainties].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
        : []
    };
    finalBrief = {
      ...selectedBrief,
      sourceEvidenceIds: [...selectedBrief.sourceEvidenceIds].sort((a, b) =>
        a < b ? -1 : a > b ? 1 : 0
      ),
      originalItem: originalItem as unknown as SelectedResearchBrief["originalItem"]
    };
  }

  const sortedBundles = [...bundles].sort((a, b) => {
    if (a.publisher !== b.publisher) return a.publisher < b.publisher ? -1 : 1;
    if (a.sourceId !== b.sourceId) return a.sourceId < b.sourceId ? -1 : 1;
    return a.bundleHash < b.bundleHash ? -1 : a.bundleHash > b.bundleHash ? 1 : 0;
  });

  const finalDecisions = [...decisions].sort((a, b) =>
    a.candidateId < b.candidateId ? -1 : a.candidateId > b.candidateId ? 1 : 0
  );

  // Assertions for integrity
  for (const candidateId of allRegisteredCandidates.keys()) {
    const decs = finalDecisions.filter((d) => d.candidateId === candidateId);
    if (decs.length !== 1) {
      throw new Error(
        `Candidate ${candidateId} must have exactly one decision, found ${decs.length}`
      );
    }
    const dec = decs[0];
    if (dec.status !== "INCLUDED" && dec.status !== "EXCLUDED") {
      throw new Error(`Decision for ${candidateId} has non-terminal status ${dec.status}`);
    }
  }

  const allSelectedCandidateIds = [
    ...finalDeterministic.map((f) => f.candidateId),
    ...finalSR.map((c) => c.candidateId),
    ...finalFlows.map((c) => c.candidateId),
    ...finalDerivatives.map((c) => c.candidateId),
    ...finalEvents.map((c) => c.candidateId),
    ...finalNews.map((c) => c.candidateId),
    ...(finalBrief ? [finalBrief.candidateId] : [])
  ];
  for (const candId of allSelectedCandidateIds) {
    const dec = finalDecisions.find((d) => d.candidateId === candId);
    if (!dec || dec.status !== "INCLUDED") {
      throw new Error(`Selected candidate ${candId} must map to an INCLUDED decision`);
    }
  }

  const allScores = [
    ...finalDeterministic.map((f) => f.score),
    ...finalSR.map((c) => c.score),
    ...finalFlows.map((c) => c.score),
    ...finalDerivatives.map((c) => c.score),
    ...finalEvents.map((c) => c.score),
    ...finalNews.map((c) => c.score),
    ...(finalBrief && finalBrief.score !== null ? [finalBrief.score] : []),
    ...finalDecisions.map((d) => d.score).filter((s): s is number => s !== null)
  ];
  for (const score of allScores) {
    if (!Number.isSafeInteger(score) || score < 0 || score > 10000) {
      throw new RangeError(`Score ${score} must be a safe integer in [0, 10000]`);
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
      deterministicFeatures: finalDeterministic,
      contextualEvidence: {
        supportResistance: finalSR,
        flows: finalFlows,
        derivatives: finalDerivatives,
        events: finalEvents,
        newsRegulatory: finalNews
      },
      researchBrief: finalBrief
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
    conflicts,
    warnings,
    sourceReferences: sortedSourceRefs,
    bundles: sortedBundles,
    decisions: finalDecisions
  };
}
