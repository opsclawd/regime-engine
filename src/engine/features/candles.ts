import type { Candle } from "../../contract/v1/types.js";

export const sortCandlesByUnixMs = (
  candles: readonly Candle[]
): Candle[] => {
  return [...candles].sort((left, right) => left.unixMs - right.unixMs);
};

export const candleCloses = (candles: readonly Candle[]): number[] => {
  return sortCandlesByUnixMs(candles).map((candle) => candle.close);
};

export const logReturns = (closes: readonly number[]): number[] => {
  const returns: number[] = [];
  for (let index = 1; index < closes.length; index += 1) {
    const previous = closes[index - 1];
    const current = closes[index];

    if (previous <= 0 || current <= 0) {
      returns.push(0);
      continue;
    }

    returns.push(Math.log(current / previous));
  }

  return returns;
};
