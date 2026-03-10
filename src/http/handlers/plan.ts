import type { FastifyReply, FastifyRequest } from "fastify";
import { parsePlanRequest } from "../../contract/v1/validation.js";
import { type LedgerStore } from "../../ledger/store.js";
import { writePlanLedgerEntry } from "../../ledger/writer.js";
import { buildPlan } from "../../engine/plan/buildPlan.js";
import { ContractValidationError } from "../errors.js";

export const createPlanHandler = (store: LedgerStore) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = parsePlanRequest(request.body);
      const plan = buildPlan(body, body.regimeState);

      writePlanLedgerEntry(store, {
        planRequest: body,
        planResponse: plan
      });

      return reply.code(200).send(plan);
    } catch (error) {
      if (error instanceof ContractValidationError) {
        return reply.code(error.statusCode).send(error.response);
      }

      throw error;
    }
  };
};
