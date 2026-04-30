import {
  bigint,
  index,
  serial,
  text,
  uniqueIndex,
  varchar
} from "drizzle-orm/pg-core";
import { regimeEngine } from "./candleRevisions.js";

export const srThesesV2 = regimeEngine.table(
  "sr_theses_v2",
  {
    id: serial("id").primaryKey(),
    schemaVersion: varchar("schema_version", { length: 16 }).notNull(),
    source: varchar("source", { length: 64 }).notNull(),
    symbol: varchar("symbol", { length: 64 }).notNull(),
    briefId: varchar("brief_id", { length: 256 }).notNull(),
    sourceRecordedAtIso: text("source_recorded_at_iso"),
    summary: text("summary"),
    capturedAtIso: varchar("captured_at_iso", { length: 64 }).notNull(),
    capturedAtUnixMs: bigint("captured_at_unix_ms", {
      mode: "number"
    }).notNull(),
    asset: varchar("asset", { length: 64 }).notNull(),
    timeframe: varchar("timeframe", { length: 64 }).notNull(),
    bias: text("bias"),
    setupType: text("setup_type"),
    supportLevels: text("support_levels")
      .notNull()
      .array()
      .notNull(),
    resistanceLevels: text("resistance_levels")
      .notNull()
      .array()
      .notNull(),
    entryZone: text("entry_zone"),
    targets: text("targets")
      .notNull()
      .array()
      .notNull(),
    invalidation: text("invalidation"),
    triggerText: text("trigger_text"),
    chartReference: text("chart_reference"),
    sourceHandle: varchar("source_handle", { length: 256 }).notNull(),
    sourceChannel: text("source_channel"),
    sourceKind: varchar("source_kind", { length: 64 }).notNull(),
    sourceReliability: text("source_reliability"),
    rawThesisText: text("raw_thesis_text"),
    collectedAtIso: text("collected_at_iso"),
    publishedAtIso: text("published_at_iso"),
    sourceUrl: text("source_url"),
    notes: text("notes"),
    payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
    receivedAtUnixMs: bigint("received_at_unix_ms", {
      mode: "number"
    }).notNull()
  },
  (t) => [
    uniqueIndex("uniq_sr_theses_v2_idempotency").on(
      t.source,
      t.symbol,
      t.briefId,
      t.asset,
      t.sourceHandle
    ),
    index("idx_sr_theses_v2_symbol_received").on(
      t.symbol,
      t.source,
      t.capturedAtUnixMs,
      t.id
    ),
    index("idx_sr_theses_v2_source_brief").on(
      t.source,
      t.briefId,
      t.capturedAtUnixMs,
      t.id
    )
  ]
);

export type SrThesesV2Row = typeof srThesesV2.$inferSelect;
export type SrThesesV2Insert = typeof srThesesV2.$inferInsert;