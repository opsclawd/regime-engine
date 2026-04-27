import { describe, expect, it } from "vitest";
import { parseRegimeCurrentQuery } from "../validation.js";
import { ContractValidationError } from "../../../http/errors.js";

const baseQuery = {
  symbol: "SOL/USDC",
  source: "birdeye",
  network: "solana-mainnet",
  poolAddress: "Pool11111111111111111111111111111111111111",
  timeframe: "1h"
};

describe("parseRegimeCurrentQuery", () => {
  it("accepts the five required selectors", () => {
    const result = parseRegimeCurrentQuery(baseQuery);
    expect(result.timeframe).toBe("1h");
  });

  it.each([
    ["symbol"],
    ["source"],
    ["network"],
    ["poolAddress"],
    ["timeframe"]
  ])("rejects missing %s with VALIDATION_ERROR", (key) => {
    const query = { ...baseQuery } as Record<string, string>;
    delete query[key];
    expect.assertions(1);
    try {
      parseRegimeCurrentQuery(query);
    } catch (error) {
      expect((error as ContractValidationError).response.error.code).toBe(
        "VALIDATION_ERROR"
      );
    }
  });

  it("rejects timeframe outside allowlist with VALIDATION_ERROR", () => {
    expect.assertions(1);
    try {
      parseRegimeCurrentQuery({ ...baseQuery, timeframe: "4h" });
    } catch (error) {
      expect((error as ContractValidationError).response.error.code).toBe(
        "VALIDATION_ERROR"
      );
    }
  });

  it("rejects array values from query parsers with VALIDATION_ERROR", () => {
    expect.assertions(1);
    try {
      parseRegimeCurrentQuery({ ...baseQuery, symbol: ["SOL/USDC", "x"] });
    } catch (error) {
      expect((error as ContractValidationError).response.error.code).toBe(
        "VALIDATION_ERROR"
      );
    }
  });
});