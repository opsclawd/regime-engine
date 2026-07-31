CREATE TABLE IF NOT EXISTS "regime_engine"."policy_insight_synthesis_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"scope_key" varchar(256) NOT NULL,
	"selection_hash" varchar(64),
	"plan_hash" varchar(64),
	"ruleset_version" varchar(32) NOT NULL,
	"status" varchar(32) NOT NULL,
	"attempt_count" integer NOT NULL,
	"next_attempt_at_unix_ms" bigint,
	"lease_owner" varchar(128),
	"lease_expires_at_unix_ms" bigint,
	"last_error_code" varchar(64),
	"last_error_message" varchar(2048),
	"created_at_unix_ms" bigint NOT NULL,
	"updated_at_unix_ms" bigint NOT NULL,
	CONSTRAINT "chk_synthesis_requests_non_negative" CHECK (attempt_count >= 0 AND created_at_unix_ms >= 0 AND updated_at_unix_ms >= 0 AND (next_attempt_at_unix_ms IS NULL OR next_attempt_at_unix_ms >= 0) AND (lease_expires_at_unix_ms IS NULL OR lease_expires_at_unix_ms >= 0)),
	CONSTRAINT "chk_synthesis_requests_status" CHECK (status IN ('waiting_for_plan', 'waiting_for_evidence', 'pending', 'processing', 'completed', 'failed', 'superseded')),
	CONSTRAINT "chk_synthesis_requests_hashes" CHECK ((status = 'waiting_for_plan' AND selection_hash IS NOT NULL AND plan_hash IS NULL) OR (status = 'waiting_for_evidence' AND selection_hash IS NULL AND plan_hash IS NOT NULL) OR (status NOT IN ('waiting_for_plan', 'waiting_for_evidence') AND selection_hash IS NOT NULL AND plan_hash IS NOT NULL)),
	CONSTRAINT "chk_synthesis_requests_lease_coherence" CHECK ((status = 'processing' AND lease_owner IS NOT NULL AND lease_expires_at_unix_ms IS NOT NULL) OR (status <> 'processing' AND lease_owner IS NULL AND lease_expires_at_unix_ms IS NULL)),
	CONSTRAINT "chk_synthesis_requests_hash_format" CHECK ((selection_hash IS NULL OR selection_hash ~ '^[0-9a-f]{64}$') AND (plan_hash IS NULL OR plan_hash ~ '^[0-9a-f]{64}$'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_synthesis_requests_ready" ON "regime_engine"."policy_insight_synthesis_requests" ("scope_key","selection_hash","plan_hash","ruleset_version") WHERE selection_hash IS NOT NULL AND plan_hash IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_synthesis_requests_waiting_plan" ON "regime_engine"."policy_insight_synthesis_requests" ("scope_key","selection_hash","ruleset_version") WHERE status = 'waiting_for_plan';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_synthesis_requests_waiting_evidence" ON "regime_engine"."policy_insight_synthesis_requests" ("scope_key","plan_hash","ruleset_version") WHERE status = 'waiting_for_evidence';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_synthesis_requests_claim" ON "regime_engine"."policy_insight_synthesis_requests" ("status","next_attempt_at_unix_ms","lease_expires_at_unix_ms","id");
