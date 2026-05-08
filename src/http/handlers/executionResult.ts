import type { FastifyReply, FastifyRequest } from "fastify";
import { SCHEMA_VERSION } from "../../contract/v1/types.js";
import { parseExecutionResultRequest } from "../../contract/v1/validation.js";
import type { RecordExecutionResultUseCase } from "../../application/use-cases/recordExecutionResultUseCase.js";
import {
  ExecutionResultConflictError,
  ExecutionResultPlanHashMismatchError,
  ExecutionResultPlanNotFoundError
} from "../../application/errors/ledgerErrors.js";
import { ContractValidationError } from "../errors.js";

export const createExecutionResultHandler = (useCase: RecordExecutionResultUseCase) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = parseExecutionResultRequest(request.body);
      const response = await useCase(body);
      return reply.code(200).send(response);
    } catch (error) {
      if (error instanceof ContractValidationError) {
        return reply.code(error.statusCode).send(error.response);
      }

      if (error instanceof ExecutionResultPlanNotFoundError) {
        return reply.code(404).send({
          schemaVersion: SCHEMA_VERSION,
          error: { code: "PLAN_NOT_FOUND", message: error.message, details: [] }
        });
      }

      if (error instanceof ExecutionResultPlanHashMismatchError) {
        return reply.code(409).send({
          schemaVersion: SCHEMA_VERSION,
          error: { code: "PLAN_HASH_MISMATCH", message: error.message, details: [] }
        });
      }

      if (error instanceof ExecutionResultConflictError) {
        return reply.code(409).send({
          schemaVersion: SCHEMA_VERSION,
          error: { code: "EXECUTION_RESULT_CONFLICT", message: error.message, details: [] }
        });
      }

      throw error;
    }
  };
};
