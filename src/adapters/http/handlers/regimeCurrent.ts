import type { FastifyReply, FastifyRequest } from "fastify";
import { parseRegimeCurrentQuery } from "../../../contract/v1/validation.js";
import { candlesNotFoundError, ContractValidationError } from "../../../contract/v1/errors.js";
import type { ErrorDetail } from "../../../contract/errors.js";
import type { GetCurrentRegimeUseCase } from "../../../application/use-cases/getCurrentRegimeUseCase.js";
import { RegimeCandlesNotFoundError } from "../../../application/errors/regimeErrors.js";

export const createRegimeCurrentHandler = (getCurrentRegime: GetCurrentRegimeUseCase) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = parseRegimeCurrentQuery(request.query);
      const response = await getCurrentRegime(query);
      return reply.code(200).send(response);
    } catch (error) {
      if (error instanceof ContractValidationError) {
        return reply.code(error.statusCode).send(error.response);
      }
      if (error instanceof RegimeCandlesNotFoundError) {
        const httpError = candlesNotFoundError(error.message, error.details as ErrorDetail[]);
        return reply.code(httpError.statusCode).send(httpError.response);
      }
      request.log.error(error, "Unhandled error in GET /v1/regime/current");
      return reply.code(500).send({
        schemaVersion: "1.0",
        error: { code: "INTERNAL_ERROR", message: "Internal server error", details: [] }
      });
    }
  };
};
