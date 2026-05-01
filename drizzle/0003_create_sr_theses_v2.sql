CREATE TABLE "regime_engine"."sr_theses_v2" (
	"id" serial PRIMARY KEY NOT NULL,
	"schema_version" varchar(16) NOT NULL,
	"source" varchar(64) NOT NULL,
	"symbol" varchar(64) NOT NULL,
	"brief_id" varchar(256) NOT NULL,
	"source_recorded_at_iso" text,
	"summary" text,
	"captured_at_iso" varchar(64) NOT NULL,
	"captured_at_unix_ms" bigint NOT NULL,
	"asset" varchar(64) NOT NULL,
	"timeframe" varchar(64) NOT NULL,
	"bias" text,
	"setup_type" text,
	"support_levels" text[] NOT NULL,
	"resistance_levels" text[] NOT NULL,
	"entry_zone" text,
	"targets" text[] NOT NULL,
	"invalidation" text,
	"trigger_text" text,
	"chart_reference" text,
	"source_handle" varchar(256) NOT NULL,
	"source_channel" text,
	"source_kind" varchar(64) NOT NULL,
	"source_reliability" text,
	"raw_thesis_text" text,
	"collected_at_iso" text,
	"published_at_iso" text,
	"source_url" text,
	"notes" text,
	"payload_hash" varchar(64) NOT NULL,
	"received_at_unix_ms" bigint NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_sr_theses_v2_idempotency" ON "regime_engine"."sr_theses_v2" USING btree ("source","symbol","brief_id","asset","source_handle");--> statement-breakpoint
CREATE INDEX "idx_sr_theses_v2_symbol_received" ON "regime_engine"."sr_theses_v2" USING btree ("symbol","source","captured_at_unix_ms","id");--> statement-breakpoint
CREATE INDEX "idx_sr_theses_v2_source_brief" ON "regime_engine"."sr_theses_v2" USING btree ("source","brief_id","captured_at_unix_ms","id");