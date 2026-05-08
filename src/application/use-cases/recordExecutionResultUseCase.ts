import type { ExecutionResultRequest, ExecutionResultResponse } from "../../contract/v1/types.js";
import { SCHEMA_VERSION } from "../../contract/v1/types.js";
import type { ExecutionResultLedgerWritePort } from "../ports/executionLedgerPort.js";
import {
  ExecutionResultConflictError,
  ExecutionResultPlanHashMismatchError,
  ExecutionResultPlanNotFoundError
} from "../errors/ledgerErrors.js";

export type RecordExecutionResultUseCase = (
  body: ExecutionResultRequest
) => Promise<ExecutionResultResponse>;

export interface RecordExecutionResultUseCaseDeps {
  port: ExecutionResultLedgerWritePort;
}

export const createRecordExecutionResultUseCase = (
  deps: RecordExecutionResultUseCaseDeps
): RecordExecutionResultUseCase => {
  return async (body) => {
    const outcome = await deps.port.recordExecutionResult({ executionResult: body });

    switch (outcome.kind) {
      case "inserted":
        return {
          schemaVersion: SCHEMA_VERSION,
          ok: true,
          linkedPlanId: body.planId,
          linkedPlanHash: body.planHash
        };
      case "idempotent":
        return {
          schemaVersion: SCHEMA_VERSION,
          ok: true,
          linkedPlanId: body.planId,
          linkedPlanHash: body.planHash,
          idempotent: true
        };
      case "plan-not-found":
        throw new ExecutionResultPlanNotFoundError(outcome.message);
      case "plan-hash-mismatch":
        throw new ExecutionResultPlanHashMismatchError(outcome.message);
      case "execution-result-conflict":
        throw new ExecutionResultConflictError(outcome.message);
    }
  };
};
