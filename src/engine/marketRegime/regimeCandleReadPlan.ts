import type { RegimeReadTimeframe } from "../../contract/v1/types.js";
import { MARKET_REGIME_CONFIG } from "./config.js";
import { closedCandleCutoffUnixMs } from "./closedCandleCutoff.js";

const READ_BUFFER = 50;
const FIFTEEN_MINUTES_PER_HOUR = 4;
const DERIVED_SOURCE_READ_BUFFER_15M = 32;

export interface DirectMetadataHints {
  sourceTimeframe: "15m";
}

export interface DerivedMetadataHints {
  sourceTimeframe: "15m";
  derivedTimeframe: "1h";
  aggregationVersion: "ohlcv-agg-v1";
}

export interface RegimeCandleReadPlan {
  sourceTimeframe: "15m";
  sourceCutoffUnixMs: number;
  sourceLimit: number;
  derivedCutoffUnixMs?: number;
  metadataHints: DirectMetadataHints | DerivedMetadataHints;
}

export interface BuildRegimeCandleReadPlanInput {
  requestedTimeframe: RegimeReadTimeframe;
  nowUnixMs: number;
}

export const buildRegimeCandleReadPlan = (
  input: BuildRegimeCandleReadPlanInput
): RegimeCandleReadPlan => {
  const sourceConfig = MARKET_REGIME_CONFIG["15m"];
  const sourceCutoffUnixMs = closedCandleCutoffUnixMs(
    input.nowUnixMs,
    sourceConfig.timeframeMs,
    sourceConfig.freshness.closedCandleDelayMs
  );

  if (input.requestedTimeframe === "15m") {
    const requestedConfig = MARKET_REGIME_CONFIG["15m"];
    const sourceLimit =
      Math.max(requestedConfig.indicators.volLongWindow, requestedConfig.suitability.minCandles) +
      READ_BUFFER;

    return {
      sourceTimeframe: "15m",
      sourceCutoffUnixMs,
      sourceLimit,
      metadataHints: { sourceTimeframe: "15m" }
    };
  }

  const derivedConfig = MARKET_REGIME_CONFIG["1h"];
  const derivedCutoffUnixMs = closedCandleCutoffUnixMs(
    input.nowUnixMs,
    derivedConfig.timeframeMs,
    derivedConfig.freshness.closedCandleDelayMs
  );
  const requiredDerivedBars =
    Math.max(derivedConfig.indicators.volLongWindow, derivedConfig.suitability.minCandles) +
    READ_BUFFER;
  const sourceLimit =
    requiredDerivedBars * FIFTEEN_MINUTES_PER_HOUR + DERIVED_SOURCE_READ_BUFFER_15M;

  return {
    sourceTimeframe: "15m",
    sourceCutoffUnixMs,
    sourceLimit,
    derivedCutoffUnixMs,
    metadataHints: {
      sourceTimeframe: "15m",
      derivedTimeframe: "1h",
      aggregationVersion: "ohlcv-agg-v1"
    }
  };
};
