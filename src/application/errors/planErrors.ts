import type { RegimeApplicationErrorDetail } from "./regimeErrors.js";

export class PlanMarketDataUnavailableError extends Error {
  public readonly details: RegimeApplicationErrorDetail[];

  public constructor(message: string, details: RegimeApplicationErrorDetail[]) {
    super(message);
    this.name = "PlanMarketDataUnavailableError";
    this.details = details;
  }
}

export class PlanPositionStateStaleError extends Error {
  public readonly details: RegimeApplicationErrorDetail[];

  public constructor(message: string, details: RegimeApplicationErrorDetail[]) {
    super(message);
    this.name = "PlanPositionStateStaleError";
    this.details = details;
  }
}
