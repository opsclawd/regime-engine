import type { IndicatorTelemetry } from "../features/indicators.js";
import type { RegimeConfig, RegimeDecision, RegimeReason, RegimeState } from "./types.js";

const defaultState: RegimeState = {
  current: "CHOP",
  barsInRegime: 0,
  pending: null,
  pendingBars: 0
};

const reason = (
  code: string,
  severity: RegimeReason["severity"],
  message: string
): RegimeReason => ({ code, severity, message });

const evaluateDesiredRegime = (
  current: RegimeState["current"],
  telemetry: IndicatorTelemetry,
  config: RegimeConfig
): RegimeState["current"] => {
  const lowVol = telemetry.volRatio <= config.chopVolRatioMax;

  if (current === "UP") {
    if (lowVol && telemetry.trendStrength >= config.exitUpTrend) {
      return "UP";
    }
  } else if (current === "DOWN") {
    if (lowVol && telemetry.trendStrength <= config.exitDownTrend) {
      return "DOWN";
    }
  }

  if (!lowVol) {
    return "CHOP";
  }

  if (telemetry.trendStrength >= config.enterUpTrend) {
    return "UP";
  }

  if (telemetry.trendStrength <= config.enterDownTrend) {
    return "DOWN";
  }

  return "CHOP";
};

export const classifyRegime = (input: {
  telemetry: IndicatorTelemetry;
  config: RegimeConfig;
  state?: RegimeState;
}): RegimeDecision => {
  const state = input.state ?? defaultState;
  const desired = evaluateDesiredRegime(state.current, input.telemetry, input.config);

  if (desired === state.current) {
    return {
      regime: state.current,
      nextState: {
        current: state.current,
        barsInRegime: state.barsInRegime + 1,
        pending: null,
        pendingBars: 0
      },
      reasons: [reason("REGIME_STABLE", "INFO", `Regime remains ${state.current}.`)],
      telemetry: input.telemetry
    };
  }

  if (state.barsInRegime < input.config.minHoldBars) {
    return {
      regime: state.current,
      nextState: {
        ...state,
        barsInRegime: state.barsInRegime + 1
      },
      reasons: [
        reason(
          "REGIME_MIN_HOLD_ACTIVE",
          "WARN",
          `Holding ${state.current} until minHoldBars=${input.config.minHoldBars} is reached.`
        )
      ],
      telemetry: input.telemetry
    };
  }

  const samePending = state.pending === desired;
  const pendingBars = samePending ? state.pendingBars + 1 : 1;

  if (pendingBars >= input.config.confirmBars) {
    return {
      regime: desired,
      nextState: {
        current: desired,
        barsInRegime: 0,
        pending: null,
        pendingBars: 0
      },
      reasons: [
        reason(
          "REGIME_SWITCH_CONFIRMED",
          "INFO",
          `Switched ${state.current} -> ${desired} after ${pendingBars} confirmation bars.`
        )
      ],
      telemetry: input.telemetry
    };
  }

  return {
    regime: state.current,
    nextState: {
      ...state,
      barsInRegime: state.barsInRegime + 1,
      pending: desired,
      pendingBars
    },
    reasons: [
      reason(
        "REGIME_CONFIRM_PENDING",
        "WARN",
        `Pending ${desired} confirmation (${pendingBars}/${input.config.confirmBars}).`
      )
    ],
    telemetry: input.telemetry
  };
};
