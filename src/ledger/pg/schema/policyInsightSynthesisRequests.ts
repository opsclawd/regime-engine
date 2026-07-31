import { bigint, check, index, integer, serial, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { regimeEngine } from "./candleRevisions.js";
import { sql } from "drizzle-orm";

export const policyInsightSynthesisRequests = regimeEngine.table(
  "policy_insight_synthesis_requests",
  {
    id: serial("id").primaryKey(),
    scopeKey: varchar("scope_key", { length: 256 }).notNull(),
    selectionHash: varchar("selection_hash", { length: 64 }),
    planHash: varchar("plan_hash", { length: 64 }),
    rulesetVersion: varchar("ruleset_version", { length: 32 }).notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    attemptCount: integer("attempt_count").notNull(),
    nextAttemptAtUnixMs: bigint("next_attempt_at_unix_ms", { mode: "number" }),
    leaseOwner: varchar("lease_owner", { length: 128 }),
    leaseExpiresAtUnixMs: bigint("lease_expires_at_unix_ms", { mode: "number" }),
    lastErrorCode: varchar("last_error_code", { length: 64 }),
    lastErrorMessage: varchar("last_error_message", { length: 2048 }),
    createdAtUnixMs: bigint("created_at_unix_ms", { mode: "number" }).notNull(),
    updatedAtUnixMs: bigint("updated_at_unix_ms", { mode: "number" }).notNull()
  },
  (t) => [
    check(
      "chk_synthesis_requests_non_negative",
      sql`${t.attemptCount} >= 0 AND ${t.createdAtUnixMs} >= 0 AND ${t.updatedAtUnixMs} >= 0 AND (${t.nextAttemptAtUnixMs} IS NULL OR ${t.nextAttemptAtUnixMs} >= 0) AND (${t.leaseExpiresAtUnixMs} IS NULL OR ${t.leaseExpiresAtUnixMs} >= 0)`
    ),
    check(
      "chk_synthesis_requests_status",
      sql`${t.status} IN ('waiting_for_plan', 'waiting_for_evidence', 'pending', 'processing', 'completed', 'failed', 'superseded')`
    ),
    check(
      "chk_synthesis_requests_hashes",
      sql`(${t.status} = 'waiting_for_plan' AND ${t.selectionHash} IS NOT NULL AND ${t.planHash} IS NULL) OR (${t.status} = 'waiting_for_evidence' AND ${t.selectionHash} IS NULL AND ${t.planHash} IS NOT NULL) OR (${t.status} NOT IN ('waiting_for_plan', 'waiting_for_evidence') AND ${t.selectionHash} IS NOT NULL AND ${t.planHash} IS NOT NULL)`
    ),
    check(
      "chk_synthesis_requests_lease_coherence",
      sql`(${t.status} = 'processing' AND ${t.leaseOwner} IS NOT NULL AND ${t.leaseExpiresAtUnixMs} IS NOT NULL) OR (${t.status} <> 'processing' AND ${t.leaseOwner} IS NULL AND ${t.leaseExpiresAtUnixMs} IS NULL)`
    ),
    check(
      "chk_synthesis_requests_hash_format",
      sql`(${t.selectionHash} IS NULL OR ${t.selectionHash} ~ '^[0-9a-f]{64}$') AND (${t.planHash} IS NULL OR ${t.planHash} ~ '^[0-9a-f]{64}$')`
    ),

    uniqueIndex("uniq_synthesis_requests_ready")
      .on(t.scopeKey, t.selectionHash, t.planHash, t.rulesetVersion)
      .where(sql`${t.selectionHash} IS NOT NULL AND ${t.planHash} IS NOT NULL`),
    uniqueIndex("uniq_synthesis_requests_waiting_plan")
      .on(t.scopeKey, t.selectionHash, t.rulesetVersion)
      .where(sql`${t.status} = 'waiting_for_plan'`),
    uniqueIndex("uniq_synthesis_requests_waiting_evidence")
      .on(t.scopeKey, t.planHash, t.rulesetVersion)
      .where(sql`${t.status} = 'waiting_for_evidence'`),

    index("idx_synthesis_requests_claim").on(
      t.status,
      t.nextAttemptAtUnixMs,
      t.leaseExpiresAtUnixMs,
      t.id
    )
  ]
);

export type PolicyInsightSynthesisRequestRow = typeof policyInsightSynthesisRequests.$inferSelect;
export type PolicyInsightSynthesisRequestInsert =
  typeof policyInsightSynthesisRequests.$inferInsert;
