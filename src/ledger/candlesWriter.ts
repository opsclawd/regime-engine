import {
  CandleIngestRequest,
  CandleIngestRejection,
  CandleIngestResponse,
  GetLatestCandlesParams,
  CandleRow
} from "../contract/v1/types.js";
import type { LedgerStore } from "./store.js";
import { computeOhlcv, classifyCandle } from "./candleRevisionLogic.js";

interface ExistingLatest {
  source_recorded_at_unix_ms: number;
  source_recorded_at_iso: string;
  ohlcv_hash: string;
}

const selectLatest = (
  store: LedgerStore,
  feed: {
    symbol: string; source: string; network: string;
    poolAddress: string; timeframe: string;
  },
  unixMs: number
): ExistingLatest | undefined => {
  return store.db
    .prepare(
      `SELECT source_recorded_at_unix_ms, source_recorded_at_iso, ohlcv_hash
         FROM candle_revisions
        WHERE symbol = ? AND source = ? AND network = ?
          AND pool_address = ? AND timeframe = ? AND unix_ms = ?
        ORDER BY source_recorded_at_unix_ms DESC, id DESC
        LIMIT 1`
    )
    .get(
      feed.symbol, feed.source, feed.network,
      feed.poolAddress, feed.timeframe, unixMs
    ) as ExistingLatest | undefined;
};

const insertRevision = (
  store: LedgerStore,
  feed: {
    symbol: string; source: string; network: string;
    poolAddress: string; timeframe: string;
  },
  candle: CandleIngestRequest["candles"][number],
  sourceRecordedAtIso: string,
  sourceRecordedAtUnixMs: number,
  ohlcvCanonical: string,
  ohlcvHash: string,
  receivedAtUnixMs: number
): void => {
  store.db
    .prepare(
      `INSERT INTO candle_revisions (
         symbol, source, network, pool_address, timeframe, unix_ms,
         source_recorded_at_iso, source_recorded_at_unix_ms,
         open, high, low, close, volume,
         ohlcv_canonical, ohlcv_hash, received_at_unix_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      feed.symbol, feed.source, feed.network,
      feed.poolAddress, feed.timeframe, candle.unixMs,
      sourceRecordedAtIso, sourceRecordedAtUnixMs,
      candle.open, candle.high, candle.low, candle.close, candle.volume,
      ohlcvCanonical, ohlcvHash, receivedAtUnixMs
    );
};

export const writeCandles = (
  store: LedgerStore,
  input: CandleIngestRequest,
  receivedAtUnixMs: number
): Omit<CandleIngestResponse, "schemaVersion"> => {
  const incomingSourceRecordedAtUnixMs = Date.parse(input.sourceRecordedAtIso);
  if (!Number.isFinite(incomingSourceRecordedAtUnixMs)) {
    throw new Error(`Invalid sourceRecordedAtIso: ${input.sourceRecordedAtIso}`);
  }

  const feed = {
    symbol: input.symbol,
    source: input.source,
    network: input.network,
    poolAddress: input.poolAddress,
    timeframe: input.timeframe
  };

  let insertedCount = 0;
  let revisedCount = 0;
  let idempotentCount = 0;
  let rejectedCount = 0;
  const rejections: CandleIngestRejection[] = [];

  store.db.exec("BEGIN IMMEDIATE");
  try {
    for (const candle of input.candles) {
      const { ohlcvCanonical, ohlcvHash } = computeOhlcv(candle);

      const existing = selectLatest(store, feed, candle.unixMs);

      const decision = classifyCandle(
        existing ? { sourceRecordedAtUnixMs: existing.source_recorded_at_unix_ms, sourceRecordedAtIso: existing.source_recorded_at_iso, ohlcvHash: existing.ohlcv_hash } : undefined,
        ohlcvHash,
        incomingSourceRecordedAtUnixMs
      );

      switch (decision.kind) {
        case "insert":
          insertRevision(store, feed, candle, input.sourceRecordedAtIso, incomingSourceRecordedAtUnixMs, ohlcvCanonical, ohlcvHash, receivedAtUnixMs);
          insertedCount += 1;
          break;
        case "revise":
          insertRevision(store, feed, candle, input.sourceRecordedAtIso, incomingSourceRecordedAtUnixMs, ohlcvCanonical, ohlcvHash, receivedAtUnixMs);
          revisedCount += 1;
          break;
        case "idempotent":
          idempotentCount += 1;
          break;
        case "stale":
          rejectedCount += 1;
          rejections.push({
            unixMs: candle.unixMs,
            reason: "STALE_REVISION",
            existingSourceRecordedAtIso: decision.existingSourceRecordedAtIso,
          });
          break;
      }
    }

    store.db.exec("COMMIT");
  } catch (error) {
    try {
      store.db.exec("ROLLBACK");
    } catch (rollbackError) {
      console.error("ROLLBACK failed after writeCandles error:", rollbackError);
    }
    throw error;
  }

  rejections.sort((a, b) => a.unixMs - b.unixMs);

  return { insertedCount, revisedCount, idempotentCount, rejectedCount, rejections };
};

export type { GetLatestCandlesParams, CandleRow };

export const getLatestCandlesForFeed = (
  store: LedgerStore,
  params: GetLatestCandlesParams
): CandleRow[] => {
  const rows = store.db
    .prepare(
      `WITH latest_per_slot AS (
         SELECT unix_ms, open, high, low, close, volume,
                row_number() OVER (
                  PARTITION BY unix_ms
                  ORDER BY source_recorded_at_unix_ms DESC, id DESC
                ) AS rn
           FROM candle_revisions
          WHERE symbol = ? AND source = ? AND network = ?
            AND pool_address = ? AND timeframe = ?
            AND unix_ms <= ?
       )
       SELECT unix_ms, open, high, low, close, volume
         FROM (
           SELECT unix_ms, open, high, low, close, volume
             FROM latest_per_slot
            WHERE rn = 1
            ORDER BY unix_ms DESC
            LIMIT ?
         )
        ORDER BY unix_ms ASC`
    )
    .all(
      params.symbol, params.source, params.network,
      params.poolAddress, params.timeframe,
      params.closedCandleCutoffUnixMs, params.limit
    ) as Array<{
      unix_ms: number; open: number; high: number; low: number;
      close: number; volume: number;
    }>;

  return rows.map((row) => ({
    unixMs: row.unix_ms,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume
  }));
};