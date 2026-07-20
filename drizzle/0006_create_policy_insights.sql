CREATE TABLE IF NOT EXISTS "regime_engine"."policy_insights" (
	"id" serial PRIMARY KEY NOT NULL,
	"insight_id" varchar(64) NOT NULL,
	"schema_version" varchar(32) NOT NULL,
	"ruleset_version" varchar(32) NOT NULL,
	"pair" varchar(32) NOT NULL,
	"scope_key" varchar(256) NOT NULL,
	"position_id" varchar(64),
	"generated_at_unix_ms" bigint NOT NULL,
	"as_of_unix_ms" bigint NOT NULL,
	"expires_at_unix_ms" bigint NOT NULL,
	"persisted_at_unix_ms" bigint NOT NULL,
	"market_hash" varchar(64) NOT NULL,
	"position_hash" varchar(64) NOT NULL,
	"selection_hash" varchar(64) NOT NULL,
	"synthesis_input_hash" varchar(64) NOT NULL,
	"selection_policy_version" varchar(64) NOT NULL,
	"synthesis_input_json" jsonb NOT NULL,
	"synthesis_output_json" jsonb NOT NULL,
	"payload_canonical" text NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"selected_lineage_json" jsonb NOT NULL,
	"excluded_lineage_json" jsonb NOT NULL,
	CONSTRAINT "chk_policy_insight_v1" CHECK (schema_version = 'policy-insight.v1'),
	CONSTRAINT "chk_policy_insight_pair" CHECK (pair = 'SOL/USDC'),
	CONSTRAINT "chk_policy_insight_timestamps" CHECK (as_of_unix_ms <= generated_at_unix_ms AND generated_at_unix_ms <= persisted_at_unix_ms AND generated_at_unix_ms < expires_at_unix_ms),
	CONSTRAINT "chk_policy_insight_id_format" CHECK (insight_id ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "chk_policy_insight_market_hash" CHECK (market_hash ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "chk_policy_insight_position_hash" CHECK (position_hash ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "chk_policy_insight_selection_hash" CHECK (selection_hash ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "chk_policy_insight_synthesis_input_hash" CHECK (synthesis_input_hash ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "chk_policy_insight_payload_hash" CHECK (payload_hash ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_policy_insights_insight_id" ON "regime_engine"."policy_insights" USING btree ("insight_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_policy_insights_synthesis_input" ON "regime_engine"."policy_insights" USING btree ("schema_version","ruleset_version","synthesis_input_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_policy_insights_current" ON "regime_engine"."policy_insights" USING btree ("pair","scope_key","as_of_unix_ms","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_policy_insights_history" ON "regime_engine"."policy_insights" USING btree ("pair","scope_key","persisted_at_unix_ms","id");
