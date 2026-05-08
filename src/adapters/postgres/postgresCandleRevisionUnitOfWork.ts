import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../../ledger/pg/db.js";
import { candleRevisions } from "../../ledger/pg/schema/candleRevisions.js";
import { sha256Hex } from "../../contract/v1/hash.js";
import type {
  CandleFeed,
  CandleIngestSession,
  CandleRevisionInsert,
  CandleWritePort,
  ExistingLatestCandleRevision
} from "../../application/ports/candlePorts.js";

const feedHash = (feed: CandleFeed): bigint => {
  const combined = `${feed.symbol}\0${feed.source}\0${feed.network}\0${feed.poolAddress}\0${feed.timeframe}`;
  const hex = sha256Hex(combined);
  return BigInt("0x" + hex.slice(0, 15)) || 1n;
};

export const createPostgresCandleRevisionUnitOfWork = (db: Db): CandleWritePort => {
  return {
    withIngestLock: async (feed, _unixMsValues, fn) => {
      const lockKey = feedHash(feed);
      return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`);

        const session: CandleIngestSession = {
          readLatestRevisions: async (slots: number[]) => {
            const result = new Map<number, ExistingLatestCandleRevision>();
            if (slots.length === 0) {
              return result;
            }
            const rows = await tx
              .select({
                unixMs: candleRevisions.unixMs,
                sourceRecordedAtUnixMs: candleRevisions.sourceRecordedAtUnixMs,
                sourceRecordedAtIso: candleRevisions.sourceRecordedAtIso,
                ohlcvHash: candleRevisions.ohlcvHash
              })
              .from(candleRevisions)
              .where(
                and(
                  eq(candleRevisions.symbol, feed.symbol),
                  eq(candleRevisions.source, feed.source),
                  eq(candleRevisions.network, feed.network),
                  eq(candleRevisions.poolAddress, feed.poolAddress),
                  eq(candleRevisions.timeframe, feed.timeframe),
                  inArray(candleRevisions.unixMs, slots)
                )
              )
              .orderBy(desc(candleRevisions.sourceRecordedAtUnixMs), desc(candleRevisions.id));

            for (const row of rows) {
              if (!result.has(row.unixMs)) {
                result.set(row.unixMs, {
                  sourceRecordedAtUnixMs: row.sourceRecordedAtUnixMs,
                  sourceRecordedAtIso: row.sourceRecordedAtIso,
                  ohlcvHash: row.ohlcvHash
                });
              }
            }
            return result;
          },
          insertRevisions: async (revisions: CandleRevisionInsert[]) => {
            if (revisions.length === 0) {
              return;
            }
            const values = revisions.map((r) => ({
              symbol: r.feed.symbol,
              source: r.feed.source,
              network: r.feed.network,
              poolAddress: r.feed.poolAddress,
              timeframe: r.feed.timeframe,
              unixMs: r.unixMs,
              sourceRecordedAtIso: r.sourceRecordedAtIso,
              sourceRecordedAtUnixMs: r.sourceRecordedAtUnixMs,
              open: r.open,
              high: r.high,
              low: r.low,
              close: r.close,
              volume: r.volume,
              ohlcvCanonical: r.ohlcvCanonical,
              ohlcvHash: r.ohlcvHash,
              receivedAtUnixMs: r.receivedAtUnixMs
            }));
            await tx.insert(candleRevisions).values(values);
          }
        };

        return fn(session);
      });
    }
  };
};
