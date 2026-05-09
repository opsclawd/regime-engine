import { classifyRegime } from "../regime/classifier.js";
import type { IndicatorTelemetry } from "../features/indicators.js";
import type { MarketTimeframeConfig } from "./config.js";
import type { MarketReason, Regime, RegimeState } from "../../contract/v1/types.js";

const rewriteMessage = (code: string, regime: Regime): string => {
  if (code === "REGIME_STABLE") {
    return `Current telemetry holds ${regime} regime.`;
  }
  if (code === "REGIME_SWITCH_CONFIRMED") {
    return `Current telemetry supports ${regime} regime.`;
  }
  if (code === "REGIME_CONFIRM_PENDING") {
    return `Pending ${regime} confirmation.`;
  }
  if (code === "REGIME_MIN_HOLD_ACTIVE") {
    return `Holding ${regime} regime (minHoldBars).`;
  }
  return "";
};

export const classifyRegimeForPlan = (
  telemetry: IndicatorTelemetry,
  config: MarketTimeframeConfig["regime"],
  priorState?: RegimeState
): { regime: Regime; nextState: RegimeState; reasons: MarketReason[] } => {
  const decision = classifyRegime({
    telemetry,
    config,
    state: priorState ?? { current: "CHOP", barsInRegime: 0, pending: null, pendingBars: 0 }
  });

  const reasons: MarketReason[] = [];
  for (const reason of decision.reasons) {
    if (
      reason.code === "REGIME_STABLE" ||
      reason.code === "REGIME_SWITCH_CONFIRMED" ||
      reason.code === "REGIME_CONFIRM_PENDING" ||
      reason.code === "REGIME_MIN_HOLD_ACTIVE"
    ) {
      reasons.push({
        code: reason.code,
        severity: reason.severity,
        message: rewriteMessage(reason.code, decision.regime)
      });
    }
  }

  return {
    regime: decision.regime,
    nextState: decision.nextState,
    reasons
  };
};
