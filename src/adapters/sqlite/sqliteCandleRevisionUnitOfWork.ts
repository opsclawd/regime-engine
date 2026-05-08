import type { LedgerStore } from "../../ledger/store.js";
import type {
  CandleFeed,
  CandleIngestSession,
  CandleRevisionInsert,
  CandleWritePort,
  ExistingLatestCandleRevision
} from "../../application/ports/candlePorts.js";

interface ExistingRow {
  source_recorded_at_unix_ms: number;
  source_recorded_at_iso: string;
  ohlcv_hash: string;
}

const buildSession = (store: LedgerStore, feed: CandleFeed): CandleIngestSession => {
  return {
    readLatestRevisions: async (unixMsValues: number[]) => {
      const stmt = store.db.prepare(
        `SELECT source_recorded_at_unix_ms, source_recorded_at_iso, ohlcv_hash
           FROM candle_revisions
          WHERE symbol = ? AND source = ? AND network = ?
            AND pool_address = ? AND timeframe = ? AND unix_ms = ?
          ORDER BY source_recorded_at_unix_ms DESC, id DESC
          LIMIT 1`
      );
      const result = new Map<number, ExistingLatestCandleRevision>();
      for (const unixMs of unixMsValues) {
        const row = stmt.get(
          feed.symbol,
          feed.source,
          feed.network,
          feed.poolAddress,
          feed.timeframe,
          unixMs
        ) as ExistingRow | undefined;
        if (row) {
          result.set(unixMs, {
            sourceRecordedAtUnixMs: row.source_recorded_at_unix_ms,
            sourceRecordedAtIso: row.source_recorded_at_iso,
            ohlcvHash: row.ohlcv_hash
          });
        }
      }
      return result;
    },
    insertRevisions: async (revisions: CandleRevisionInsert[]) => {
      const stmt = store.db.prepare(
        `INSERT INTO candle_revisions (
           symbol, source, network, pool_address, timeframe, unix_ms,
           source_recorded_at_iso, source_recorded_at_unix_ms,
           open, high, low, close, volume,
           ohlcv_canonical, ohlcv_hash, received_at_unix_ms
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const r of revisions) {
        stmt.run(
          r.feed.symbol,
          r.feed.source,
          r.feed.network,
          r.feed.poolAddress,
          r.feed.timeframe,
          r.unixMs,
          r.sourceRecordedAtIso,
          r.sourceRecordedAtUnixMs,
          r.open,
          r.high,
          r.low,
          r.close,
          r.volume,
          r.ohlcvCanonical,
          r.ohlcvHash,
          r.receivedAtUnixMs
        );
      }
    }
  };
};

export const createSqliteCandleRevisionUnitOfWork = (store: LedgerStore): CandleWritePort => {
  return {
    withIngestLock: async (feed, _unixMsValues, fn) => {
      store.db.exec("BEGIN IMMEDIATE");
      try {
        const result = await fn(buildSession(store, feed));
        store.db.exec("COMMIT");
        return result;
      } catch (error) {
        try {
          store.db.exec("ROLLBACK");
        } catch (rollbackError) {
          console.error("ROLLBACK failed in SQLite candle ingest unit-of-work:", rollbackError);
        }
        throw error;
      }
    }
  };
};
