import type { LedgerStore } from "../../ledger/store.js";
import type {
  CandleReadPort,
  GetCandlesForFeedWindowParams
} from "../../application/ports/candlePorts.js";
import type { CandleRow, GetLatestCandlesParams } from "../../contract/v1/types.js";

interface RawRow {
  unix_ms: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const mapRow = (row: RawRow): CandleRow => ({
  unixMs: row.unix_ms,
  open: row.open,
  high: row.high,
  low: row.low,
  close: row.close,
  volume: row.volume
});

export const createSqliteCandleReadAdapter = (store: LedgerStore): CandleReadPort => {
  return {
    getLatestCandlesForFeed: async (params: GetLatestCandlesParams): Promise<CandleRow[]> => {
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
          params.symbol,
          params.source,
          params.network,
          params.poolAddress,
          params.timeframe,
          params.closedCandleCutoffUnixMs,
          params.limit
        ) as unknown as RawRow[];

      return rows.map(mapRow);
    },

    getCandlesForFeedWindow: async (
      params: GetCandlesForFeedWindowParams
    ): Promise<CandleRow[]> => {
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
                AND unix_ms >= ? AND unix_ms <= ?
            )
           SELECT unix_ms, open, high, low, close, volume
             FROM latest_per_slot
            WHERE rn = 1
            ORDER BY unix_ms ASC`
        )
        .all(
          params.symbol,
          params.source,
          params.network,
          params.poolAddress,
          params.timeframe,
          params.fromUnixMs,
          params.closedCandleCutoffUnixMs
        ) as unknown as RawRow[];

      return rows.map(mapRow);
    }
  };
};
