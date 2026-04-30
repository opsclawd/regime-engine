import { bigint, index, jsonb, serial, text, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { regimeEngine } from "./candleRevisions.js";

export const clmmInsights = regimeEngine.table(
  "clmm_insights",
  {
    id: serial("id").primaryKey(),
    schemaVersion: varchar("schema_version", { length: 16 }).notNull(),
    pair: varchar("pair", { length: 32 }).notNull(),
    asOfUnixMs: bigint("as_of_unix_ms", { mode: "number" }).notNull(),
    source: varchar("source", { length: 64 }).notNull(),
    runId: varchar("run_id", { length: 256 }).notNull(),
    marketRegime: varchar("market_regime", { length: 64 }).notNull(),
    fundamentalRegime: varchar("fundamental_regime", { length: 64 }).notNull(),
    recommendedAction: varchar("recommended_action", { length: 64 }).notNull(),
    confidence: varchar("confidence", { length: 16 }).notNull(),
    riskLevel: varchar("risk_level", { length: 16 }).notNull(),
    dataQuality: varchar("data_quality", { length: 16 }).notNull(),
    clmmPolicyJson: jsonb("clmm_policy_json").notNull(),
    levelsJson: jsonb("levels_json").notNull(),
    reasoningJson: jsonb("reasoning_json").notNull(),
    sourceRefsJson: jsonb("source_refs_json").notNull(),
    payloadCanonical: text("payload_canonical").notNull(),
    payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
    expiresAtUnixMs: bigint("expires_at_unix_ms", { mode: "number" }).notNull(),
    receivedAtUnixMs: bigint("received_at_unix_ms", { mode: "number" }).notNull()
  },
  (t) => [
    uniqueIndex("uniq_clmm_insights_source_run").on(t.source, t.runId),
    index("idx_clmm_insights_pair_as_of").on(t.pair, t.asOfUnixMs, t.id),
    index("idx_clmm_insights_pair_received").on(t.pair, t.receivedAtUnixMs, t.id)
  ]
);

export type ClmmInsightRow = typeof clmmInsights.$inferSelect;
export type ClmmInsightInsert = typeof clmmInsights.$inferInsert;
