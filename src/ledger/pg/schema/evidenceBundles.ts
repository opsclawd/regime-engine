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

export const evidenceBundles = regimeEngine.table(
  "evidence_bundles",
  {
    id: serial("id").primaryKey(),
    schemaVersion: varchar("schema_version", { length: 32 }).notNull(),
    sourcePublisher: varchar("source_publisher", { length: 64 }).notNull(),
    sourceId: varchar("source_id", { length: 256 }).notNull(),
    runId: varchar("run_id", { length: 256 }).notNull(),
    pair: varchar("pair", { length: 32 }).notNull(),
    scopeKey: varchar("scope_key", { length: 256 }).notNull(),
    correlationId: varchar("correlation_id", { length: 64 }).notNull(),
    asOfUnixMs: bigint("as_of_unix_ms", { mode: "number" }).notNull(),
    createdAtUnixMs: bigint("created_at_unix_ms", { mode: "number" }).notNull(),
    receivedAtUnixMs: bigint("received_at_unix_ms", { mode: "number" }).notNull(),
    freshUntilUnixMs: bigint("fresh_until_unix_ms", { mode: "number" }).notNull(),
    expiresAtUnixMs: bigint("expires_at_unix_ms", { mode: "number" }).notNull(),
    evidenceJson: jsonb("evidence_json").notNull(),
    evidenceCanonical: text("evidence_canonical").notNull(),
    evidenceHash: varchar("evidence_hash", { length: 64 }).notNull(),
    ingestedAtUnixMs: bigint("ingested_at_unix_ms", { mode: "number" }).notNull(),
    processedAtUnixMs: bigint("processed_at_unix_ms", { mode: "number" }).notNull()
  },
  (t) => [
    check("chk_evidence_bundle_v1", sql`${t.schemaVersion} = 'evidence-bundle.v1'`),
    check("chk_sol_usdc_pair", sql`${t.pair} = 'SOL/USDC'`),
    check(
      "chk_timestamp_ordering",
      sql`${t.asOfUnixMs} <= ${t.createdAtUnixMs} AND ${t.createdAtUnixMs} < ${t.freshUntilUnixMs} AND ${t.freshUntilUnixMs} <= ${t.expiresAtUnixMs}`
    ),
    check("chk_evidence_hash_format", sql`${t.evidenceHash} ~ '^[0-9a-f]{64}$'`),
    uniqueIndex("uniq_evidence_bundles_source_run").on(
      t.schemaVersion,
      t.sourcePublisher,
      t.sourceId,
      t.runId
    ),
    index("idx_evidence_bundles_current").on(
      t.pair,
      t.scopeKey,
      t.sourcePublisher,
      t.sourceId,
      t.asOfUnixMs,
      t.id
    ),
    index("idx_evidence_bundles_history").on(t.pair, t.scopeKey, t.receivedAtUnixMs, t.id),
    index("idx_evidence_bundles_correlation").on(t.correlationId, t.id)
  ]
);

export type EvidenceBundleRow = typeof evidenceBundles.$inferSelect;
export type EvidenceBundleInsert = typeof evidenceBundles.$inferInsert;
