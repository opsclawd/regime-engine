import type { Candle } from "../../contract/v1/types.js";

const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const FIFTEEN_MINUTES_PER_HOUR = 4;

export { FIFTEEN_MIN_MS, ONE_HOUR_MS, FIFTEEN_MINUTES_PER_HOUR };

export interface AggregationTelemetry {
  sourceCandleCount: number;
  skippedNonInteger: number;
  skippedMisaligned: number;
  skippedIncomplete: number;
  skippedGapInBucket: number;
  completeBuckets: number;
}

export interface Aggregate15mTo1hResult {
  candles: Candle[];
  telemetry: AggregationTelemetry;
}

export const aggregate15mTo1h = (candles: Candle[]): Aggregate15mTo1hResult => {
  const bucketMs = ONE_HOUR_MS;
  const srcMs = FIFTEEN_MIN_MS;
  const required = FIFTEEN_MINUTES_PER_HOUR;

  const telemetry: AggregationTelemetry = {
    sourceCandleCount: candles.length,
    skippedNonInteger: 0,
    skippedMisaligned: 0,
    skippedIncomplete: 0,
    skippedGapInBucket: 0,
    completeBuckets: 0
  };

  const buckets = new Map<number, Candle[]>();
  for (const candle of candles) {
    if (!Number.isInteger(candle.unixMs)) {
      telemetry.skippedNonInteger += 1;
      continue;
    }
    if (candle.unixMs % srcMs !== 0) {
      telemetry.skippedMisaligned += 1;
      continue;
    }

    const bucketOpen = Math.floor(candle.unixMs / bucketMs) * bucketMs;
    const list = buckets.get(bucketOpen);
    if (list) {
      list.push(candle);
    } else {
      buckets.set(bucketOpen, [candle]);
    }
  }

  const out: Candle[] = [];
  for (const [bucketOpen, sources] of buckets) {
    if (sources.length !== required) {
      telemetry.skippedIncomplete += 1;
      continue;
    }

    sources.sort((a, b) => a.unixMs - b.unixMs);

    let complete = true;
    for (let i = 0; i < required; i += 1) {
      if (sources[i].unixMs !== bucketOpen + i * srcMs) {
        complete = false;
        break;
      }
    }
    if (!complete) {
      telemetry.skippedGapInBucket += 1;
      continue;
    }

    telemetry.completeBuckets += 1;

    let high = sources[0].high;
    let low = sources[0].low;
    let volume = 0;
    for (const src of sources) {
      if (src.high > high) high = src.high;
      if (src.low < low) low = src.low;
      volume += src.volume;
    }

    out.push({
      unixMs: bucketOpen,
      open: sources[0].open,
      high,
      low,
      close: sources[required - 1].close,
      volume
    });
  }

  out.sort((a, b) => a.unixMs - b.unixMs);
  return { candles: out, telemetry };
};
