import { eq, and, desc, sql } from "drizzle-orm";
import { candleRevisions } from "./pg/schema/candleRevisions.js";
import type { Db } from "./pg/db.js";
import { toCanonicalJson } from "../contract/v1/canonical.js";
import { sha256Hex } from "../contract/v1/hash.js";
import type {
  CandleIngestRequest,
  CandleIngestRejection,
  CandleIngestResponse
} from "../contract/v1/types.js";

export interface GetLatestCandlesParams {
  symbol: string;
  source: string;
  network: string;
  poolAddress: string;
  timeframe: string;
  closedCandleCutoffUnixMs: number;
  limit: number;
}

export interface CandleRow {
  unixMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const computeOhlcv = (candle: { open: number; high: number; low: number; close: number; volume: number }) => {
  const ohlcvCanonical = toCanonicalJson({
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
  });
  const ohlcvHash = sha256Hex(ohlcvCanonical);
  return { ohlcvCanonical, ohlcvHash };
};

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

      for (const candle of input.candles) {
        const { ohlcvCanonical, ohlcvHash } = computeOhlcv(candle);

        const existing = await tx
          .select({
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
            eq(candleRevisions.unixMs, candle.unixMs),
          ))
          .orderBy(
            desc(candleRevisions.sourceRecordedAtUnixMs),
            desc(candleRevisions.id)
          )
          .limit(1);

        if (existing.length === 0) {
          await tx.insert(candleRevisions).values({
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
          insertedCount += 1;
          continue;
        }

        const row = existing[0];
        if (row.ohlcvHash === ohlcvHash) {
          idempotentCount += 1;
          continue;
        }

        if (row.sourceRecordedAtUnixMs < incomingSourceRecordedAtUnixMs) {
          await tx.insert(candleRevisions).values({
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
          revisedCount += 1;
          continue;
        }

        rejectedCount += 1;
        rejections.push({
          unixMs: candle.unixMs,
          reason: "STALE_REVISION",
          existingSourceRecordedAtIso: row.sourceRecordedAtIso,
        });
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
          FROM regime_engine.candle_revisions
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

    return rows.map((row: Record<string, unknown>) => ({
      unixMs: Number(row.unix_ms),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number(row.volume),
    }));
  }
}