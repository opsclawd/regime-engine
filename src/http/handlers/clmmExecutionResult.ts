import type { FastifyReply, FastifyRequest } from "fastify";
import { SCHEMA_VERSION, type ClmmExecutionEventResponse } from "../../contract/v1/types.js";
import { parseClmmExecutionEventRequest } from "../../contract/v1/validation.js";
import { type LedgerStore } from "../../ledger/store.js";
import {
  LEDGER_ERROR_CODES,
  LedgerWriteError,
  writeClmmExecutionEvent
} from "../../ledger/writer.js";
import { AuthError, requireSharedSecret } from "../auth.js";
import { ContractValidationError } from "../errors.js";

export const createClmmExecutionResultHandler = (store: LedgerStore) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      requireSharedSecret(request.headers, "X-CLMM-Internal-Token", "CLMM_INTERNAL_TOKEN");

      const body = parseClmmExecutionEventRequest(request.body);
      const result = writeClmmExecutionEvent(store, { event: body });

      const response: ClmmExecutionEventResponse = {
        schemaVersion: SCHEMA_VERSION,
        ok: true,
        correlationId: body.correlationId,
        idempotent: result.idempotent ? true : undefined
      };

      return reply.code(200).send(response);
    } catch (error) {
      if (error instanceof AuthError) {
        return reply.code(error.statusCode).send(error.response);
      }

      if (error instanceof ContractValidationError) {
        return reply.code(error.statusCode).send(error.response);
      }

      if (error instanceof LedgerWriteError) {
        const statusCode =
          error.code === LEDGER_ERROR_CODES.CLMM_EXECUTION_EVENT_CONFLICT ? 409 : 500;
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
