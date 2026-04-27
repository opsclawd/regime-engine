import type {
  ClmmSuitabilityReason,
  ClmmSuitabilityStatus,
  Regime
} from "../../contract/v1/types.js";
import type { IndicatorTelemetry } from "../features/indicators.js";
import type { MarketTimeframeConfig } from "./config.js";

export interface MarketClmmSuitabilityInput {
  regime: Regime;
  telemetry: IndicatorTelemetry;
  freshness: { hardStale: boolean; softStale: boolean };
  candleCount: number;
  config: MarketTimeframeConfig["suitability"];
}

export interface MarketClmmSuitability {
  status: ClmmSuitabilityStatus;
  reasons: ClmmSuitabilityReason[];
}

const reason = (
  code: string,
  severity: ClmmSuitabilityReason["severity"],
  message: string
): ClmmSuitabilityReason => ({ code, severity, message });

export const evaluateMarketClmmSuitability = (
  input: MarketClmmSuitabilityInput
): MarketClmmSuitability => {
  const { regime, telemetry, freshness, candleCount, config } = input;

  if (candleCount < config.minCandles) {
    return {
      status: "UNKNOWN",
      reasons: [
        reason(
          "CLMM_UNKNOWN_INSUFFICIENT_SAMPLES",
          "ERROR",
          `Need at least ${config.minCandles} closed candles; have ${candleCount}.`
        )
      ]
    };
  }

  if (freshness.hardStale) {
    return {
      status: "UNKNOWN",
      reasons: [
        reason(
          "CLMM_UNKNOWN_HARD_STALE_DATA",
          "ERROR",
          "Latest candle exceeds hard-stale window; classification is not trustworthy."
        )
      ]
    };
  }

  const blockedReasons: ClmmSuitabilityReason[] = [];
  if (regime === "UP") {
    blockedReasons.push(
      reason("CLMM_BLOCKED_TRENDING_UP", "WARN",
        "CLMM positions are not appropriate while regime is trending UP.")
    );
  }
  if (regime === "DOWN") {
    blockedReasons.push(
      reason("CLMM_BLOCKED_TRENDING_DOWN", "WARN",
        "CLMM positions are not appropriate while regime is trending DOWN.")
    );
  }
  if (telemetry.volRatio >= config.extremeVolRatio) {
    blockedReasons.push(
      reason("CLMM_BLOCKED_EXTREME_VOLATILITY", "WARN",
        "Realized volatility is in the extreme band; CLMM is blocked regardless of regime.")
    );
  }
  if (telemetry.compression >= config.extremeCompression) {
    blockedReasons.push(
      reason("CLMM_BLOCKED_EXTREME_COMPRESSION", "WARN",
        "Bollinger compression is extreme; CLMM is blocked regardless of regime.")
    );
  }
  if (blockedReasons.length > 0) {
    return { status: "BLOCKED", reasons: blockedReasons };
  }

  const cautionReasons: ClmmSuitabilityReason[] = [];
  if (freshness.softStale) {
    cautionReasons.push(
      reason("CLMM_CAUTION_SOFT_STALE_DATA", "WARN",
        "Latest candle is in the soft-stale window; treat the read as borderline.")
    );
  }
  if (telemetry.volRatio > config.allowedVolRatioMax) {
    cautionReasons.push(
      reason("CLMM_CAUTION_ELEVATED_VOLATILITY", "WARN",
        "Volatility is elevated above the allowed band but not extreme.")
    );
  }
  if (cautionReasons.length > 0) {
    return { status: "CAUTION", reasons: cautionReasons };
  }

  return {
    status: "ALLOWED",
    reasons: [
      reason("CLMM_ALLOWED_CHOP_FRESH", "INFO",
        "Market is in CHOP with fresh data and acceptable volatility for CLMM exposure.")
    ]
  };
};