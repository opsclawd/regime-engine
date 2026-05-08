import type { ClmmExecutionEventRequest, ExecutionResultRequest } from "../../contract/v1/types.js";

export type ExecutionResultLedgerOutcome =
  | { kind: "inserted" }
  | { kind: "idempotent" }
  | { kind: "plan-not-found"; message: string }
  | { kind: "plan-hash-mismatch"; message: string }
  | { kind: "execution-result-conflict"; message: string };

export interface ExecutionResultLedgerWritePort {
  recordExecutionResult(input: {
    executionResult: ExecutionResultRequest;
  }): Promise<ExecutionResultLedgerOutcome>;
}

export type ClmmExecutionEventLedgerOutcome =
  | { kind: "inserted" }
  | { kind: "idempotent" }
  | { kind: "clmm-correlation-conflict"; message: string };

export interface ClmmExecutionEventLedgerWritePort {
  recordClmmExecutionEvent(input: {
    event: ClmmExecutionEventRequest;
  }): Promise<ClmmExecutionEventLedgerOutcome>;
}
