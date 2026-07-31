export type PositionPolicyInsightSynthesisStatus =
  | "waiting_for_plan"
  | "waiting_for_evidence"
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "superseded";

export interface PositionPolicyInsightSynthesisRequest {
  id: number;
  scopeKey: string;
  selectionHash: string | null;
  planHash: string | null;
  rulesetVersion: string;
  status: PositionPolicyInsightSynthesisStatus;
  attemptCount: number;
  nextAttemptAtUnixMs: number | null;
  leaseOwner: string | null;
  leaseExpiresAtUnixMs: number | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAtUnixMs: number;
  updatedAtUnixMs: number;
}

export interface PositionPolicyInsightSynthesisClaim {
  id: number;
  scopeKey: string;
  selectionHash: string;
  planHash: string;
  rulesetVersion: string;
  attemptCount: number;
  leaseOwner: string;
  leaseExpiresAtUnixMs: number;
}

export interface EnqueueOrReconcileInput {
  scopeKey: string;
  selectionHash?: string | null;
  planHash?: string | null;
  rulesetVersion: string;
  nowUnixMs: number;
}

export interface ClaimBatchInput {
  leaseOwner: string;
  leaseDurationMs: number;
  batchSize: number;
  nowUnixMs: number;
}

export interface CompletePositionPolicyInsightSynthesisInput {
  id: number;
  leaseOwner: string;
  nowUnixMs: number;
}

export interface FailPositionPolicyInsightSynthesisInput {
  id: number;
  leaseOwner: string;
  nowUnixMs: number;
  errorCode: string;
  errorMessage: string;
}

export interface FailWaitingForPlanInput {
  scopeKey: string;
  selectionHash?: string | null;
  rulesetVersion: string;
  nowUnixMs: number;
  errorCode: string;
  errorMessage: string;
}

export interface SupersedePositionPolicyInsightSynthesisInput {
  id: number;
  leaseOwner: string;
  nowUnixMs: number;
  errorCode?: string;
  errorMessage?: string;
}

export interface ReleasePositionPolicyInsightSynthesisForRetryInput {
  id: number;
  leaseOwner: string;
  nowUnixMs: number;
  retryAtUnixMs: number;
  errorCode?: string;
  errorMessage?: string;
  maxAttempts?: number;
}

export interface PositionPolicyInsightSynthesisQueuePort {
  enqueueOrReconcile(
    input: EnqueueOrReconcileInput
  ): Promise<PositionPolicyInsightSynthesisRequest>;

  claimBatch(input: ClaimBatchInput): Promise<PositionPolicyInsightSynthesisClaim[]>;

  complete(input: CompletePositionPolicyInsightSynthesisInput): Promise<boolean>;

  fail(input: FailPositionPolicyInsightSynthesisInput): Promise<boolean>;

  failWaitingForPlan(
    input: FailWaitingForPlanInput
  ): Promise<PositionPolicyInsightSynthesisRequest | null>;

  supersede(input: SupersedePositionPolicyInsightSynthesisInput): Promise<boolean>;

  releaseForRetry(input: ReleasePositionPolicyInsightSynthesisForRetryInput): Promise<boolean>;

  listWaitingScopes(status?: PositionPolicyInsightSynthesisStatus): Promise<string[]>;

  hasWaitingRequest(
    scopeKey: string,
    status?: PositionPolicyInsightSynthesisStatus
  ): Promise<boolean>;

  listEligiblePositionScopes(nowUnixMs: number): Promise<string[]>;

  getById(id: number): Promise<PositionPolicyInsightSynthesisRequest | null>;
}
