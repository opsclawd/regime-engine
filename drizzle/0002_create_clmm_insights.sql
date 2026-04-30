CREATE TABLE "regime_engine"."clmm_insights" (
	"id" serial PRIMARY KEY NOT NULL,
	"schema_version" varchar(16) NOT NULL,
	"pair" varchar(32) NOT NULL,
	"as_of_unix_ms" bigint NOT NULL,
	"source" varchar(64) NOT NULL,
	"run_id" varchar(256) NOT NULL,
	"market_regime" varchar(64) NOT NULL,
	"fundamental_regime" varchar(64) NOT NULL,
	"recommended_action" varchar(64) NOT NULL,
	"confidence" varchar(16) NOT NULL,
	"risk_level" varchar(16) NOT NULL,
	"data_quality" varchar(16) NOT NULL,
	"clmm_policy_json" jsonb NOT NULL,
	"levels_json" jsonb NOT NULL,
	"reasoning_json" jsonb NOT NULL,
	"source_refs_json" jsonb NOT NULL,
	"payload_canonical" text NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"expires_at_unix_ms" bigint NOT NULL,
	"received_at_unix_ms" bigint NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_clmm_insights_source_run" ON "regime_engine"."clmm_insights" USING btree ("source","run_id");--> statement-breakpoint
CREATE INDEX "idx_clmm_insights_pair_as_of" ON "regime_engine"."clmm_insights" USING btree ("pair","as_of_unix_ms","id");--> statement-breakpoint
CREATE INDEX "idx_clmm_insights_pair_received" ON "regime_engine"."clmm_insights" USING btree ("pair","received_at_unix_ms","id");