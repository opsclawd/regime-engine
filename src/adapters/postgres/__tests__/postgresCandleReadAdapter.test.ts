import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../../../ledger/pg/db.js";
import { createPostgresCandleReadAdapter } from "../postgresCandleReadAdapter.js";
import { sql } from "drizzle-orm";

const FIFTEEN_MIN_MS = 15 * 60 * 1000;

const FEED = {
  symbol: "SOL/USDC-pg-win",
  source: "birdeye-pg-win",
  network: "solana-mainnet-pg-win",
  poolAddress: "PoolPgWin111",
  timeframe: "15m"
};

interface SeedRow {
  symbol: string;
  source: string;
  network: string;
  poolAddress: string;
  timeframe: string;
  unixMs: number;
  sourceRecordedAtUnixMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const seedRow = (overrides: Partial<SeedRow> = {}): SeedRow => ({
  symbol: FEED.symbol,
  source: FEED.source,
  network: FEED.network,
  poolAddress: FEED.poolAddress,
  timeframe: FEED.timeframe,
  unixMs: 1 * FIFTEEN_MIN_MS,
  sourceRecordedAtUnixMs: 1_700_000_000_000,
  open: 100,
  high: 110,
  low: 90,
  close: 105,
  volume: 1,
  ...overrides
});

describe.skipIf(!process.env.DATABASE_URL)("postgresCandleReadAdapter", () => {
  let db: ReturnType<typeof createDb>["db"];
  let adapter: ReturnType<typeof createPostgresCandleReadAdapter>;

  beforeAll(async () => {
    const result = createDb(process.env.DATABASE_URL!);
    db = result.db;
    adapter = createPostgresCandleReadAdapter(db);
  });

  afterEach(async () => {
    await db.execute(sql`
      DELETE FROM regime_engine.candle_revisions
      WHERE symbol = ${FEED.symbol}
        AND source = ${FEED.source}
        AND network = ${FEED.network}
        AND pool_address = ${FEED.poolAddress}
        AND timeframe = ${FEED.timeframe}
    `);
  });

  const insertRow = async (row: SeedRow) => {
    await db.execute(sql`
      INSERT INTO regime_engine.candle_revisions
        (symbol, source, network, pool_address, timeframe, unix_ms,
         source_recorded_at_iso, source_recorded_at_unix_ms,
         open, high, low, close, volume, ohlcv_canonical, ohlcv_hash, received_at_unix_ms)
      VALUES (
        ${row.symbol}, ${row.source}, ${row.network}, ${row.poolAddress},
        ${row.timeframe}, ${row.unixMs},
        '2026-04-26T12:00:00.000Z', ${row.sourceRecordedAtUnixMs},
        ${row.open}, ${row.high}, ${row.low}, ${row.close}, ${row.volume},
        'canonical', 'hash', 1_700_000_000_000
      )
    `);
  };

  describe("getCandlesForFeedWindow", () => {
    it("returns only the complete feed key within inclusive bounds in ascending order", async () => {
      await insertRow(seedRow({ unixMs: 1 * FIFTEEN_MIN_MS }));
      await insertRow(seedRow({ unixMs: 2 * FIFTEEN_MIN_MS }));
      await insertRow(seedRow({ unixMs: 3 * FIFTEEN_MIN_MS }));
      await insertRow(seedRow({ unixMs: 4 * FIFTEEN_MIN_MS }));
      await insertRow(seedRow({ unixMs: 5 * FIFTEEN_MIN_MS }));
      await insertRow(
        seedRow({
          symbol: "OTHER/USD-pg-win",
          poolAddress: "OtherPoolPgWin"
        })
      );

      const result = await adapter.getCandlesForFeedWindow({
        symbol: FEED.symbol,
        source: FEED.source,
        network: FEED.network,
        poolAddress: FEED.poolAddress,
        timeframe: FEED.timeframe,
        fromUnixMs: 2 * FIFTEEN_MIN_MS,
        closedCandleCutoffUnixMs: 4 * FIFTEEN_MIN_MS
      });

      expect(result.length).toBe(3);
      expect(result.map((c) => c.unixMs)).toEqual([
        2 * FIFTEEN_MIN_MS,
        3 * FIFTEEN_MIN_MS,
        4 * FIFTEEN_MIN_MS
      ]);
      expect(
        result.every(
          (c) => "open" in c && "high" in c && "low" in c && "close" in c && "volume" in c
        )
      ).toBe(true);
    });

    it("returns the newest revision per slot and uses id as the tie breaker", async () => {
      await insertRow(
        seedRow({
          unixMs: 1 * FIFTEEN_MIN_MS,
          sourceRecordedAtUnixMs: 1_700_000_000_000,
          open: 100,
          high: 110,
          low: 90,
          close: 105
        })
      );
      await insertRow(
        seedRow({
          unixMs: 1 * FIFTEEN_MIN_MS,
          sourceRecordedAtUnixMs: 1_700_000_001_000,
          open: 101,
          high: 111,
          low: 91,
          close: 106
        })
      );
      await insertRow(
        seedRow({
          unixMs: 1 * FIFTEEN_MIN_MS,
          sourceRecordedAtUnixMs: 1_700_000_001_000,
          open: 102,
          high: 112,
          low: 92,
          close: 107
        })
      );

      const result = await adapter.getCandlesForFeedWindow({
        symbol: FEED.symbol,
        source: FEED.source,
        network: FEED.network,
        poolAddress: FEED.poolAddress,
        timeframe: FEED.timeframe,
        fromUnixMs: 0,
        closedCandleCutoffUnixMs: 100 * FIFTEEN_MIN_MS
      });

      expect(result.length).toBe(1);
      expect(result[0].close).toBe(107);
    });

    it("returns an empty array when the feed window has no rows", async () => {
      await insertRow(seedRow({ unixMs: 1 * FIFTEEN_MIN_MS }));
      await insertRow(seedRow({ unixMs: 2 * FIFTEEN_MIN_MS }));

      const result = await adapter.getCandlesForFeedWindow({
        symbol: FEED.symbol,
        source: FEED.source,
        network: FEED.network,
        poolAddress: FEED.poolAddress,
        timeframe: FEED.timeframe,
        fromUnixMs: 50 * FIFTEEN_MIN_MS,
        closedCandleCutoffUnixMs: 60 * FIFTEEN_MIN_MS
      });

      expect(result).toEqual([]);
    });
  });
});
