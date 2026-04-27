import { computeIndicators } from "../features/indicators.js";
import type { Candle, MarketReason, RegimeCurrentResponse } from "../../contract/v1/types.js";
import { SCHEMA_VERSION } from "../../contract/v1/types.js";
import { classifyMarketRegime } from "./classifyMarketRegime.js";
import { computeFreshness } from "./freshness.js";
import { evaluateMarketClmmSuitability } from "./evaluateMarketClmmSuitability.js";
import type { MarketTimeframeConfig } from "./config.js";

export interface BuildRegimeCurrentInput {
  feed: {
    symbol: string;
    source: string;
    network: string;
    poolAddress: string;
    timeframe: "1h";
  };
  candles: Candle[];
  nowUnixMs: number;
  config: MarketTimeframeConfig;
  configVersion: string;
  engineVersion: string;
}

const buildMarketReasons = (
  regimeReasons: MarketReason[],
  freshness: { hardStale: boolean; softStale: boolean },
  candleCount: number,
  minCandles: number
): MarketReason[] => {
  const out: MarketReason[] = [...regimeReasons];

  if (freshness.hardStale) {
    out.push({
      code: "DATA_HARD_STALE",
      severity: "ERROR",
      message: "Latest candle is older than the hard-stale window."
    });
  } else if (freshness.softStale) {
    out.push({
      code: "DATA_SOFT_STALE",
      severity: "WARN",
      message: "Latest candle is older than the soft-stale window."
    });
  } else {
    out.push({
      code: "DATA_FRESH",
      severity: "INFO",
      message: "Latest candle is within the freshness window."
    });
  }

  if (candleCount >= minCandles) {
    out.push({
      code: "DATA_SUFFICIENT_SAMPLES",
      severity: "INFO",
      message: `Have ${candleCount} closed candles (>= ${minCandles}).`
    });
  } else {
    out.push({
      code: "DATA_INSUFFICIENT_SAMPLES",
      severity: "ERROR",
      message: `Have ${candleCount} closed candles; need at least ${minCandles}.`
    });
  }

  return out;
};

export const buildRegimeCurrent = (input: BuildRegimeCurrentInput): RegimeCurrentResponse => {
  const { feed, candles, nowUnixMs, config, configVersion, engineVersion } = input;

  const telemetry = computeIndicators(candles, config.indicators);
  const { regime, reasons: regimeReasons } = classifyMarketRegime(telemetry, config.regime);

  const lastCandleUnixMs = candles[candles.length - 1].unixMs;
  const freshness = computeFreshness(nowUnixMs, lastCandleUnixMs, {
    softStaleMs: config.freshness.softStaleMs,
    hardStaleMs: config.freshness.hardStaleMs,
    closedCandleDelayMs: config.freshness.closedCandleDelayMs
  });

  const suitability = evaluateMarketClmmSuitability({
    regime,
    telemetry,
    freshness: { hardStale: freshness.hardStale, softStale: freshness.softStale },
    candleCount: candles.length,
    config: config.suitability
  });

  const marketReasons = buildMarketReasons(
    regimeReasons,
    { hardStale: freshness.hardStale, softStale: freshness.softStale },
    candles.length,
    config.suitability.minCandles
  );

  return {
    schemaVersion: SCHEMA_VERSION,
    symbol: feed.symbol,
    source: feed.source,
    network: feed.network,
    poolAddress: feed.poolAddress,
    timeframe: feed.timeframe,
    regime,
    telemetry,
    clmmSuitability: suitability,
    marketReasons,
    freshness,
    metadata: {
      engineVersion,
      configVersion,
      candleCount: candles.length
    }
  };
};