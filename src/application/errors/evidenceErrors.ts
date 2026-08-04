export class EvidenceStoreUnavailableError extends Error {
  constructor(message = "Evidence store is temporarily unavailable", options?: ErrorOptions) {
    super(message, options);
    this.name = "EvidenceStoreUnavailableError";
  }
}

export class RawObservationIdentifierValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "RawObservationIdentifierValidationError";
  }
}

export class EvidenceBundleNotFoundError extends Error {
  readonly bundleId: number | string;

  public constructor(bundleId: number | string, message?: string) {
    super(message ?? `Evidence bundle not found: ${bundleId}`);
    this.name = "EvidenceBundleNotFoundError";
    this.bundleId = bundleId;
  }
}

export class RawObservationsNotFoundError extends Error {
  readonly runId: string;

  public constructor(runId: string, message?: string) {
    super(message ?? `Raw observations not found for run ID: ${runId}`);
    this.name = "RawObservationsNotFoundError";
    this.runId = runId;
  }
}
