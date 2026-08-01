import { bigint, check, integer, varchar } from "drizzle-orm/pg-core";
import { regimeEngine } from "./candleRevisions.js";
import { sql } from "drizzle-orm";

export const policyInsightSynthesisCursor = regimeEngine.table(
  "policy_insight_synthesis_cursor",
  {
    cursorKey: varchar("cursor_key", { length: 128 }).primaryKey(),
    lastProcessedReceiptId: bigint("last_processed_receipt_id", { mode: "number" }).notNull(),
    lastProcessedSrThesesMaxId: bigint("last_processed_sr_theses_max_id", {
      mode: "number"
    })
      .notNull()
      .default(0),
    targetReceiptId: bigint("target_receipt_id", { mode: "number" }),
    targetSrThesesMaxId: bigint("target_sr_theses_max_id", { mode: "number" }),
    leaseOwner: varchar("lease_owner", { length: 128 }),
    leaseExpiresAtUnixMs: bigint("lease_expires_at_unix_ms", { mode: "number" }),
    attemptCount: integer("attempt_count").notNull(),
    nextAttemptAtUnixMs: bigint("next_attempt_at_unix_ms", { mode: "number" }),
    lastOutcome: varchar("last_outcome", { length: 32 }),
    lastErrorCode: varchar("last_error_code", { length: 64 }),
    lastErrorMessage: varchar("last_error_message", { length: 2048 }),
    updatedAtUnixMs: bigint("updated_at_unix_ms", { mode: "number" }).notNull()
  },
  (t) => [
    check(
      "chk_synthesis_cursor_non_negative",
      sql`${t.lastProcessedReceiptId} >= 0 AND ${t.lastProcessedSrThesesMaxId} >= 0 AND (${t.targetReceiptId} IS NULL OR ${t.targetReceiptId} >= 0) AND (${t.targetSrThesesMaxId} IS NULL OR ${t.targetSrThesesMaxId} >= 0) AND ${t.attemptCount} >= 0 AND (${t.leaseExpiresAtUnixMs} IS NULL OR ${t.leaseExpiresAtUnixMs} >= 0) AND (${t.nextAttemptAtUnixMs} IS NULL OR ${t.nextAttemptAtUnixMs} >= 0) AND ${t.updatedAtUnixMs} >= 0`
    ),
    check(
      "chk_synthesis_cursor_lease_coherence",
      sql`(${t.leaseOwner} IS NULL AND ${t.targetReceiptId} IS NULL AND ${t.targetSrThesesMaxId} IS NULL AND ${t.leaseExpiresAtUnixMs} IS NULL AND ${t.nextAttemptAtUnixMs} IS NULL) OR (${t.leaseOwner} IS NOT NULL AND ${t.leaseExpiresAtUnixMs} IS NOT NULL AND ${t.targetReceiptId} IS NOT NULL AND ${t.targetSrThesesMaxId} IS NOT NULL) OR (${t.leaseOwner} IS NULL AND ${t.leaseExpiresAtUnixMs} IS NULL AND ${t.targetReceiptId} IS NOT NULL AND ${t.targetSrThesesMaxId} IS NOT NULL AND ${t.nextAttemptAtUnixMs} IS NOT NULL)`
    ),
    check(
      "chk_synthesis_cursor_last_outcome",
      sql`${t.lastOutcome} IS NULL OR ${t.lastOutcome} IN ('success', 'permanent_failure', 'transient_failure')`
    )
  ]
);

export type PolicyInsightSynthesisCursorRow = typeof policyInsightSynthesisCursor.$inferSelect;
export type PolicyInsightSynthesisCursorInsert = typeof policyInsightSynthesisCursor.$inferInsert;
