import type { Candle } from "../../contract/v1/types.js";
import { candleCloses, logReturns } from "./candles.js";

export interface IndicatorConfig {
  volShortWindow: number;
  volLongWindow: number;
  trendWindow: number;
  compressionWindow: number;
}

export interface IndicatorTelemetry {
  realizedVolShort: number;
  realizedVolLong: number;
  volRatio: number;
  trendStrength: number;
  compression: number;
}

const DEFAULT_CONFIG: IndicatorConfig = {
  volShortWindow: 8,
  volLongWindow: 21,
  trendWindow: 14,
  compressionWindow: 20
};

const takeLast = <T>(values: readonly T[], count: number): T[] => {
  if (count <= 0) {
    return [];
  }

  if (values.length <= count) {
    return [...values];
  }

  return values.slice(values.length - count);
};

const mean = (values: readonly number[]): number => {
  if (values.length === 0) {
    return 0;
  }

  const sum = values.reduce((accumulator, value) => accumulator + value, 0);
  return sum / values.length;
};

const standardDeviation = (values: readonly number[]): number => {
  if (values.length === 0) {
    return 0;
  }

  const average = mean(values);
  const variance =
    values.reduce((accumulator, value) => {
      const delta = value - average;
      return accumulator + delta * delta;
    }, 0) / values.length;

  return Math.sqrt(variance);
};

const trendSlope = (values: readonly number[]): number => {
  if (values.length < 2) {
    return 0;
  }

  const count = values.length;
  const meanX = (count - 1) / 2;
  const meanY = mean(values);

  let numerator = 0;
  let denominator = 0;

  for (let index = 0; index < count; index += 1) {
    const dx = index - meanX;
    numerator += dx * (values[index] - meanY);
    denominator += dx * dx;
  }

  if (denominator === 0 || meanY === 0) {
    return 0;
  }

  return numerator / denominator / meanY;
};

const roundStable = (value: number, digits = 12): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const realizedVol = (returns: readonly number[]): number => {
  if (returns.length === 0) {
    return 0;
  }

  return standardDeviation(returns) * Math.sqrt(returns.length);
};

const relativeVolatility = (
  shortReturns: readonly number[],
  longReturns: readonly number[]
): number => {
  const longVol = standardDeviation(longReturns);
  if (longVol === 0) {
    return 0;
  }

  // Compare per-bar volatility so the ratio is not biased by the window lengths.
  return standardDeviation(shortReturns) / longVol;
};

const bollingerCompression = (closes: readonly number[]): number => {
  if (closes.length === 0) {
    return 0;
  }

  const sma = mean(closes);
  if (sma === 0) {
    return 0;
  }

  const std = standardDeviation(closes);
  return (4 * std) / sma;
};

export const computeIndicators = (
  candles: readonly Candle[],
  config: Partial<IndicatorConfig> = {}
): IndicatorTelemetry => {
  const merged: IndicatorConfig = { ...DEFAULT_CONFIG, ...config };
  const closes = candleCloses(candles);
  const returns = logReturns(closes);
  const shortReturns = takeLast(returns, merged.volShortWindow);
  const longReturns = takeLast(returns, merged.volLongWindow);

  const volShort = realizedVol(shortReturns);
  const volLong = realizedVol(longReturns);
  const trend = trendSlope(takeLast(closes, merged.trendWindow));
  const compression = bollingerCompression(takeLast(closes, merged.compressionWindow));

  return {
    realizedVolShort: roundStable(volShort),
    realizedVolLong: roundStable(volLong),
    volRatio: roundStable(relativeVolatility(shortReturns, longReturns)),
    trendStrength: roundStable(trend),
    compression: roundStable(compression)
  };
};
