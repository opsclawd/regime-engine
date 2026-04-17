import type { PlanRequest } from "../../contract/v1/types.js";

type ChurnState = PlanRequest["autopilotState"];
type ChurnConfig = PlanRequest["config"]["churn"];

export interface ChurnDecision {
  shouldStandDown: boolean;
  action: "HOLD" | "STAND_DOWN";
  constraints: {
    cooldownUntilUnixMs: number;
    standDownUntilUnixMs: number;
    stopoutsRemaining: number;
    redeploysRemaining: number;
    notes: string[];
  };
  reasons: Array<{
    code: string;
    severity: "INFO" | "WARN" | "ERROR";
    message: string;
  }>;
}

const clampRemaining = (maxAllowed: number, consumed: number): number => {
  return Math.max(0, maxAllowed - consumed);
};

export const applyChurnGovernor = (input: {
  asOfUnixMs: number;
  state: ChurnState;
  config: ChurnConfig;
}): ChurnDecision => {
  const reasons: ChurnDecision["reasons"] = [];
  const notes: string[] = [];

  const cooldownActive = input.state.cooldownUntilUnixMs > input.asOfUnixMs;
  const standDownActive = input.state.standDownUntilUnixMs > input.asOfUnixMs;
  const stopoutBudgetExceeded = input.state.stopouts24h >= input.config.maxStopouts24h;
  const redeployBudgetExceeded = input.state.redeploys24h >= input.config.maxRedeploys24h;
  const strikeTriggered = input.state.strikeCount >= input.config.standDownTriggerStrikes;

  if (cooldownActive) {
    reasons.push({
      code: "CHURN_COOLDOWN_ACTIVE",
      severity: "WARN",
      message: "Cooldown window is active after recent stopout."
    });
    notes.push("cooldown_active");
  }

  if (standDownActive) {
    reasons.push({
      code: "CHURN_STAND_DOWN_ACTIVE",
      severity: "WARN",
      message: "Existing stand-down window is active."
    });
    notes.push("stand_down_window_active");
  }

  if (stopoutBudgetExceeded) {
    reasons.push({
      code: "CHURN_STOPOUT_BUDGET_EXCEEDED",
      severity: "ERROR",
      message: "Stopout budget exceeded for current window."
    });
    notes.push("stopout_budget_exceeded");
  }

  if (redeployBudgetExceeded) {
    reasons.push({
      code: "CHURN_REDEPLOY_BUDGET_EXCEEDED",
      severity: "ERROR",
      message: "Redeploy budget exceeded for current window."
    });
    notes.push("redeploy_budget_exceeded");
  }

  if (strikeTriggered) {
    reasons.push({
      code: "CHURN_TWO_STRIKE_STAND_DOWN",
      severity: "ERROR",
      message: "Two-strike stand-down triggered."
    });
    notes.push("strike_stand_down_triggered");
  }

  const shouldStandDown =
    cooldownActive ||
    standDownActive ||
    stopoutBudgetExceeded ||
    redeployBudgetExceeded ||
    strikeTriggered;

  const triggeredStandDownUntilUnixMs = Math.max(
    input.state.standDownUntilUnixMs,
    cooldownActive ? input.state.cooldownUntilUnixMs : 0,
    stopoutBudgetExceeded || redeployBudgetExceeded || strikeTriggered
      ? input.asOfUnixMs + input.config.cooldownMsAfterStopout
      : 0
  );

  const computedStandDownUntilUnixMs = shouldStandDown
    ? triggeredStandDownUntilUnixMs
    : input.state.standDownUntilUnixMs;

  if (!shouldStandDown) {
    reasons.push({
      code: "CHURN_WITHIN_LIMITS",
      severity: "INFO",
      message: "Churn limits are within configured budgets."
    });
    notes.push("within_limits");
  }

  return {
    shouldStandDown,
    action: shouldStandDown ? "STAND_DOWN" : "HOLD",
    constraints: {
      cooldownUntilUnixMs: input.state.cooldownUntilUnixMs,
      standDownUntilUnixMs: computedStandDownUntilUnixMs,
      stopoutsRemaining: clampRemaining(input.config.maxStopouts24h, input.state.stopouts24h),
      redeploysRemaining: clampRemaining(input.config.maxRedeploys24h, input.state.redeploys24h),
      notes
    },
    reasons
  };
};
