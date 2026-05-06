import { describe, expect, it } from "vitest";
import { MARKET_REGIME_CONFIG } from "../config.js";

describe("MARKET_REGIME_CONFIG[15m]", () => {
  it("has timeframeMs equal to 15 minutes", () => {
    expect(MARKET_REGIME_CONFIG["15m"].timeframeMs).toBe(15 * 60 * 1000);
  });
});
