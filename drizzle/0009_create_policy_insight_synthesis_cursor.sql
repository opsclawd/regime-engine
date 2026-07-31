CREATE TABLE IF NOT EXISTS "regime_engine"."policy_insight_synthesis_cursor" (
	"cursor_key" varchar(128) PRIMARY KEY NOT NULL,
	"last_processed_receipt_id" bigint NOT NULL,
	"target_receipt_id" bigint,
	"lease_owner" varchar(128),
	"lease_expires_at_unix_ms" bigint,
	"attempt_count" integer NOT NULL,
	"next_attempt_at_unix_ms" bigint,
	"last_outcome" varchar(32),
	"last_error_code" varchar(64),
	"last_error_message" varchar(2048),
	"updated_at_unix_ms" bigint NOT NULL,
	CONSTRAINT "chk_synthesis_cursor_non_negative" CHECK (last_processed_receipt_id >= 0 AND (target_receipt_id IS NULL OR target_receipt_id >= 0) AND attempt_count >= 0 AND (lease_expires_at_unix_ms IS NULL OR lease_expires_at_unix_ms >= 0) AND (next_attempt_at_unix_ms IS NULL OR next_attempt_at_unix_ms >= 0) AND updated_at_unix_ms >= 0),
	CONSTRAINT "chk_synthesis_cursor_lease_coherence" CHECK ((lease_owner IS NULL AND target_receipt_id IS NULL AND lease_expires_at_unix_ms IS NULL) OR (lease_owner IS NOT NULL AND target_receipt_id IS NOT NULL AND lease_expires_at_unix_ms IS NOT NULL)),
	CONSTRAINT "chk_synthesis_cursor_last_outcome" CHECK (last_outcome IS NULL OR last_outcome IN ('success', 'permanent_failure', 'transient_failure'))
);
