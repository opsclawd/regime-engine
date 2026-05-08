import type { PlanLedgerWritePort } from "../../../ports/planLedgerPort.js";
import type { PlanRequest, PlanResponse } from "../../../../contract/v1/types.js";

export class FakePlanLedgerWritePort implements PlanLedgerWritePort {
  public calls: Array<{ planRequest: PlanRequest; planResponse: PlanResponse }> = [];

  async writePlan(input: { planRequest: PlanRequest; planResponse: PlanResponse }): Promise<void> {
    this.calls.push({ planRequest: input.planRequest, planResponse: input.planResponse });
  }
}
