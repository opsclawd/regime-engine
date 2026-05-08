import type { FastifyReply, FastifyRequest } from "fastify";
import { parsePlanRequest } from "../../../contract/v1/validation.js";
import type { GeneratePlanUseCase } from "../../../application/use-cases/generatePlanUseCase.js";
import { ContractValidationError } from "../../../contract/v1/errors.js";

export const createPlanHandler = (generatePlan: GeneratePlanUseCase) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = parsePlanRequest(request.body);
      const plan = await generatePlan(body);
      return reply.code(200).send(plan);
    } catch (error) {
      if (error instanceof ContractValidationError) {
        return reply.code(error.statusCode).send(error.response);
      }

      throw error;
    }
  };
};
