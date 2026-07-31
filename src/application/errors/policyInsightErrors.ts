export type PolicyInsightErrorCode =
  | "POSITION_PLAN_MISSING"
  | "POSITION_STALE"
  | "PLAN_HASH_INVALID"
  | "POSITION_SCOPE_MISMATCH"
  | "POOL_SCOPE_MISMATCH"
  | "EVIDENCE_SELECTION_SUPERSEDED"
  | "MARKET_DATA_UNAVAILABLE"
  | "EVIDENCE_STORE_UNAVAILABLE"
  | "POLICY_STORE_UNAVAILABLE"
  | "OUTPUT_SCHEMA_INVALID"
  | "QUERY_INVALID"
  | "EXHAUSTED_RETRIES";

export class PolicyInsightStoreUnavailableError extends Error {
  readonly errorCode: PolicyInsightErrorCode;

  constructor(
    message = "Policy insight store is temporarily unavailable",
    errorCodeOrOptions?: PolicyInsightErrorCode | ErrorOptions,
    options?: ErrorOptions
  ) {
    let code: PolicyInsightErrorCode = "POLICY_STORE_UNAVAILABLE";
    let errOpts: ErrorOptions | undefined = options;

    if (typeof errorCodeOrOptions === "string") {
      code = errorCodeOrOptions;
    } else if (typeof errorCodeOrOptions === "object" && errorCodeOrOptions !== null) {
      errOpts = errorCodeOrOptions;
    }

    super(message, errOpts);
    this.name = "PolicyInsightStoreUnavailableError";
    this.errorCode = code;
  }
}

export class PolicyInsightValidationError extends Error {
  readonly errorCode: PolicyInsightErrorCode;

  constructor(message: string, errorCode: PolicyInsightErrorCode, options?: ErrorOptions) {
    super(message, options);
    this.name = "PolicyInsightValidationError";
    this.errorCode = errorCode;
  }
}
