import {
  bigint,
  check,
  index,
  jsonb,
  serial,
  text,
  uniqueIndex,
  varchar
} from "drizzle-orm/pg-core";
import { regimeEngine } from "./candleRevisions.js";
import { sql } from "drizzle-orm";

export const policyInsights = regimeEngine.table(
  "policy_insights",
  {
    id: serial("id").primaryKey(),
    insightId: varchar("insight_id", { length: 64 }).notNull(),
    schemaVersion: varchar("schema_version", { length: 32 }).notNull(),
    rulesetVersion: varchar("ruleset_version", { length: 32 }).notNull(),
    pair: varchar("pair", { length: 32 }).notNull(),
    scopeKey: varchar("scope_key", { length: 256 }).notNull(),
    positionId: varchar("position_id", { length: 64 }),
    generatedAtUnixMs: bigint("generated_at_unix_ms", { mode: "number" }).notNull(),
    asOfUnixMs: bigint("as_of_unix_ms", { mode: "number" }).notNull(),
    expiresAtUnixMs: bigint("expires_at_unix_ms", { mode: "number" }).notNull(),
    persistedAtUnixMs: bigint("persisted_at_unix_ms", { mode: "number" }).notNull(),
    marketHash: varchar("market_hash", { length: 64 }).notNull(),
    positionHash: varchar("position_hash", { length: 64 }).notNull(),
    selectionHash: varchar("selection_hash", { length: 64 }).notNull(),
    synthesisInputHash: varchar("synthesis_input_hash", { length: 64 }).notNull(),
    wireContractSha256: varchar("wire_contract_sha256", { length: 64 }).notNull().default(""),
    selectionPolicyVersion: varchar("selection_policy_version", { length: 64 }).notNull(),
    synthesisInputJson: jsonb("synthesis_input_json").notNull(),
    synthesisOutputJson: jsonb("synthesis_output_json").notNull(),
    payloadCanonical: text("payload_canonical").notNull(),
    payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
    selectedLineageJson: jsonb("selected_lineage_json").notNull(),
    excludedLineageJson: jsonb("excluded_lineage_json").notNull()
  },
  (t) => [
    check("chk_policy_insight_v1", sql`${t.schemaVersion} = 'policy-insight.v1'`),
    check("chk_policy_insight_pair", sql`${t.pair} = 'SOL/USDC'`),
    check(
      "chk_policy_insight_timestamps",
      sql`${t.asOfUnixMs} <= ${t.generatedAtUnixMs} AND ${t.generatedAtUnixMs} <= ${t.persistedAtUnixMs} AND ${t.generatedAtUnixMs} < ${t.expiresAtUnixMs}`
    ),
    check("chk_policy_insight_id_format", sql`${t.insightId} ~ '^[0-9a-f]{64}$'`),
    check("chk_policy_insight_market_hash", sql`${t.marketHash} ~ '^[0-9a-f]{64}$'`),
    check("chk_policy_insight_position_hash", sql`${t.positionHash} ~ '^[0-9a-f]{64}$'`),
    check("chk_policy_insight_selection_hash", sql`${t.selectionHash} ~ '^[0-9a-f]{64}$'`),
    check(
      "chk_policy_insight_synthesis_input_hash",
      sql`${t.synthesisInputHash} ~ '^[0-9a-f]{64}$'`
    ),
    check("chk_policy_insight_payload_hash", sql`${t.payloadHash} ~ '^[0-9a-f]{64}$'`),
    check(
      "chk_policy_insight_wire_contract_sha256",
      sql`${t.wireContractSha256} = '' OR ${t.wireContractSha256} ~ '^[0-9a-f]{64}$'`
    ),

    uniqueIndex("uniq_policy_insights_insight_id").on(t.insightId),
    uniqueIndex("uniq_policy_insights_synthesis_input").on(
      t.schemaVersion,
      t.wireContractSha256,
      t.rulesetVersion,
      t.synthesisInputHash
    ),
    index("idx_policy_insights_current").on(t.pair, t.scopeKey, t.generatedAtUnixMs, t.id),
    index("idx_policy_insights_history").on(t.pair, t.scopeKey, t.generatedAtUnixMs, t.id)
  ]
);

export type PolicyInsightRow = typeof policyInsights.$inferSelect;
export type PolicyInsightInsert = typeof policyInsights.$inferInsert;
