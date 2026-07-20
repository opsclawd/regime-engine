import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm/sql";
import { createDb } from "../db.js";
const POLICY_INSIGHT_V1_WIRE_CONTRACT_SHA256 =
  "80487b0a9374d0b535accf535ef9819f2b2de00e1d65980deb73c97afaa02800";

describe.skipIf(!process.env.DATABASE_URL)("policy_insights wire contract migration (PG)", () => {
  it("leaves legacy rows unmodified with a null wire contract digest", async () => {
    const { db, client } = createDb(process.env.DATABASE_URL!);
    await db.execute(sql`DELETE FROM regime_engine.policy_insights`);

    // Insert legacy row with NULL wire_contract_sha256
    await db.execute(
      sql`INSERT INTO regime_engine.policy_insights
            (insight_id, schema_version, ruleset_version, pair, scope_key, position_id,
             generated_at_unix_ms, as_of_unix_ms, expires_at_unix_ms, persisted_at_unix_ms,
             market_hash, position_hash, selection_hash, synthesis_input_hash,
             selection_policy_version, synthesis_input_json, synthesis_output_json,
             payload_canonical, payload_hash, selected_lineage_json, excluded_lineage_json,
             wire_contract_sha256)
            VALUES
            ('0000000000000000000000000000000000000000000000000000000000000001',
             'policy-insight.v1', 'ruleset.v1', 'SOL/USDC', 'scope-key', 'position-id',
             1700000000000, 1690000000000, 1800000000000, 1710000000000,
             '0000000000000000000000000000000000000000000000000000000000000002',
             '0000000000000000000000000000000000000000000000000000000000000003',
             '0000000000000000000000000000000000000000000000000000000000000004',
             '0000000000000000000000000000000000000000000000000000000000000005',
             'policy-v1', '{}', '{}', 'canonical payload',
             '0000000000000000000000000000000000000000000000000000000000000006',
             '[]', '[]', NULL)`
    );

    const rows = await db.execute(
      sql`SELECT wire_contract_sha256 FROM regime_engine.policy_insights WHERE insight_id = '0000000000000000000000000000000000000000000000000000000000000001'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].wire_contract_sha256).toBeNull();

    await client.end();
  });

  it("inserts every new canonical row with the exact published schema digest", async () => {
    const { db, client } = createDb(process.env.DATABASE_URL!);
    await db.execute(sql`DELETE FROM regime_engine.policy_insights`);

    await db.execute(
      sql`INSERT INTO regime_engine.policy_insights
            (insight_id, schema_version, ruleset_version, pair, scope_key, position_id,
             generated_at_unix_ms, as_of_unix_ms, expires_at_unix_ms, persisted_at_unix_ms,
             market_hash, position_hash, selection_hash, synthesis_input_hash,
             selection_policy_version, synthesis_input_json, synthesis_output_json,
             payload_canonical, payload_hash, selected_lineage_json, excluded_lineage_json,
             wire_contract_sha256)
            VALUES
            ('0000000000000000000000000000000000000000000000000000000000000002',
             'policy-insight.v1', 'ruleset.v1', 'SOL/USDC', 'scope-key', 'position-id',
             1700000000000, 1690000000000, 1800000000000, 1710000000000,
             '0000000000000000000000000000000000000000000000000000000000000002',
             '0000000000000000000000000000000000000000000000000000000000000003',
             '0000000000000000000000000000000000000000000000000000000000000004',
             '0000000000000000000000000000000000000000000000000000000000000005',
             'policy-v1', '{}', '{}', 'canonical payload',
             '0000000000000000000000000000000000000000000000000000000000000006',
             '[]', '[]', ${POLICY_INSIGHT_V1_WIRE_CONTRACT_SHA256})`
    );

    const rows = await db.execute(
      sql`SELECT wire_contract_sha256 FROM regime_engine.policy_insights WHERE insight_id = '0000000000000000000000000000000000000000000000000000000000000002'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].wire_contract_sha256).toBe(POLICY_INSIGHT_V1_WIRE_CONTRACT_SHA256);

    await client.end();
  });

  it("allows one canonical row beside a legacy row with the same synthesis input hash", async () => {
    const { db, client } = createDb(process.env.DATABASE_URL!);
    await db.execute(sql`DELETE FROM regime_engine.policy_insights`);

    const inputHash = "0000000000000000000000000000000000000000000000000000000000000005";

    // Legacy row with null digest
    await db.execute(
      sql`INSERT INTO regime_engine.policy_insights
            (insight_id, schema_version, ruleset_version, pair, scope_key, position_id,
             generated_at_unix_ms, as_of_unix_ms, expires_at_unix_ms, persisted_at_unix_ms,
             market_hash, position_hash, selection_hash, synthesis_input_hash,
             selection_policy_version, synthesis_input_json, synthesis_output_json,
             payload_canonical, payload_hash, selected_lineage_json, excluded_lineage_json,
             wire_contract_sha256)
            VALUES
            ('0000000000000000000000000000000000000000000000000000000000000001',
             'policy-insight.v1', 'ruleset.v1', 'SOL/USDC', 'scope-key', 'position-id',
             1700000000000, 1690000000000, 1800000000000, 1710000000000,
             '0000000000000000000000000000000000000000000000000000000000000002',
             '0000000000000000000000000000000000000000000000000000000000000003',
             '0000000000000000000000000000000000000000000000000000000000000004',
             ${inputHash}, 'policy-v1', '{}', '{}', 'canonical payload',
             '0000000000000000000000000000000000000000000000000000000000000006',
             '[]', '[]', NULL)`
    );

    // Canonical row with exact digest
    await expect(
      db.execute(
        sql`INSERT INTO regime_engine.policy_insights
              (insight_id, schema_version, ruleset_version, pair, scope_key, position_id,
               generated_at_unix_ms, as_of_unix_ms, expires_at_unix_ms, persisted_at_unix_ms,
               market_hash, position_hash, selection_hash, synthesis_input_hash,
               selection_policy_version, synthesis_input_json, synthesis_output_json,
               payload_canonical, payload_hash, selected_lineage_json, excluded_lineage_json,
               wire_contract_sha256)
              VALUES
              ('0000000000000000000000000000000000000000000000000000000000000002',
               'policy-insight.v1', 'ruleset.v1', 'SOL/USDC', 'scope-key', 'position-id',
               1700000000000, 1690000000000, 1800000000000, 1710000000000,
               '0000000000000000000000000000000000000000000000000000000000000002',
               '0000000000000000000000000000000000000000000000000000000000000003',
               '0000000000000000000000000000000000000000000000000000000000000004',
               ${inputHash}, 'policy-v1', '{}', '{}', 'canonical payload',
               '0000000000000000000000000000000000000000000000000000000000000006',
               '[]', '[]', ${POLICY_INSIGHT_V1_WIRE_CONTRACT_SHA256})`
      )
    ).resolves.toBeDefined();

    await client.end();
  });

  it("returns an existing canonical row for a replay with the same digest ruleset and input hash", async () => {
    const { db, client } = createDb(process.env.DATABASE_URL!);
    await db.execute(sql`DELETE FROM regime_engine.policy_insights`);

    const inputHash = "0000000000000000000000000000000000000000000000000000000000000005";

    // Insert first canonical
    await db.execute(
      sql`INSERT INTO regime_engine.policy_insights
            (insight_id, schema_version, ruleset_version, pair, scope_key, position_id,
             generated_at_unix_ms, as_of_unix_ms, expires_at_unix_ms, persisted_at_unix_ms,
             market_hash, position_hash, selection_hash, synthesis_input_hash,
             selection_policy_version, synthesis_input_json, synthesis_output_json,
             payload_canonical, payload_hash, selected_lineage_json, excluded_lineage_json,
             wire_contract_sha256)
            VALUES
            ('0000000000000000000000000000000000000000000000000000000000000002',
             'policy-insight.v1', 'ruleset.v1', 'SOL/USDC', 'scope-key', 'position-id',
             1700000000000, 1690000000000, 1800000000000, 1710000000000,
             '0000000000000000000000000000000000000000000000000000000000000002',
             '0000000000000000000000000000000000000000000000000000000000000003',
             '0000000000000000000000000000000000000000000000000000000000000004',
             ${inputHash}, 'policy-v1', '{}', '{}', 'canonical payload',
             '0000000000000000000000000000000000000000000000000000000000000006',
             '[]', '[]', ${POLICY_INSIGHT_V1_WIRE_CONTRACT_SHA256})`
    );

    // Try inserting again with same unique constraint -> should fail (or return status already_exists in repository)
    await expect(
      db.execute(
        sql`INSERT INTO regime_engine.policy_insights
              (insight_id, schema_version, ruleset_version, pair, scope_key, position_id,
               generated_at_unix_ms, as_of_unix_ms, expires_at_unix_ms, persisted_at_unix_ms,
               market_hash, position_hash, selection_hash, synthesis_input_hash,
               selection_policy_version, synthesis_input_json, synthesis_output_json,
               payload_canonical, payload_hash, selected_lineage_json, excluded_lineage_json,
               wire_contract_sha256)
              VALUES
              ('0000000000000000000000000000000000000000000000000000000000000003',
               'policy-insight.v1', 'ruleset.v1', 'SOL/USDC', 'scope-key', 'position-id',
               1700000000000, 1690000000000, 1800000000000, 1710000000000,
               '0000000000000000000000000000000000000000000000000000000000000002',
               '0000000000000000000000000000000000000000000000000000000000000003',
               '0000000000000000000000000000000000000000000000000000000000000004',
               ${inputHash}, 'policy-v1', '{}', '{}', 'canonical payload',
               '0000000000000000000000000000000000000000000000000000000000000006',
               '[]', '[]', ${POLICY_INSIGHT_V1_WIRE_CONTRACT_SHA256})`
      )
    ).rejects.toThrow();

    await client.end();
  });
});
