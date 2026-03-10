import type { Regime, ReasonSeverity } from "../../contract/v1/types.js";
import type { IndicatorTelemetry } from "../features/indicators.js";

export interface RegimeConfig {
  confirmBars: number;
  minHoldBars: number;
  enterUpTrend: number;
  exitUpTrend: number;
  enterDownTrend: number;
  exitDownTrend: number;
  chopVolRatioMax: number;
}

export interface RegimeState {
  current: Regime;
  barsInRegime: number;
  pending: Regime | null;
  pendingBars: number;
}

export interface RegimeReason {
  code: string;
  severity: ReasonSeverity;
  message: string;
}

export interface RegimeDecision {
  regime: Regime;
  nextState: RegimeState;
  reasons: RegimeReason[];
  telemetry: IndicatorTelemetry;
}
