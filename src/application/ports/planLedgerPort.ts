import type { PlanRequest, PlanResponse } from "../../contract/v1/types.js";

export interface PlanLedgerWritePort {
  writePlan(input: { planRequest: PlanRequest; planResponse: PlanResponse }): Promise<void>;
}