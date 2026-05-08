export interface RegimeApplicationErrorDetail {
  path: string;
  code: string;
  message: string;
}

export class RegimeCandlesNotFoundError extends Error {
  public readonly details: RegimeApplicationErrorDetail[];

  public constructor(message: string, details: RegimeApplicationErrorDetail[]) {
    super(message);
    this.name = "RegimeCandlesNotFoundError";
    this.details = details;
  }
}
