export type PolicyInsightSynthesisOutcome = "success" | "permanent_failure" | "transient_failure";

export interface PolicyInsightSynthesisClaim {
  /** The cursor key identifier */
  cursorKey: string;
  /** Highest evidence bundle receipt id claimed */
  targetReceiptId: number;
  /** Highest SR thesis id claimed */
  targetSrThesesMaxId: number;
  attemptCount: number;
  leaseOwner: string;
  leaseExpiresAtUnixMs: number;
  /** Last completed evidence bundle receipt id */
  lastProcessedReceiptId: number;
  /** Last completed SR thesis id */
  lastProcessedSrThesesMaxId: number;
}

export interface ClaimLatestPairEvidenceInput {
  cursorKey: string;
  leaseOwner: string;
  leaseDurationMs: number;
  nowUnixMs: number;
  pair?: string;
  scopeKey?: string;
}

export interface CompletePolicyInsightSynthesisInput {
  cursorKey: string;
  leaseOwner: string;
  /** Evidence bundle component of target pair */
  targetReceiptId: number;
  /** SR thesis component of target pair */
  targetSrThesesMaxId: number;
  nowUnixMs: number;
  outcome: "success" | "permanent_failure";
  errorCode?: string;
  errorMessage?: string;
}

export interface ReleaseForRetryInput {
  cursorKey: string;
  leaseOwner: string;
  /** Evidence bundle component of target pair */
  targetReceiptId: number;
  /** SR thesis component of target pair */
  targetSrThesesMaxId: number;
  nowUnixMs: number;
  classification: string;
  sanitizedMessage: string;
  retryAtUnixMs: number;
}

export interface PolicyInsightSynthesisTriggerPort {
  claimLatestPairEvidence(
    input: ClaimLatestPairEvidenceInput
  ): Promise<PolicyInsightSynthesisClaim | null>;

  complete(input: CompletePolicyInsightSynthesisInput): Promise<boolean>;

  releaseForRetry(input: ReleaseForRetryInput): Promise<boolean>;
}
