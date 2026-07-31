import { describe, expect, it } from "vitest";
import {
  PolicyInsightValidationError,
  PolicyInsightStoreUnavailableError,
  type PolicyInsightErrorCode
} from "../policyInsightErrors.js";

describe("policyInsightErrors", () => {
  it("preserves structured codes through Error cause chains and repository adapters", () => {
    const rootCause = new Error("Connection reset");
    (rootCause as unknown as { errorCode: PolicyInsightErrorCode }).errorCode =
      "POLICY_STORE_UNAVAILABLE";

    const intermediateError = new PolicyInsightStoreUnavailableError(
      "Database unavailable",
      "POLICY_STORE_UNAVAILABLE",
      { cause: rootCause }
    );

    const validationError = new PolicyInsightValidationError("Stale position", "POSITION_STALE", {
      cause: intermediateError
    });

    expect(validationError.errorCode).toBe("POSITION_STALE");
    expect(validationError.cause).toBe(intermediateError);
    expect((validationError.cause as PolicyInsightStoreUnavailableError).errorCode).toBe(
      "POLICY_STORE_UNAVAILABLE"
    );
    expect(
      ((validationError.cause as Error).cause as { errorCode: PolicyInsightErrorCode }).errorCode
    ).toBe("POLICY_STORE_UNAVAILABLE");
  });
});
