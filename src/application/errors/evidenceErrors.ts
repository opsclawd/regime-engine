export class EvidenceStoreUnavailableError extends Error {
  constructor(message = "Evidence store is temporarily unavailable", options?: ErrorOptions) {
    super(message, options);
    this.name = "EvidenceStoreUnavailableError";
  }
}
