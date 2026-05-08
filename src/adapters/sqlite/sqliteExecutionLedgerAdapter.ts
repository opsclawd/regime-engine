import type { LedgerStore } from "../../ledger/store.js";
import {
  LEDGER_ERROR_CODES,
  LedgerWriteError,
  writeClmmExecutionEvent,
  writeExecutionResultLedgerEntry
} from "../../ledger/writer.js";
import type {
  ClmmExecutionEventLedgerOutcome,
  ClmmExecutionEventLedgerWritePort,
  ExecutionResultLedgerOutcome,
  ExecutionResultLedgerWritePort
} from "../../application/ports/executionLedgerPort.js";

export const createSqliteExecutionResultLedgerWriteAdapter = (
  store: LedgerStore
): ExecutionResultLedgerWritePort => ({
  async recordExecutionResult(input): Promise<ExecutionResultLedgerOutcome> {
    try {
      const result = writeExecutionResultLedgerEntry(store, {
        executionResult: input.executionResult
      });
      return result.idempotent ? { kind: "idempotent" } : { kind: "inserted" };
    } catch (error) {
      if (error instanceof LedgerWriteError) {
        if (error.code === LEDGER_ERROR_CODES.PLAN_NOT_FOUND) {
          return { kind: "plan-not-found", message: error.message };
        }
        if (error.code === LEDGER_ERROR_CODES.PLAN_HASH_MISMATCH) {
          return { kind: "plan-hash-mismatch", message: error.message };
        }
        if (error.code === LEDGER_ERROR_CODES.EXECUTION_RESULT_CONFLICT) {
          return { kind: "execution-result-conflict", message: error.message };
        }
      }
      throw error;
    }
  }
});

export const createSqliteClmmExecutionEventLedgerWriteAdapter = (
  store: LedgerStore
): ClmmExecutionEventLedgerWritePort => ({
  async recordClmmExecutionEvent(input): Promise<ClmmExecutionEventLedgerOutcome> {
    try {
      const result = writeClmmExecutionEvent(store, { event: input.event });
      return result.idempotent ? { kind: "idempotent" } : { kind: "inserted" };
    } catch (error) {
      if (
        error instanceof LedgerWriteError &&
        error.code === LEDGER_ERROR_CODES.CLMM_EXECUTION_EVENT_CONFLICT
      ) {
        return { kind: "clmm-correlation-conflict", message: error.message };
      }
      throw error;
    }
  }
});
