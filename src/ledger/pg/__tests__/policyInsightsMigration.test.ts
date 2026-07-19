import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm/sql";
import { createDb } from "../db.js";

describe.skipIf(!process.env.DATABASE_URL)("policy_insights migration (PG)", () => {
  it("rejects duplicate canonical synthesis input", async () => {
    const { db, client } = createDb(process.env.DATABASE_URL!);

    // Clear previous insertions to ensure isolated run if needed
    await db.execute(sql`DELETE FROM regime_engine.policy_insights`);

    // Insert valid row 1
    await db.execute(
      sql`INSERT INTO regime_engine.policy_insights
            (insight_id, schema_version, ruleset_version, pair, scope_key, position_id,
             generated_at_unix_ms, as_of_unix_ms, expires_at_unix_ms, persisted_at_unix_ms,
             market_hash, position_hash, selection_hash, synthesis_input_hash,
             selection_policy_version, synthesis_input_json, synthesis_output_json,
             payload_canonical, payload_hash, selected_lineage_json, excluded_lineage_json)
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
             '[]', '[]')`
    );

    // Try inserting another row with different insight_id but identical (schema_version, ruleset_version, synthesis_input_hash)
    await expect(
      db.execute(
        sql`INSERT INTO regime_engine.policy_insights
              (insight_id, schema_version, ruleset_version, pair, scope_key, position_id,
               generated_at_unix_ms, as_of_unix_ms, expires_at_unix_ms, persisted_at_unix_ms,
               market_hash, position_hash, selection_hash, synthesis_input_hash,
               selection_policy_version, synthesis_input_json, synthesis_output_json,
               payload_canonical, payload_hash, selected_lineage_json, excluded_lineage_json)
              VALUES
              ('0000000000000000000000000000000000000000000000000000000000000099',
               'policy-insight.v1', 'ruleset.v1', 'SOL/USDC', 'scope-key', 'position-id',
               1700000000000, 1690000000000, 1800000000000, 1710000000000,
               '0000000000000000000000000000000000000000000000000000000000000002',
               '0000000000000000000000000000000000000000000000000000000000000003',
               '0000000000000000000000000000000000000000000000000000000000000004',
               '0000000000000000000000000000000000000000000000000000000000000005',
               'policy-v1', '{}', '{}', 'canonical payload',
               '0000000000000000000000000000000000000000000000000000000000000006',
               '[]', '[]')`
      )
    ).rejects.toThrow();

    await client.end();
  });

  it("enforces policy insight audit checks without legacy foreign keys", async () => {
    const { db, client } = createDb(process.env.DATABASE_URL!);

    // Prove no foreign key to legacy clmm_insights exists
    const fks = await db.execute(
      sql`SELECT
            tc.table_name,
            kcu.column_name,
            ccu.table_name AS foreign_table_name,
            ccu.column_name AS foreign_column_name
          FROM
            information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
              ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage AS ccu
              ON ccu.constraint_name = tc.constraint_name
              AND ccu.table_schema = tc.table_schema
          WHERE tc.constraint_type = 'FOREIGN KEY'
            AND tc.table_schema = 'regime_engine'
            AND tc.table_name = 'policy_insights'`
    );

    const legacyClmmRef = fks.filter(
      (fk: Record<string, unknown>) => fk.foreign_table_name === "clmm_insights"
    );
    expect(legacyClmmRef).toHaveLength(0);

    // Reject non-matching schema version
    await expect(
      db.execute(
        sql`INSERT INTO regime_engine.policy_insights
              (insight_id, schema_version, ruleset_version, pair, scope_key, position_id,
               generated_at_unix_ms, as_of_unix_ms, expires_at_unix_ms, persisted_at_unix_ms,
               market_hash, position_hash, selection_hash, synthesis_input_hash,
               selection_policy_version, synthesis_input_json, synthesis_output_json,
               payload_canonical, payload_hash, selected_lineage_json, excluded_lineage_json)
              VALUES
              ('0000000000000000000000000000000000000000000000000000000000000010',
               'policy-insight.v2', 'ruleset.v1', 'SOL/USDC', 'scope-key', 'position-id',
               1700000000000, 1690000000000, 1800000000000, 1710000000000,
               '0000000000000000000000000000000000000000000000000000000000000002',
               '0000000000000000000000000000000000000000000000000000000000000003',
               '0000000000000000000000000000000000000000000000000000000000000004',
               '0000000000000000000000000000000000000000000000000000000000000005',
               'policy-v1', '{}', '{}', 'canonical payload',
               '0000000000000000000000000000000000000000000000000000000000000006',
               '[]', '[]')`
      )
    ).rejects.toThrow();

    // Reject non-matching pair (SOL/USDC is the only valid pair)
    await expect(
      db.execute(
        sql`INSERT INTO regime_engine.policy_insights
              (insight_id, schema_version, ruleset_version, pair, scope_key, position_id,
               generated_at_unix_ms, as_of_unix_ms, expires_at_unix_ms, persisted_at_unix_ms,
               market_hash, position_hash, selection_hash, synthesis_input_hash,
               selection_policy_version, synthesis_input_json, synthesis_output_json,
               payload_canonical, payload_hash, selected_lineage_json, excluded_lineage_json)
              VALUES
              ('0000000000000000000000000000000000000000000000000000000000000011',
               'policy-insight.v1', 'ruleset.v1', 'SOL/ETH', 'scope-key', 'position-id',
               1700000000000, 1690000000000, 1800000000000, 1710000000000,
               '0000000000000000000000000000000000000000000000000000000000000002',
               '0000000000000000000000000000000000000000000000000000000000000003',
               '0000000000000000000000000000000000000000000000000000000000000004',
               '0000000000000000000000000000000000000000000000000000000000000005',
               'policy-v1', '{}', '{}', 'canonical payload',
               '0000000000000000000000000000000000000000000000000000000000000006',
               '[]', '[]')`
      )
    ).rejects.toThrow();

    // Reject invalid insight_id format (uppercase)
    await expect(
      db.execute(
        sql`INSERT INTO regime_engine.policy_insights
              (insight_id, schema_version, ruleset_version, pair, scope_key, position_id,
               generated_at_unix_ms, as_of_unix_ms, expires_at_unix_ms, persisted_at_unix_ms,
               market_hash, position_hash, selection_hash, synthesis_input_hash,
               selection_policy_version, synthesis_input_json, synthesis_output_json,
               payload_canonical, payload_hash, selected_lineage_json, excluded_lineage_json)
              VALUES
              ('ABCDEF0000000000000000000000000000000000000000000000000000000011',
               'policy-insight.v1', 'ruleset.v1', 'SOL/USDC', 'scope-key', 'position-id',
               1700000000000, 1690000000000, 1800000000000, 1710000000000,
               '0000000000000000000000000000000000000000000000000000000000000002',
               '0000000000000000000000000000000000000000000000000000000000000003',
               '0000000000000000000000000000000000000000000000000000000000000004',
               '0000000000000000000000000000000000000000000000000000000000000005',
               'policy-v1', '{}', '{}', 'canonical payload',
               '0000000000000000000000000000000000000000000000000000000000000006',
               '[]', '[]')`
      )
    ).rejects.toThrow();

    // Reject timestamp ordering violation (expiresAtUnixMs <= generatedAtUnixMs)
    await expect(
      db.execute(
        sql`INSERT INTO regime_engine.policy_insights
              (insight_id, schema_version, ruleset_version, pair, scope_key, position_id,
               generated_at_unix_ms, as_of_unix_ms, expires_at_unix_ms, persisted_at_unix_ms,
               market_hash, position_hash, selection_hash, synthesis_input_hash,
               selection_policy_version, synthesis_input_json, synthesis_output_json,
               payload_canonical, payload_hash, selected_lineage_json, excluded_lineage_json)
              VALUES
              ('0000000000000000000000000000000000000000000000000000000000000012',
               'policy-insight.v1', 'ruleset.v1', 'SOL/USDC', 'scope-key', 'position-id',
               1700000000000, 1690000000000, 1695000000000, 1710000000000,
               '0000000000000000000000000000000000000000000000000000000000000002',
               '0000000000000000000000000000000000000000000000000000000000000003',
               '0000000000000000000000000000000000000000000000000000000000000004',
               '0000000000000000000000000000000000000000000000000000000000000005',
               'policy-v1', '{}', '{}', 'canonical payload',
               '0000000000000000000000000000000000000000000000000000000000000006',
               '[]', '[]')`
      )
    ).rejects.toThrow();

    await client.end();
  });
});
