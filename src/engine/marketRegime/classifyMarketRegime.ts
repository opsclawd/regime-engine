import { classifyRegime } from "../regime/classifier.js";
import type { IndicatorTelemetry } from "../features/indicators.js";
import type { MarketTimeframeConfig } from "./config.js";
import type { MarketReason, Regime } from "../../contract/v1/types.js";

const rewriteMessage = (code: string, regime: Regime): string => {
  if (code === "REGIME_STABLE") {
    return `Current telemetry holds ${regime} regime.`;
  }
  if (code === "REGIME_SWITCH_CONFIRMED") {
    return `Current telemetry supports ${regime} regime.`;
  }
  return "";
};

export const classifyMarketRegime = (
  telemetry: IndicatorTelemetry,
  config: MarketTimeframeConfig["regime"]
): { regime: Regime; reasons: MarketReason[] } => {
  let decision = classifyRegime({
    telemetry,
    config,
    state: undefined
  });

  for (let i = 1; i < config.confirmBars; i++) {
    decision = classifyRegime({
      telemetry,
      config,
      state: decision.nextState
    });
  }

  const reasons: MarketReason[] = [];
  for (const reason of decision.reasons) {
    if (reason.code !== "REGIME_STABLE" && reason.code !== "REGIME_SWITCH_CONFIRMED") {
      continue;
    }
    reasons.push({
      code: reason.code,
      severity: reason.severity,
      message: rewriteMessage(reason.code, decision.regime)
    });
  }

  return { regime: decision.regime, reasons };
};
