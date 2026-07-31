import type { PlanRequest, PlanResponse } from "../../contract/v1/types.js";

export interface PositionPlanScope {
  readonly positionId: string;
  readonly walletId?: string;
  readonly poolAddress: string;
}

export interface StoredPositionPlan {
  readonly planRequest: PlanRequest;
  readonly planResponse: PlanResponse;
}

export interface PlanLedgerReadPort {
  getLatestPositionPlan(scope: PositionPlanScope): Promise<StoredPositionPlan | null>;
  getPositionPlanByHash(
    scope: PositionPlanScope,
    planHash: string
  ): Promise<StoredPositionPlan | null>;
  listLatestPositionPlans(): Promise<readonly StoredPositionPlan[]>;
}

export interface PlanLedgerWritePort {
  writePlan(input: { planRequest: PlanRequest; planResponse: PlanResponse }): Promise<void>;
}
