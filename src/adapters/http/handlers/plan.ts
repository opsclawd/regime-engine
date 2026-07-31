import type { FastifyReply, FastifyRequest } from "fastify";
import { parsePlanRequest } from "../../../contract/v1/validation.js";
import {
  planMarketDataUnavailableError,
  planPositionStateStaleError
} from "../../../contract/v1/errors.js";
import type { GeneratePlanUseCase } from "../../../application/use-cases/generatePlanUseCase.js";
import {
  PlanMarketDataUnavailableError,
  PlanPositionStateStaleError
} from "../../../application/errors/planErrors.js";
import { PolicyInsightStoreUnavailableError } from "../../../application/errors/policyInsightErrors.js";
import { EvidenceStoreUnavailableError } from "../../../application/errors/evidenceErrors.js";
import { ContractValidationError } from "../../../contract/v1/errors.js";

export const createPlanHandler = (generatePlan: GeneratePlanUseCase) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = parsePlanRequest(request.body);
      const plan = await generatePlan(body);
      return reply.code(200).send(plan);
    } catch (err) {
      if (err instanceof PlanMarketDataUnavailableError) {
        const errorResponse = planMarketDataUnavailableError(err.message, err.details);
        return reply.code(503).send(errorResponse.response);
      }
      if (err instanceof PlanPositionStateStaleError) {
        const errorResponse = planPositionStateStaleError(err.message, err.details);
        return reply.code(503).send(errorResponse.response);
      }
      if (
        err instanceof PolicyInsightStoreUnavailableError ||
        err instanceof EvidenceStoreUnavailableError
      ) {
        const isEvidenceError = err instanceof EvidenceStoreUnavailableError;
        const code = isEvidenceError ? "EVIDENCE_STORE_UNAVAILABLE" : err.errorCode;
        const message = isEvidenceError
          ? "Evidence store is temporarily unavailable"
          : "Policy insight store is temporarily unavailable";
        return reply.code(503).send({
          schemaVersion: "1.0",
          error: {
            code,
            message,
            details: []
          }
        });
      }
      if (err instanceof ContractValidationError) {
        return reply.code(err.statusCode).send(err.response);
      }
      throw err;
    }
  };
};
