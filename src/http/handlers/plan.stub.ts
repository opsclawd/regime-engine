import type { FastifyReply, FastifyRequest } from "fastify";
import { planHashFromPlan } from "../../contract/v1/hash.js";
import { SCHEMA_VERSION, type PlanResponse } from "../../contract/v1/types.js";
import { parsePlanRequest } from "../../contract/v1/validation.js";
import {
  type LedgerStore
} from "../../ledger/store.js";
import { writePlanLedgerEntry } from "../../ledger/writer.js";
import { ContractValidationError } from "../errors.js";

export const createPlanStubHandler = (store: LedgerStore) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = parsePlanRequest(request.body);
      const currentRegimeState = body.regimeState ?? {
        current: "CHOP" as const,
        barsInRegime: 0,
        pending: null,
        pendingBars: 0
      };
      const basePlan: Omit<PlanResponse, "planHash"> = {
        schemaVersion: SCHEMA_VERSION,
        planId: `stub-${body.asOfUnixMs}`,
        asOfUnixMs: body.asOfUnixMs,
        regime: "CHOP",
        targets: {
          solBps: 5_000,
          usdcBps: 5_000,
          allowClmm: true
        },
        actions: [
          {
            type: "HOLD",
            reasonCode: "STUB_PLAN"
          }
        ],
        constraints: {
          cooldownUntilUnixMs: body.autopilotState.cooldownUntilUnixMs,
          standDownUntilUnixMs: body.autopilotState.standDownUntilUnixMs,
          notes: ["stub_plan_response"]
        },
        nextRegimeState: {
          current: currentRegimeState.current,
          barsInRegime: currentRegimeState.barsInRegime + 1,
          pending: null,
          pendingBars: 0
        },
        reasons: [
          {
            code: "STUB_PLAN",
            severity: "INFO",
            message: "Stub planning path for contract wiring."
          }
        ],
        telemetry: {
          candleCount: body.market.candles.length,
          validationPassed: true
        }
      };

      const response: PlanResponse = {
        ...basePlan,
        planHash: planHashFromPlan(basePlan)
      };

      writePlanLedgerEntry(store, {
        planRequest: body,
        planResponse: response
      });

      return reply.code(200).send(response);
    } catch (error) {
      if (error instanceof ContractValidationError) {
        return reply.code(error.statusCode).send(error.response);
      }

      throw error;
    }
  };
};
