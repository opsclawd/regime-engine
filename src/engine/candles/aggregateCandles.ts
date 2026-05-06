import type { Candle } from "../../contract/v1/types.js";

const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const FIFTEEN_MINUTES_PER_HOUR = 4;

type AggregationTargetTimeframe = "1h";

const targetBucketMs: Record<AggregationTargetTimeframe, number> = {
  "1h": ONE_HOUR_MS
};

const sourceTimeframeMs: Record<AggregationTargetTimeframe, number> = {
  "1h": FIFTEEN_MIN_MS
};

const sourceCountPerBucket: Record<AggregationTargetTimeframe, number> = {
  "1h": FIFTEEN_MINUTES_PER_HOUR
};

export const aggregateCandles = (
  candles: Candle[],
  target: AggregationTargetTimeframe
): Candle[] => {
  const bucketMs = targetBucketMs[target];
  const srcMs = sourceTimeframeMs[target];
  const required = sourceCountPerBucket[target];

  const buckets = new Map<number, Candle[]>();
  for (const candle of candles) {
    if (!Number.isInteger(candle.unixMs)) continue;
    if (candle.unixMs % srcMs !== 0) continue;

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
    if (sources.length !== required) continue;

    sources.sort((a, b) => a.unixMs - b.unixMs);

    let complete = true;
    for (let i = 0; i < required; i += 1) {
      if (sources[i].unixMs !== bucketOpen + i * srcMs) {
        complete = false;
        break;
      }
    }
    if (!complete) continue;

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
  return out;
};
