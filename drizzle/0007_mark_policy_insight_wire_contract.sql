ALTER TABLE "regime_engine"."policy_insights" ADD COLUMN "wire_contract_sha256" varchar(64);
ALTER TABLE "regime_engine"."policy_insights" ADD CONSTRAINT "chk_policy_insight_wire_contract_sha256" CHECK (wire_contract_sha256 IS NULL OR wire_contract_sha256 ~ '^[0-9a-f]{64}$');

DROP INDEX IF EXISTS "regime_engine"."uniq_policy_insights_synthesis_input";
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_policy_insights_synthesis_input" ON "regime_engine"."policy_insights" USING btree ("schema_version","wire_contract_sha256","ruleset_version","synthesis_input_hash");

DROP INDEX IF EXISTS "regime_engine"."idx_policy_insights_current";
CREATE INDEX IF NOT EXISTS "idx_policy_insights_current" ON "regime_engine"."policy_insights" USING btree ("pair","scope_key","generated_at_unix_ms","id");

DROP INDEX IF EXISTS "regime_engine"."idx_policy_insights_history";
CREATE INDEX IF NOT EXISTS "idx_policy_insights_history" ON "regime_engine"."policy_insights" USING btree ("pair","scope_key","generated_at_unix_ms","id");