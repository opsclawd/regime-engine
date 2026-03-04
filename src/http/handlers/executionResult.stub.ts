import type { FastifyReply, FastifyRequest } from "fastify";
import {
  SCHEMA_VERSION,
  type ExecutionResultResponse
} from "../../contract/v1/types.js";
import { type LedgerStore } from "../../ledger/store.js";
import {
  LEDGER_ERROR_CODES,
  LedgerWriteError,
  writeExecutionResultLedgerEntry
} from "../../ledger/writer.js";
import { parseExecutionResultRequest } from "../../contract/v1/validation.js";
import { ContractValidationError } from "../errors.js";

export const createExecutionResultStubHandler = (store: LedgerStore) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = parseExecutionResultRequest(request.body);
      writeExecutionResultLedgerEntry(store, {
        executionResult: body
      });

      const response: ExecutionResultResponse = {
        schemaVersion: SCHEMA_VERSION,
        ok: true,
        linkedPlanId: body.planId,
        linkedPlanHash: body.planHash
      };

      return reply.code(200).send(response);
    } catch (error) {
      if (error instanceof ContractValidationError) {
        return reply.code(error.statusCode).send(error.response);
      }

      if (error instanceof LedgerWriteError) {
        if (error.code === LEDGER_ERROR_CODES.PLAN_NOT_FOUND) {
          return reply.code(404).send({
            schemaVersion: SCHEMA_VERSION,
            error: {
              code: LEDGER_ERROR_CODES.PLAN_NOT_FOUND,
              message: error.message,
              details: []
            }
          });
        }

        if (error.code === LEDGER_ERROR_CODES.PLAN_HASH_MISMATCH) {
          return reply.code(409).send({
            schemaVersion: SCHEMA_VERSION,
            error: {
              code: LEDGER_ERROR_CODES.PLAN_HASH_MISMATCH,
              message: error.message,
              details: []
            }
          });
        }
      }

      throw error;
    }
  };
};
