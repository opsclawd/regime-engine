export interface RegimeApplicationErrorDetail {
  code: string;
  path: string;
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
