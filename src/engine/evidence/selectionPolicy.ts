export type ProvenanceClass =
  | "deterministic_calculator"
  | "derived"
  | "collected"
  | "human_authored";

export type EvidenceSelectionReasonCode =
  | "record_mismatch"
  | "bundle_expired"
  | "bundle_disabled"
  | "feature_unavailable"
  | "feature_invalid"
  | "feature_dependency_failure"
  | "claim_expired"
  | "score_threshold"
  | "family_cap"
  | "brief_unavailable"
  | "citation_failure"
  | "stale_inclusion"
  | "fresh_inclusion";

export type EvidenceSelectionWarningCode =
  | "stale_input"
  | "missing_family"
  | "rejected_family"
  | "conflicted_family"
  | "no_selected_research";

export interface EvidenceSelectionPolicy {
  readonly version: string;
  readonly minimumEffectiveScoreBps: number;
  readonly staleWeightBps: number;
  readonly maxSelectedPerFamily: number;
  readonly defaultSourceQualityBps: number;
  readonly sourceQualityBps: Readonly<Record<string, number>>;
  readonly provenanceQualityBps: Readonly<Record<ProvenanceClass, number>>;
}

export const EVIDENCE_SELECTION_POLICY_VERSION = "evidence-selection.v1" as const;

export const EVIDENCE_SELECTION_POLICY_V1: EvidenceSelectionPolicy = Object.freeze({
  version: EVIDENCE_SELECTION_POLICY_VERSION,
  minimumEffectiveScoreBps: 2_500,
  staleWeightBps: 5_000,
  maxSelectedPerFamily: 16,
  defaultSourceQualityBps: 5_000,
  sourceQualityBps: Object.freeze({}),
  provenanceQualityBps: Object.freeze({
    deterministic_calculator: 10_000,
    derived: 9_000,
    collected: 8_000,
    human_authored: 7_000
  })
});

export function evidenceSourceQualityKey(publisher: string, sourceId: string): string {
  return `${publisher.length}:${publisher}:${sourceId.length}:${sourceId}`;
}

function isValidBps(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 10_000
  );
}

function validateBpsField(value: unknown, fieldName: string): void {
  if (!isValidBps(value)) {
    throw new TypeError(
      `Invalid ${fieldName}: must be a finite integer in [0, 10000], got ${JSON.stringify(value)}`
    );
  }
}

export function validateEvidenceSelectionPolicy(
  policy: EvidenceSelectionPolicy
): EvidenceSelectionPolicy {
  if (typeof policy.version !== "string" || policy.version.trim().length === 0) {
    throw new TypeError(
      `Invalid version: must be non-blank string, got ${JSON.stringify(policy.version)}`
    );
  }

  validateBpsField(policy.minimumEffectiveScoreBps, "minimumEffectiveScoreBps");
  validateBpsField(policy.staleWeightBps, "staleWeightBps");
  validateBpsField(policy.defaultSourceQualityBps, "defaultSourceQualityBps");

  if (!Number.isInteger(policy.maxSelectedPerFamily) || policy.maxSelectedPerFamily <= 0) {
    throw new TypeError(
      `Invalid maxSelectedPerFamily: must be a positive integer, got ${JSON.stringify(policy.maxSelectedPerFamily)}`
    );
  }

  for (const [key, value] of Object.entries(policy.sourceQualityBps)) {
    validateBpsField(value, `sourceQualityBps[${key}]`);
  }

  const validProvenanceClasses: ProvenanceClass[] = [
    "deterministic_calculator",
    "derived",
    "collected",
    "human_authored"
  ];
  for (const pc of validProvenanceClasses) {
    validateBpsField(policy.provenanceQualityBps[pc], `provenanceQualityBps[${pc}]`);
  }

  return Object.freeze({
    version: policy.version,
    minimumEffectiveScoreBps: policy.minimumEffectiveScoreBps,
    staleWeightBps: policy.staleWeightBps,
    maxSelectedPerFamily: policy.maxSelectedPerFamily,
    defaultSourceQualityBps: policy.defaultSourceQualityBps,
    sourceQualityBps: Object.freeze({ ...policy.sourceQualityBps }),
    provenanceQualityBps: Object.freeze({ ...policy.provenanceQualityBps })
  });
}
