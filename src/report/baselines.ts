export interface BaselineInputs {
  window: {
    fromUnixMs: number;
    toUnixMs: number;
  };
  planRequests: Array<{
    asOfUnixMs: number;
    request: {
      market: {
        candles: Array<{
          unixMs: number;
          close: number;
        }>;
      };
      portfolio: {
        navUsd: number;
      };
      config: {
        baselines: {
          dcaIntervalDays: number;
          dcaAmountUsd: number;
          usdcCarryApr: number;
        };
      };
    };
  }>;
}

export interface BaselineSummary {
  solHodlFinalNavUsd: number;
  solDcaFinalNavUsd: number;
  usdcCarryFinalNavUsd: number;
}

const roundUsd = (value: number): number => {
  return Math.round(value * 1_000_000) / 1_000_000;
};

const buildPriceSeries = (
  planRequests: BaselineInputs["planRequests"],
  window: BaselineInputs["window"]
): Array<{ unixMs: number; close: number }> => {
  const candlesByUnixMs = new Map<number, number>();

  for (const entry of planRequests) {
    for (const candle of entry.request.market.candles) {
      if (candle.unixMs < window.fromUnixMs || candle.unixMs > window.toUnixMs) {
        continue;
      }
      candlesByUnixMs.set(candle.unixMs, candle.close);
    }
  }

  return [...candlesByUnixMs.entries()]
    .map(([unixMs, close]) => ({ unixMs, close }))
    .sort((left, right) => left.unixMs - right.unixMs);
};

const computeSolHodl = (initialNavUsd: number, firstPrice: number, lastPrice: number): number => {
  if (firstPrice <= 0) {
    return initialNavUsd;
  }

  const solUnits = initialNavUsd / firstPrice;
  return solUnits * lastPrice;
};

const computeSolDca = (input: {
  initialNavUsd: number;
  priceSeries: Array<{ unixMs: number; close: number }>;
  dcaIntervalDays: number;
  dcaAmountUsd: number;
}): number => {
  if (input.priceSeries.length === 0 || input.dcaAmountUsd <= 0) {
    return input.initialNavUsd;
  }

  let cashUsd = input.initialNavUsd;
  let solUnits = 0;
  const intervalMs = Math.max(1, input.dcaIntervalDays) * 86_400_000;
  let nextBuyUnixMs = input.priceSeries[0].unixMs;

  for (const point of input.priceSeries) {
    if (cashUsd <= 0) {
      break;
    }

    if (point.unixMs < nextBuyUnixMs || point.close <= 0) {
      continue;
    }

    const buyUsd = Math.min(cashUsd, input.dcaAmountUsd);
    solUnits += buyUsd / point.close;
    cashUsd -= buyUsd;

    while (nextBuyUnixMs <= point.unixMs) {
      nextBuyUnixMs += intervalMs;
    }
  }

  const finalPrice = input.priceSeries[input.priceSeries.length - 1]?.close ?? 0;
  return cashUsd + solUnits * finalPrice;
};

const computeUsdcCarry = (input: {
  initialNavUsd: number;
  usdcCarryApr: number;
  startUnixMs: number;
  endUnixMs: number;
}): number => {
  const durationDays = Math.max(0, input.endUnixMs - input.startUnixMs) / 86_400_000;
  return input.initialNavUsd * (1 + input.usdcCarryApr * (durationDays / 365));
};

export const computeBaselines = (input: BaselineInputs): BaselineSummary => {
  if (input.planRequests.length === 0) {
    return {
      solHodlFinalNavUsd: 0,
      solDcaFinalNavUsd: 0,
      usdcCarryFinalNavUsd: 0
    };
  }

  const sortedRequests = [...input.planRequests].sort(
    (left, right) => left.asOfUnixMs - right.asOfUnixMs
  );
  const priceSeries = buildPriceSeries(sortedRequests, input.window);
  const baselineConfig = sortedRequests[0]?.request.config.baselines;
  const initialNavUsd = sortedRequests[0]?.request.portfolio.navUsd ?? 0;

  if (priceSeries.length === 0) {
    const usdcCarry = computeUsdcCarry({
      initialNavUsd,
      usdcCarryApr: baselineConfig.usdcCarryApr,
      startUnixMs: input.window.fromUnixMs,
      endUnixMs: input.window.toUnixMs
    });

    return {
      solHodlFinalNavUsd: roundUsd(initialNavUsd),
      solDcaFinalNavUsd: roundUsd(initialNavUsd),
      usdcCarryFinalNavUsd: roundUsd(usdcCarry)
    };
  }

  const firstPrice = priceSeries[0].close;
  const lastPoint = priceSeries[priceSeries.length - 1];

  const solHodl = computeSolHodl(initialNavUsd, firstPrice, lastPoint.close);
  const solDca = computeSolDca({
    initialNavUsd,
    priceSeries,
    dcaIntervalDays: baselineConfig.dcaIntervalDays,
    dcaAmountUsd: baselineConfig.dcaAmountUsd
  });
  const usdcCarry = computeUsdcCarry({
    initialNavUsd,
    usdcCarryApr: baselineConfig.usdcCarryApr,
    startUnixMs: input.window.fromUnixMs,
    endUnixMs: input.window.toUnixMs
  });

  return {
    solHodlFinalNavUsd: roundUsd(solHodl),
    solDcaFinalNavUsd: roundUsd(solDca),
    usdcCarryFinalNavUsd: roundUsd(usdcCarry)
  };
};
