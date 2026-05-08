import { sql } from "drizzle-orm";
import type { Db } from "../../ledger/pg/db.js";
import { PG_SCHEMA_NAME } from "../../ledger/pg/schema/candleRevisions.js";
import type { CandleReadPort } from "../../application/ports/candlePorts.js";
import type { CandleRow, GetLatestCandlesParams } from "../../contract/v1/types.js";

const QUALIFIED_TABLE = `${PG_SCHEMA_NAME}.candle_revisions`;

export const createPostgresCandleReadAdapter = (db: Db): CandleReadPort => {
  return {
    getLatestCandlesForFeed: async (params: GetLatestCandlesParams): Promise<CandleRow[]> => {
      const rows = await db.execute(sql`
        WITH latest_per_slot AS (
          SELECT unix_ms, open, high, low, close, volume,
                 row_number() OVER (
                   PARTITION BY unix_ms
                   ORDER BY source_recorded_at_unix_ms DESC, id DESC
                 ) AS rn
            FROM ${sql.raw(QUALIFIED_TABLE)}
           WHERE symbol = ${params.symbol}
             AND source = ${params.source}
             AND network = ${params.network}
             AND pool_address = ${params.poolAddress}
             AND timeframe = ${params.timeframe}
             AND unix_ms <= ${params.closedCandleCutoffUnixMs}
        )
        SELECT unix_ms, open, high, low, close, volume
          FROM (
            SELECT unix_ms, open, high, low, close, volume
              FROM latest_per_slot
             WHERE rn = 1
             ORDER BY unix_ms DESC
             LIMIT ${params.limit}
          ) AS latest
         ORDER BY unix_ms ASC
      `);

      return rows.map((row: Record<string, unknown>) => {
        const unixMs = row.unix_ms;
        const open = row.open;
        const high = row.high;
        const low = row.low;
        const close = row.close;
        const volume = row.volume;

        if (
          unixMs == null ||
          open == null ||
          high == null ||
          low == null ||
          close == null ||
          volume == null
        ) {
          throw new Error(`Unexpected null in candle_revisions row: ${JSON.stringify(row)}`);
        }

        return {
          unixMs: Number(unixMs),
          open: Number(open),
          high: Number(high),
          low: Number(low),
          close: Number(close),
          volume: Number(volume)
        };
      });
    }
  };
};
