import type {
  ClmmExecutionEventRequest,
  ClmmExecutionEventResponse
} from "../../contract/v1/types.js";
import { SCHEMA_VERSION } from "../../contract/v1/types.js";
import type { ClmmExecutionEventLedgerWritePort } from "../ports/executionLedgerPort.js";
import { ClmmExecutionEventConflictError } from "../errors/ledgerErrors.js";

export type RecordClmmExecutionResultUseCase = (
  body: ClmmExecutionEventRequest
) => Promise<ClmmExecutionEventResponse>;

export interface RecordClmmExecutionResultUseCaseDeps {
  port: ClmmExecutionEventLedgerWritePort;
}

export const createRecordClmmExecutionResultUseCase = (
  deps: RecordClmmExecutionResultUseCaseDeps
): RecordClmmExecutionResultUseCase => {
  return async (body) => {
    const outcome = await deps.port.recordClmmExecutionEvent({ event: body });

    switch (outcome.kind) {
      case "inserted":
        return {
          schemaVersion: SCHEMA_VERSION,
          ok: true,
          correlationId: body.correlationId
        };
      case "idempotent":
        return {
          schemaVersion: SCHEMA_VERSION,
          ok: true,
          correlationId: body.correlationId,
          idempotent: true
        };
      case "clmm-correlation-conflict":
        throw new ClmmExecutionEventConflictError(outcome.message);
    }
  };
};
