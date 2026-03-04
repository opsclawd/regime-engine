import type { Regime } from "../contract/v1/types.js";

export interface ChopGateDecision {
  allowClmm: boolean;
  reasons: Array<{
    code: string;
    severity: "INFO" | "WARN";
    message: string;
  }>;
}

export const evaluateChopGate = (input: {
  regime: Regime;
  shouldStandDown: boolean;
}): ChopGateDecision => {
  if (input.shouldStandDown) {
    return {
      allowClmm: false,
      reasons: [
        {
          code: "CLMM_BLOCKED_STAND_DOWN",
          severity: "WARN",
          message: "CLMM disabled while stand-down is active."
        }
      ]
    };
  }

  if (input.regime !== "CHOP") {
    return {
      allowClmm: false,
      reasons: [
        {
          code: "CLMM_BLOCKED_NON_CHOP",
          severity: "INFO",
          message: `CLMM disabled for regime ${input.regime}.`
        }
      ]
    };
  }

  return {
    allowClmm: true,
    reasons: [
      {
        code: "CLMM_ALLOWED_CHOP",
        severity: "INFO",
        message: "CLMM enabled in CHOP regime with no stand-down."
      }
    ]
  };
};
