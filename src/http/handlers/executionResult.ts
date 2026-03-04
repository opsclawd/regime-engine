import type { FastifyReply, FastifyRequest } from "fastify";
import {
  SCHEMA_VERSION,
  type ExecutionResultResponse
} from "../../contract/v1/types.js";
import { parseExecutionResultRequest } from "../../contract/v1/validation.js";
import { type LedgerStore } from "../../ledger/store.js";
import {
  LEDGER_ERROR_CODES,
  LedgerWriteError,
  writeExecutionResultLedgerEntry
} from "../../ledger/writer.js";
import { ContractValidationError } from "../errors.js";

export const createExecutionResultHandler = (store: LedgerStore) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = parseExecutionResultRequest(request.body);
      const writeResult = writeExecutionResultLedgerEntry(store, {
        executionResult: body
      });

      const response: ExecutionResultResponse = {
        schemaVersion: SCHEMA_VERSION,
        ok: true,
        linkedPlanId: body.planId,
        linkedPlanHash: body.planHash,
        idempotent: writeResult.idempotent ? true : undefined
      };

      return reply.code(200).send(response);
    } catch (error) {
      if (error instanceof ContractValidationError) {
        return reply.code(error.statusCode).send(error.response);
      }

      if (error instanceof LedgerWriteError) {
        const statusCode =
          error.code === LEDGER_ERROR_CODES.PLAN_NOT_FOUND ? 404 : 409;
        return reply.code(statusCode).send({
          schemaVersion: SCHEMA_VERSION,
          error: {
            code: error.code,
            message: error.message,
            details: []
          }
        });
      }

      throw error;
    }
  };
};
