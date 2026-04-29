export const MARKET_REGIME_CONFIG_VERSION = "market-regime-1.0.0" as const;

export interface MarketTimeframeConfig {
  timeframe: "1h";
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

const ONE_HOUR_MS = 60 * 60 * 1000;

export const MARKET_REGIME_CONFIG: Record<"1h", MarketTimeframeConfig> = {
  "1h": {
    timeframe: "1h",
    timeframeMs: ONE_HOUR_MS,
    indicators: {
      volShortWindow: 8,
      volLongWindow: 21,
      trendWindow: 14,
      compressionWindow: 20
    },
    regime: {
      confirmBars: 1,
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
      minCandles: 30
    },
    freshness: {
      closedCandleDelayMs: 5 * 60 * 1000,
      softStaleMs: 75 * 60 * 1000,
      hardStaleMs: 90 * 60 * 1000
    }
  }
};
