export type PolicyInsightSynthesisOutcome = "success" | "permanent_failure" | "transient_failure";

export interface PolicyInsightSynthesisClaim {
  cursorKey: string;
  targetReceiptId: number;
  attemptCount: number;
  leaseOwner: string;
  leaseExpiresAtUnixMs: number;
  lastProcessedReceiptId: number;
}

export interface ClaimLatestPairEvidenceInput {
  cursorKey: string;
  leaseOwner: string;
  leaseDurationMs: number;
  nowUnixMs: number;
}

export interface CompletePolicyInsightSynthesisInput {
  cursorKey: string;
  leaseOwner: string;
  targetReceiptId: number;
  nowUnixMs: number;
  outcome: "success" | "permanent_failure";
  errorCode?: string;
  errorMessage?: string;
}

export interface ReleaseForRetryInput {
  cursorKey: string;
  leaseOwner: string;
  targetReceiptId: number;
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
