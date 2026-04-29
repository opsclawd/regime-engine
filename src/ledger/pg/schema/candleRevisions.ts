import {
  pgSchema,
  serial,
  varchar,
  bigint,
  doublePrecision,
  text,
  index
} from "drizzle-orm/pg-core";

export const PG_SCHEMA_NAME = "regime_engine";

export const regimeEngine = pgSchema(PG_SCHEMA_NAME);

export const candleRevisions = regimeEngine.table(
  "candle_revisions",
  {
    id: serial("id").primaryKey(),
    symbol: varchar("symbol", { length: 64 }).notNull(),
    source: varchar("source", { length: 64 }).notNull(),
    network: varchar("network", { length: 64 }).notNull(),
    poolAddress: varchar("pool_address", { length: 128 }).notNull(),
    timeframe: varchar("timeframe", { length: 16 }).notNull(),
    unixMs: bigint("unix_ms", { mode: "number" }).notNull(),
    sourceRecordedAtIso: varchar("source_recorded_at_iso", { length: 64 }).notNull(),
    sourceRecordedAtUnixMs: bigint("source_recorded_at_unix_ms", { mode: "number" }).notNull(),
    open: doublePrecision("open").notNull(),
    high: doublePrecision("high").notNull(),
    low: doublePrecision("low").notNull(),
    close: doublePrecision("close").notNull(),
    volume: doublePrecision("volume").notNull(),
    ohlcvCanonical: text("ohlcv_canonical").notNull(),
    ohlcvHash: varchar("ohlcv_hash", { length: 64 }).notNull(),
    receivedAtUnixMs: bigint("received_at_unix_ms", { mode: "number" }).notNull()
  },
  (table) => [
    index("idx_candle_revisions_slot_hash").on(
      table.symbol,
      table.source,
      table.network,
      table.poolAddress,
      table.timeframe,
      table.unixMs,
      table.ohlcvHash
    ),
    index("idx_candle_revisions_slot_latest").on(
      table.symbol,
      table.source,
      table.network,
      table.poolAddress,
      table.timeframe,
      table.unixMs,
      table.sourceRecordedAtUnixMs,
      table.id
    ),
    index("idx_candle_revisions_feed_window").on(
      table.symbol,
      table.source,
      table.network,
      table.poolAddress,
      table.timeframe,
      table.unixMs
    )
  ]
);
