export const MARKET_REGIME_CONFIG_VERSION = "market-regime-2.0.0" as const;

export interface MarketTimeframeConfig {
  timeframe: "15m";
  timeframeMs: number;
  indicators: {
    volShortWindow: number;
    volLongWindow: number;
    trendWindow: number;
    compressionWindow: number;
  };
  regime: {
    confirmBars: number;
    minHoldBars: number;
    enterUpTrend: number;
    exitUpTrend: number;
    enterDownTrend: number;
    exitDownTrend: number;
    chopVolRatioMax: number;
  };
  suitability: {
    allowedVolRatioMax: number;
    extremeVolRatio: number;
    extremeCompression: number;
    minCandles: number;
  };
  freshness: {
    closedCandleDelayMs: number;
    softStaleMs: number;
    hardStaleMs: number;
  };
}

const FIFTEEN_MIN_MS = 15 * 60 * 1000;

export const MARKET_REGIME_CONFIG: Record<"15m", MarketTimeframeConfig> = {
  "15m": {
    timeframe: "15m",
    timeframeMs: FIFTEEN_MIN_MS,
    indicators: {
      volShortWindow: 32,
      volLongWindow: 84,
      trendWindow: 56,
      compressionWindow: 80
    },
    regime: {
      confirmBars: 2,
      minHoldBars: 0,
      enterUpTrend: 0.6,
      exitUpTrend: 0.35,
      enterDownTrend: -0.6,
      exitDownTrend: -0.35,
      chopVolRatioMax: 1.4
    },
    suitability: {
      allowedVolRatioMax: 1.3,
      extremeVolRatio: 1.6,
      extremeCompression: 0.18,
      minCandles: 120
    },
    freshness: {
      closedCandleDelayMs: 2 * 60 * 1000,
      softStaleMs: 25 * 60 * 1000,
      hardStaleMs: 35 * 60 * 1000
    }
  }
};
