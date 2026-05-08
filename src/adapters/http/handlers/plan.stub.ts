import type { FastifyReply, FastifyRequest } from "fastify";
import { planHashFromPlan } from "../../../contract/v1/hash.js";
import { SCHEMA_VERSION, type PlanResponse } from "../../../contract/v1/types.js";
import { parsePlanRequest } from "../../../contract/v1/validation.js";
import { type LedgerStore } from "../../../ledger/store.js";
import { writePlanLedgerEntry } from "../../../ledger/writer.js";
import { ContractValidationError } from "../../../contract/v1/errors.js";

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
        scope: {
          kind: "position",
          positionId: body.position.positionId,
          poolAddress: body.market.poolAddress,
          symbol: body.market.symbol
        },
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
          validationPassed: true
        },
        marketData: {
          source: body.market.source,
          network: body.market.network,
          poolAddress: body.market.poolAddress,
          requestedTimeframe: body.market.timeframe,
          sourceTimeframe: body.market.timeframe,
          candleCount: 0,
          sourceCandleCount: 0,
          freshness: {
            generatedAtIso: new Date(body.asOfUnixMs).toISOString(),
            lastCandleUnixMs: body.asOfUnixMs,
            lastCandleIso: new Date(body.asOfUnixMs).toISOString(),
            ageSeconds: 0,
            softStale: false,
            hardStale: false,
            softStaleSeconds: 1500,
            hardStaleSeconds: 2100
          }
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
