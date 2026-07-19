export class PolicyInsightStoreUnavailableError extends Error {
  constructor(message = "Policy insight store is temporarily unavailable", options?: ErrorOptions) {
    super(message, options);
    this.name = "PolicyInsightStoreUnavailableError";
  }
}

export class PolicyInsightValidationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PolicyInsightValidationError";
  }
}
