CREATE TABLE "regime_engine"."evidence_bundles" (
	"id" serial PRIMARY KEY NOT NULL,
	"schema_version" varchar(32) NOT NULL,
	"source_publisher" varchar(64) NOT NULL,
	"source_id" varchar(256) NOT NULL,
	"run_id" varchar(256) NOT NULL,
	"pair" varchar(32) NOT NULL,
	"scope_key" varchar(64) NOT NULL,
	"correlation_id" varchar(64) NOT NULL,
	"as_of_unix_ms" bigint NOT NULL,
	"created_at_unix_ms" bigint NOT NULL,
	"received_at_unix_ms" bigint NOT NULL,
	"fresh_until_unix_ms" bigint NOT NULL,
	"expires_at_unix_ms" bigint NOT NULL,
	"evidence_json" jsonb NOT NULL,
	"evidence_canonical" text NOT NULL,
	"evidence_hash" varchar(64) NOT NULL,
	"ingested_at_unix_ms" bigint NOT NULL,
	"processed_at_unix_ms" bigint NOT NULL,
	CONSTRAINT "chk_evidence_bundle_v1" CHECK (schema_version = 'evidence-bundle.v1'),
	CONSTRAINT "chk_sol_usdc_pair" CHECK (pair = 'SOL/USDC'),
	CONSTRAINT "chk_timestamp_ordering" CHECK (as_of_unix_ms <= created_at_unix_ms AND created_at_unix_ms < fresh_until_unix_ms AND fresh_until_unix_ms <= expires_at_unix_ms),
	CONSTRAINT "chk_evidence_hash_format" CHECK (evidence_hash ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_evidence_bundles_source_run" ON "regime_engine"."evidence_bundles" USING btree ("schema_version","source_publisher","source_id","run_id");--> statement-breakpoint
CREATE INDEX "idx_evidence_bundles_current" ON "regime_engine"."evidence_bundles" USING btree ("pair","scope_key","source_publisher","source_id","as_of_unix_ms","id");--> statement-breakpoint
CREATE INDEX "idx_evidence_bundles_history" ON "regime_engine"."evidence_bundles" USING btree ("pair","scope_key","received_at_unix_ms","id");--> statement-breakpoint
CREATE INDEX "idx_evidence_bundles_correlation" ON "regime_engine"."evidence_bundles" USING btree ("correlation_id","id");