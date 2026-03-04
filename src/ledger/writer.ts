import { toCanonicalJson } from "../contract/v1/canonical.js";
import { sha256Hex } from "../contract/v1/hash.js";
import type {
  ExecutionResultRequest,
  PlanRequest,
  PlanResponse
} from "../contract/v1/types.js";
import {
  findPlanHashByPlanId,
  runInTransaction,
  type LedgerStore
} from "./store.js";

export const LEDGER_ERROR_CODES = {
  PLAN_NOT_FOUND: "PLAN_NOT_FOUND",
  PLAN_HASH_MISMATCH: "PLAN_HASH_MISMATCH",
  EXECUTION_RESULT_CONFLICT: "EXECUTION_RESULT_CONFLICT"
} as const;

type LedgerErrorCode = (typeof LEDGER_ERROR_CODES)[keyof typeof LEDGER_ERROR_CODES];

export class LedgerWriteError extends Error {
  public readonly code: LedgerErrorCode;

  public constructor(code: LedgerErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export const writePlanLedgerEntry = (
  store: LedgerStore,
  input: {
    planRequest: PlanRequest;
    planResponse: PlanResponse;
    receivedAtUnixMs?: number;
  }
): void => {
  const receivedAtUnixMs = input.receivedAtUnixMs ?? Date.now();
  const canonicalRequest = toCanonicalJson(input.planRequest);
  const canonicalPlan = toCanonicalJson(input.planResponse);

  runInTransaction(store, () => {
    store.db
      .prepare(
        `
          INSERT INTO plan_requests
            (plan_id, as_of_unix_ms, request_hash, request_json, created_at_unix_ms)
          VALUES
            (?, ?, ?, ?, ?)
        `
      )
      .run(
        input.planResponse.planId,
        input.planRequest.asOfUnixMs,
        sha256Hex(canonicalRequest),
        canonicalRequest,
        receivedAtUnixMs
      );

    store.db
      .prepare(
        `
          INSERT INTO plans
            (plan_id, plan_hash, as_of_unix_ms, plan_json, created_at_unix_ms)
          VALUES
            (?, ?, ?, ?, ?)
        `
      )
      .run(
        input.planResponse.planId,
        input.planResponse.planHash,
        input.planResponse.asOfUnixMs,
        canonicalPlan,
        receivedAtUnixMs
      );
  });
};

export const writeExecutionResultLedgerEntry = (
  store: LedgerStore,
  input: {
    executionResult: ExecutionResultRequest;
    receivedAtUnixMs?: number;
  }
): { inserted: boolean; idempotent: boolean } => {
  const receivedAtUnixMs = input.receivedAtUnixMs ?? Date.now();
  const storedPlanHash = findPlanHashByPlanId(
    store,
    input.executionResult.planId
  );

  if (!storedPlanHash) {
    throw new LedgerWriteError(
      LEDGER_ERROR_CODES.PLAN_NOT_FOUND,
      `No plan found for planId "${input.executionResult.planId}".`
    );
  }

  if (storedPlanHash !== input.executionResult.planHash) {
    throw new LedgerWriteError(
      LEDGER_ERROR_CODES.PLAN_HASH_MISMATCH,
      `planHash mismatch for planId "${input.executionResult.planId}".`
    );
  }

  const canonicalExecutionResult = toCanonicalJson(input.executionResult);

  const existingExecutionResult = store.db
    .prepare(
      `
        SELECT result_json
        FROM execution_results
        WHERE plan_id = ? AND plan_hash = ?
        ORDER BY id DESC
        LIMIT 1
      `
    )
    .get(
      input.executionResult.planId,
      input.executionResult.planHash
    ) as { result_json: string } | undefined;

  if (existingExecutionResult) {
    if (existingExecutionResult.result_json === canonicalExecutionResult) {
      return {
        inserted: false,
        idempotent: true
      };
    }

    throw new LedgerWriteError(
      LEDGER_ERROR_CODES.EXECUTION_RESULT_CONFLICT,
      `Execution result conflict for planId "${input.executionResult.planId}".`
    );
  }

  store.db
    .prepare(
      `
        INSERT INTO execution_results
          (plan_id, plan_hash, as_of_unix_ms, result_json, created_at_unix_ms)
        VALUES
          (?, ?, ?, ?, ?)
      `
    )
    .run(
      input.executionResult.planId,
      input.executionResult.planHash,
      input.executionResult.asOfUnixMs,
      canonicalExecutionResult,
      receivedAtUnixMs
    );

  return {
    inserted: true,
    idempotent: false
  };
};
