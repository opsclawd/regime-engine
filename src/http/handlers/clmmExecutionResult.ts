import type { FastifyReply, FastifyRequest } from "fastify";
import { SCHEMA_VERSION } from "../../contract/v1/types.js";
import { parseClmmExecutionEventRequest } from "../../contract/v1/validation.js";
import type { RecordClmmExecutionResultUseCase } from "../../application/use-cases/recordClmmExecutionResultUseCase.js";
import { ClmmExecutionEventConflictError } from "../../application/errors/ledgerErrors.js";
import { AuthError, requireSharedSecret } from "../../adapters/http/auth.js";
import { ContractValidationError } from "../errors.js";

export const createClmmExecutionResultHandler = (useCase: RecordClmmExecutionResultUseCase) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      requireSharedSecret(request.headers, "X-CLMM-Internal-Token", "CLMM_INTERNAL_TOKEN");

      const body = parseClmmExecutionEventRequest(request.body);
      const response = await useCase(body);
      return reply.code(200).send(response);
    } catch (error) {
      if (error instanceof AuthError) {
        return reply.code(error.statusCode).send(error.response);
      }

      if (error instanceof ContractValidationError) {
        return reply.code(error.statusCode).send(error.response);
      }

      if (error instanceof ClmmExecutionEventConflictError) {
        return reply.code(409).send({
          schemaVersion: SCHEMA_VERSION,
          error: { code: "CLMM_EXECUTION_EVENT_CONFLICT", message: error.message, details: [] }
        });
      }

      throw error;
    }
  };
};
