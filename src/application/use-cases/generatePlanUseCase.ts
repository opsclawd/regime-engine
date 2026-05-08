import type { PlanLedgerWritePort } from "../ports/planLedgerPort.js";
import type { PlanRequest, PlanResponse } from "../../contract/v1/types.js";
import { buildPlan } from "../../engine/plan/buildPlan.js";

export type GeneratePlanUseCase = (body: PlanRequest) => Promise<PlanResponse>;

export interface GeneratePlanUseCaseDeps {
  planLedgerWritePort: PlanLedgerWritePort;
}

export const createGeneratePlanUseCase = (deps: GeneratePlanUseCaseDeps): GeneratePlanUseCase => {
  return async (body) => {
    const plan = buildPlan(body, body.regimeState);
    await deps.planLedgerWritePort.writePlan({
      planRequest: body,
      planResponse: plan
    });
    return plan;
  };
};
