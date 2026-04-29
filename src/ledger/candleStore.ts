import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { candleRevisions, PG_SCHEMA_NAME } from "./pg/schema/candleRevisions.js";
import type { Db } from "./pg/db.js";
import { sha256Hex } from "../contract/v1/hash.js";
import type {
  CandleIngestRequest,
  CandleIngestRejection,
  CandleIngestResponse,
  GetLatestCandlesParams,
  CandleRow
} from "../contract/v1/types.js";
import { computeOhlcv, classifyCandle, type ExistingLatest } from "./candleRevisionLogic.js";

export type { GetLatestCandlesParams, CandleRow };

const QUALIFIED_TABLE = `${PG_SCHEMA_NAME}.candle_revisions`;

const feedHash = (feed: {
  symbol: string; source: string; network: string;
  poolAddress: string; timeframe: string;
}): bigint => {
  const combined = `${feed.symbol}\0${feed.source}\0${feed.network}\0${feed.poolAddress}\0${feed.timeframe}`;
  const hex = sha256Hex(combined);
  return BigInt("0x" + hex.slice(0, 15)) || 1n;
};

export class CandleStore {
  constructor(private db: Db) {}

  async writeCandles(
    input: CandleIngestRequest,
    receivedAtUnixMs: number
  ): Promise<Omit<CandleIngestResponse, "schemaVersion">> {
    const incomingSourceRecordedAtUnixMs = Date.parse(input.sourceRecordedAtIso);
    if (!Number.isFinite(incomingSourceRecordedAtUnixMs)) {
      throw new Error(`Invalid sourceRecordedAtIso: ${input.sourceRecordedAtIso}`);
    }

    const feed = {
      symbol: input.symbol,
      source: input.source,
      network: input.network,
      poolAddress: input.poolAddress,
      timeframe: input.timeframe,
    };

    const lockKey = feedHash(feed);

    let insertedCount = 0;
    let revisedCount = 0;
    let idempotentCount = 0;
    let rejectedCount = 0;
    const rejections: CandleIngestRejection[] = [];

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`);

      const unixMsValues = input.candles.map((c) => c.unixMs);

      const existingRows = await tx
        .select({
          unixMs: candleRevisions.unixMs,
          sourceRecordedAtUnixMs: candleRevisions.sourceRecordedAtUnixMs,
          sourceRecordedAtIso: candleRevisions.sourceRecordedAtIso,
          ohlcvHash: candleRevisions.ohlcvHash,
        })
        .from(candleRevisions)
        .where(and(
          eq(candleRevisions.symbol, feed.symbol),
          eq(candleRevisions.source, feed.source),
          eq(candleRevisions.network, feed.network),
          eq(candleRevisions.poolAddress, feed.poolAddress),
          eq(candleRevisions.timeframe, feed.timeframe),
          inArray(candleRevisions.unixMs, unixMsValues),
        ))
        .orderBy(
          desc(candleRevisions.sourceRecordedAtUnixMs),
          desc(candleRevisions.id)
        );

      const existingBySlot = new Map<number, ExistingLatest>();
      for (const row of existingRows) {
        if (!existingBySlot.has(row.unixMs)) {
          existingBySlot.set(row.unixMs, row);
        }
      }

      const toInsert: typeof candleRevisions.$inferInsert[] = [];

      for (const candle of input.candles) {
        const { ohlcvCanonical, ohlcvHash } = computeOhlcv(candle);
        const existing = existingBySlot.get(candle.unixMs);
        const decision = classifyCandle(existing, ohlcvHash, incomingSourceRecordedAtUnixMs);

        switch (decision.kind) {
          case "insert":
          case "revise":
            toInsert.push({
              ...feed,
              unixMs: candle.unixMs,
              sourceRecordedAtIso: input.sourceRecordedAtIso,
              sourceRecordedAtUnixMs: incomingSourceRecordedAtUnixMs,
              open: candle.open,
              high: candle.high,
              low: candle.low,
              close: candle.close,
              volume: candle.volume,
              ohlcvCanonical,
              ohlcvHash,
              receivedAtUnixMs,
            });
            if (decision.kind === "insert") insertedCount += 1;
            else revisedCount += 1;
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

      if (toInsert.length > 0) {
        await tx.insert(candleRevisions).values(toInsert);
      }
    });

    rejections.sort((a, b) => a.unixMs - b.unixMs);

    return { insertedCount, revisedCount, idempotentCount, rejectedCount, rejections };
  }

  async getLatestCandlesForFeed(
    params: GetLatestCandlesParams
  ): Promise<CandleRow[]> {
    const rows = await this.db.execute(sql`
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
        )
       ORDER BY unix_ms ASC
    `);

    return rows.map((row: Record<string, unknown>) => {
      const unixMs = row.unix_ms;
      const open = row.open;
      const high = row.high;
      const low = row.low;
      const close = row.close;
      const volume = row.volume;

      if (unixMs == null || open == null || high == null || low == null || close == null || volume == null) {
        throw new Error(`Unexpected null in candle_revisions row: ${JSON.stringify(row)}`);
      }

      return {
        unixMs: Number(unixMs),
        open: Number(open),
        high: Number(high),
        low: Number(low),
        close: Number(close),
        volume: Number(volume),
      };
    });
  }
}