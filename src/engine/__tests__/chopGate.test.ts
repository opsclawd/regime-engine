import { describe, expect, it } from "vitest";
import { evaluateChopGate } from "../chopGate.js";

describe("chop gate", () => {
  it("enables CLMM in CHOP when not stand-down", () => {
    const decision = evaluateChopGate({
      regime: "CHOP",
      shouldStandDown: false
    });

    expect(decision.allowClmm).toBe(true);
    expect(decision.reasons[0].code).toBe("CLMM_ALLOWED_CHOP");
  });

  it("disables CLMM in CHOP during stand-down", () => {
    const decision = evaluateChopGate({
      regime: "CHOP",
      shouldStandDown: true
    });

    expect(decision.allowClmm).toBe(false);
    expect(decision.reasons[0].code).toBe("CLMM_BLOCKED_STAND_DOWN");
  });

  it("disables CLMM in non-CHOP regimes", () => {
    expect(
      evaluateChopGate({
        regime: "UP",
        shouldStandDown: false
      }).allowClmm
    ).toBe(false);

    expect(
      evaluateChopGate({
        regime: "DOWN",
        shouldStandDown: false
      }).allowClmm
    ).toBe(false);
  });
});
