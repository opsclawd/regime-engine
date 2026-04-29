CREATE TABLE "regime_engine"."candle_revisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" varchar(64) NOT NULL,
	"source" varchar(64) NOT NULL,
	"network" varchar(64) NOT NULL,
	"pool_address" varchar(128) NOT NULL,
	"timeframe" varchar(16) NOT NULL,
	"unix_ms" bigint NOT NULL,
	"source_recorded_at_iso" varchar(64) NOT NULL,
	"source_recorded_at_unix_ms" bigint NOT NULL,
	"open" double precision NOT NULL,
	"high" double precision NOT NULL,
	"low" double precision NOT NULL,
	"close" double precision NOT NULL,
	"volume" double precision NOT NULL,
	"ohlcv_canonical" text NOT NULL,
	"ohlcv_hash" varchar(64) NOT NULL,
	"received_at_unix_ms" bigint NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ux_candle_revisions_slot_hash" ON "regime_engine"."candle_revisions" USING btree ("symbol","source","network","pool_address","timeframe","unix_ms","ohlcv_hash");--> statement-breakpoint
CREATE INDEX "idx_candle_revisions_slot_latest" ON "regime_engine"."candle_revisions" USING btree ("symbol","source","network","pool_address","timeframe","unix_ms","source_recorded_at_unix_ms","id");--> statement-breakpoint
CREATE INDEX "idx_candle_revisions_feed_window" ON "regime_engine"."candle_revisions" USING btree ("symbol","source","network","pool_address","timeframe","unix_ms");