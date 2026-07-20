import type { PolicyInsightContent } from "../../contract/policyInsight/v1/types.generated.js";
import type { PolicySynthesisEnvelope } from "../../engine/policy/synthesizePolicyInsight.js";
import type { EvidenceSelectionDecision } from "../../engine/evidence/selectEvidence.js";

export interface NewPolicyInsightRecord {
  readonly insightId: string;
  readonly schemaVersion: string;
  readonly rulesetVersion: string;
  readonly pair: string;
  readonly scopeKey: string;
  readonly positionId: string | null;
  readonly generatedAtUnixMs: number;
  readonly asOfUnixMs: number;
  readonly expiresAtUnixMs: number;
  readonly persistedAtUnixMs: number;
  readonly marketHash: string;
  readonly positionHash: string;
  readonly selectionHash: string;
  readonly synthesisInputHash: string;
  readonly wireContractSha256: string;
  readonly selectionPolicyVersion: string;
  readonly synthesisInputJson: PolicySynthesisEnvelope;
  readonly synthesisOutputJson: PolicyInsightContent;
  readonly payloadCanonical: string;
  readonly payloadHash: string;
  readonly selectedLineageJson: readonly EvidenceSelectionDecision[];
  readonly excludedLineageJson: readonly EvidenceSelectionDecision[];
}

export interface StoredPolicyInsight extends NewPolicyInsightRecord {
  readonly id: number;
}

export interface PolicyInsightRepositoryPort {
  findBySynthesisInputHash(input: {
    readonly schemaVersion: string;
    readonly wireContractSha256: string;
    readonly rulesetVersion: string;
    readonly synthesisInputHash: string;
  }): Promise<StoredPolicyInsight | null>;

  insertOrGet(input: NewPolicyInsightRecord): Promise<{
    readonly status: "created" | "already_exists";
    readonly record: StoredPolicyInsight;
  }>;

  getCurrent(input: {
    readonly pair: "SOL/USDC";
    readonly scopeKey: string;
    readonly wireContractSha256: string;
  }): Promise<StoredPolicyInsight | null>;

  getHistory(input: {
    readonly pair: "SOL/USDC";
    readonly scopeKey: string;
    readonly limit: number;
    readonly cursor: PolicyInsightHistoryCursor | null;
    readonly wireContractSha256: string;
  }): Promise<{
    readonly records: readonly StoredPolicyInsight[];
    readonly nextCursor: PolicyInsightHistoryCursor | null;
  }>;
}

export interface PolicyInsightHistoryCursor {
  readonly generatedAtUnixMs: number;
  readonly id: number;
}
