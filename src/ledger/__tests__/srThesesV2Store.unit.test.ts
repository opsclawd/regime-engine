import { describe, expect, it } from "vitest";
import { SrThesesV2Store, SrThesisV2ConflictError } from "../srThesesV2Store.js";
import { V2_ERROR_CODES } from "../../contract/v2/errors.js";

describe("SrThesesV2Store module", () => {
  it("exports SrThesesV2Store class and conflict error", () => {
    expect(SrThesesV2Store).toBeDefined();
    expect(SrThesisV2ConflictError).toBeDefined();
  });

  it("conflict error uses V2_ERROR_CODES from contract", () => {
    expect(V2_ERROR_CODES.SR_THESIS_V2_CONFLICT).toBe("SR_THESIS_V2_CONFLICT");
    const error = new SrThesisV2ConflictError({
      source: "s",
      symbol: "S",
      briefId: "b",
      asset: "A",
      sourceHandle: "@h"
    });
    expect(error.errorCode).toBe("SR_THESIS_V2_CONFLICT");
  });
});
