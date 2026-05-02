import type { Candle } from "../../contract/v1/types.js";
import type { GeckoCollectorConfig } from "./config.js";
import { ProtocolError } from "./retry.js";

const TIMEFRAME_MS: Record<string, number> = {
  "1h": 3600000
};

export type NormalizationStats = {
  providerRowCount: number;
  malformedRowCount: number;
  misalignedRowCount: number;
  invalidOhlcvRowCount: number;
  duplicateIdenticalDroppedCount: number;
  duplicateConflictDroppedCount: number;
  totalDroppedCount: number;
  corruptionDroppedCount: number;
  validCount: number;
  dropReasons: string[];
};

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function parseRow(
  raw: unknown,
  timeframeMs: number
): { candle: Candle; dropReason?: string } | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length !== 6) return null;

  const [ts, o, h, l, c, v] = raw;

  if (typeof ts !== "number" || !Number.isFinite(ts)) return null;
  if (typeof o !== "number" || !Number.isFinite(o)) return null;
  if (typeof h !== "number" || !Number.isFinite(h)) return null;
  if (typeof l !== "number" || !Number.isFinite(l)) return null;
  if (typeof c !== "number" || !Number.isFinite(c)) return null;
  if (typeof v !== "number" || !Number.isFinite(v)) return null;

  if (!Number.isSafeInteger(ts)) return null;
  if (ts < 0) return null;

  const unixMs = ts * 1000;
  if (!Number.isSafeInteger(unixMs)) return null;
  if (unixMs % timeframeMs !== 0)
    return {
      candle: { unixMs, open: o, high: h, low: l, close: c, volume: v },
      dropReason: "misaligned"
    };

  if (o < 0 || h < 0 || l < 0 || c < 0 || v < 0) return null;

  return { candle: { unixMs, open: o, high: h, low: l, close: c, volume: v } };
}

export function normalizeGeckoOhlcv(
  payload: unknown,
  config: GeckoCollectorConfig
): { candles: Candle[]; stats: NormalizationStats } {
  if (
    !isObject(payload) ||
    !isObject(payload.data) ||
    !isObject(payload.data.attributes) ||
    !("ohlcv_list" in payload.data.attributes)
  ) {
    throw new ProtocolError("Invalid GeckoTerminal envelope: missing data.attributes.ohlcv_list");
  }

  const ohlcvList = payload.data.attributes.ohlcv_list;

  if (!Array.isArray(ohlcvList)) {
    throw new ProtocolError("Invalid GeckoTerminal envelope: ohlcv_list is not an array");
  }

  if (ohlcvList.length > 1000) {
    throw new ProtocolError("GeckoTerminal returned >1000 rows");
  }

  const timeframeMs = TIMEFRAME_MS[config.geckoTimeframe] ?? 3600000;

  const stats: NormalizationStats = {
    providerRowCount: ohlcvList.length,
    malformedRowCount: 0,
    misalignedRowCount: 0,
    invalidOhlcvRowCount: 0,
    duplicateIdenticalDroppedCount: 0,
    duplicateConflictDroppedCount: 0,
    totalDroppedCount: 0,
    corruptionDroppedCount: 0,
    validCount: 0,
    dropReasons: []
  };

  const parsed: Map<number, Candle[]> = new Map();

  for (const raw of ohlcvList) {
    const result = parseRow(raw, timeframeMs);
    if (result === null) {
      if (!Array.isArray(raw) || raw.length !== 6) {
        stats.malformedRowCount++;
        stats.dropReasons.push("malformed");
      } else {
        stats.invalidOhlcvRowCount++;
        stats.dropReasons.push("invalid_ohlcv");
      }
      continue;
    }

    if (result.dropReason === "misaligned") {
      stats.misalignedRowCount++;
      stats.dropReasons.push("misaligned");
    }

    if (result.dropReason) continue;

    const existing = parsed.get(result.candle.unixMs);
    if (existing) {
      existing.push(result.candle);
    } else {
      parsed.set(result.candle.unixMs, [result.candle]);
    }
  }

  const candles: Candle[] = [];
  const sortedKeys = [...parsed.keys()].sort((a, b) => a - b);

  for (const unixMs of sortedKeys) {
    const group = parsed.get(unixMs)!;
    if (group.length === 1) {
      candles.push(group[0]);
    } else {
      const allIdentical = group.every(
        (c) =>
          c.open === group[0].open &&
          c.high === group[0].high &&
          c.low === group[0].low &&
          c.close === group[0].close &&
          c.volume === group[0].volume
      );
      if (allIdentical) {
        candles.push(group[0]);
        stats.duplicateIdenticalDroppedCount += group.length - 1;
        stats.dropReasons.push(...Array(group.length - 1).fill("duplicate_identical"));
      } else {
        stats.duplicateConflictDroppedCount += group.length;
        stats.dropReasons.push(...Array(group.length).fill("duplicate_conflict"));
      }
    }
  }

  stats.corruptionDroppedCount =
    stats.malformedRowCount +
    stats.misalignedRowCount +
    stats.invalidOhlcvRowCount +
    stats.duplicateConflictDroppedCount;

  stats.validCount = candles.length;
  stats.totalDroppedCount =
    stats.malformedRowCount +
    stats.misalignedRowCount +
    stats.invalidOhlcvRowCount +
    stats.duplicateIdenticalDroppedCount +
    stats.duplicateConflictDroppedCount;

  return { candles, stats };
}

export function shouldPostNormalizedBatch(
  stats: NormalizationStats,
  config: GeckoCollectorConfig
): string | null {
  if (stats.validCount === 0) return "zero_valid";
  if (stats.providerRowCount > 0) {
    const corruptionRate = stats.corruptionDroppedCount / stats.providerRowCount;
    if (corruptionRate > 0.1) return "corruption_rate";
  }
  if (config.geckoLookback >= 50 && stats.validCount < 50) return "low_valid_count";
  return null;
}
