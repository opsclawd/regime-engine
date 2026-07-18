import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm/sql";
import { createDb } from "../db.js";

describe.skipIf(!process.env.DATABASE_URL)("evidence_bundles migration (PG)", () => {
  it("keeps evidence bundles separate from final insight rows", async () => {
    const { db, client } = createDb(process.env.DATABASE_URL!);

    const tablesResult = await db.execute(
      sql`SELECT tablename FROM pg_tables WHERE schemaname = 'regime_engine' ORDER BY tablename`
    );

    const tableNames = tablesResult.map((row: Record<string, unknown>) => row.tablename as string);

    expect(tableNames).toContain("evidence_bundles");
    expect(tableNames).toContain("clmm_insights");
    expect(tableNames).not.toContain("evidence_bundles_id");

    const evidenceColumns = await db.execute(
      sql`SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'regime_engine' AND table_name = 'evidence_bundles'
            ORDER BY ordinal_position`
    );

    const clmmColumns = await db.execute(
      sql`SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'regime_engine' AND table_name = 'clmm_insights'
            ORDER BY ordinal_position`
    );

    const evidenceColNames = evidenceColumns.map(
      (row: Record<string, unknown>) => row.column_name as string
    );
    const clmmColNames = clmmColumns.map(
      (row: Record<string, unknown>) => row.column_name as string
    );

    const overlap = evidenceColNames.filter((c) => clmmColNames.includes(c));
    expect(overlap).toHaveLength(0);

    const existingInsightRows = await db.execute(
      sql`SELECT COUNT(*) as cnt FROM regime_engine.clmm_insights LIMIT 1`
    );
    expect(existingInsightRows[0]).toBeDefined();

    await client.end();
  });

  it("rejects invalid evidence scalar invariants at the database boundary", async () => {
    const { db, client } = createDb(process.env.DATABASE_URL!);

    await expect(
      db.execute(
        sql`INSERT INTO regime_engine.evidence_bundles
              (schema_version, source_publisher, source_id, run_id, pair, scope_key,
               correlation_id, as_of_unix_ms, created_at_unix_ms, received_at_unix_ms,
               fresh_until_unix_ms, expires_at_unix_ms, evidence_json, evidence_canonical,
               evidence_hash, ingested_at_unix_ms, processed_at_unix_ms)
              VALUES
              ('evidence-bundle.v2', 'publisher', 'source', 'run', 'SOL/USDC', 'scope',
               'corr', 1000, 2000, 3000, 4000, 5000, '{}', 'canonical', 'abcd1234567890abcd1234567890abcd1234567890abcd1234567890abcd1234', 6000, 7000)`
      )
    ).rejects.toThrow();

    await expect(
      db.execute(
        sql`INSERT INTO regime_engine.evidence_bundles
              (schema_version, source_publisher, source_id, run_id, pair, scope_key,
               correlation_id, as_of_unix_ms, created_at_unix_ms, received_at_unix_ms,
               fresh_until_unix_ms, expires_at_unix_ms, evidence_json, evidence_canonical,
               evidence_hash, ingested_at_unix_ms, processed_at_unix_ms)
              VALUES
              ('evidence-bundle.v1', 'publisher', 'source', 'run', 'SOL/ETH', 'scope',
               'corr', 1000, 2000, 3000, 4000, 5000, '{}', 'canonical', 'abcd1234567890abcd1234567890abcd1234567890abcd1234567890abcd1234', 6000, 7000)`
      )
    ).rejects.toThrow();

    await expect(
      db.execute(
        sql`INSERT INTO regime_engine.evidence_bundles
              (schema_version, source_publisher, source_id, run_id, pair, scope_key,
               correlation_id, as_of_unix_ms, created_at_unix_ms, received_at_unix_ms,
               fresh_until_unix_ms, expires_at_unix_ms, evidence_json, evidence_canonical,
               evidence_hash, ingested_at_unix_ms, processed_at_unix_ms)
              VALUES
              ('evidence-bundle.v1', 'publisher', 'source', 'run', 'SOL/USDC', 'scope',
               'corr', 3000, 2000, 1000, 4000, 5000, '{}', 'canonical', 'abcd1234567890abcd1234567890abcd1234567890abcd1234567890abcd1234', 6000, 7000)`
      )
    ).rejects.toThrow();

    await expect(
      db.execute(
        sql`INSERT INTO regime_engine.evidence_bundles
              (schema_version, source_publisher, source_id, run_id, pair, scope_key,
               correlation_id, as_of_unix_ms, created_at_unix_ms, received_at_unix_ms,
               fresh_until_unix_ms, expires_at_unix_ms, evidence_json, evidence_canonical,
               evidence_hash, ingested_at_unix_ms, processed_at_unix_ms)
              VALUES
              ('evidence-bundle.v1', 'publisher', 'source', 'run', 'SOL/USDC', 'scope',
               'corr', 1000, 2000, 3000, 5000, 4000, '{}', 'canonical', 'abcd1234567890abcd1234567890abcd1234567890abcd1234567890abcd1234', 6000, 7000)`
      )
    ).rejects.toThrow();

    await expect(
      db.execute(
        sql`INSERT INTO regime_engine.evidence_bundles
              (schema_version, source_publisher, source_id, run_id, pair, scope_key,
               correlation_id, as_of_unix_ms, created_at_unix_ms, received_at_unix_ms,
               fresh_until_unix_ms, expires_at_unix_ms, evidence_json, evidence_canonical,
               evidence_hash, ingested_at_unix_ms, processed_at_unix_ms)
              VALUES
              ('evidence-bundle.v1', 'publisher', 'source', 'run', 'SOL/USDC', 'scope',
               'corr', 1000, 2000, 3000, 4000, 5000, '{}', 'canonical', 'ABCD1234567890ABCD1234567890ABCD1234567890ABCD1234567890ABCD1234', 6000, 7000)`
      )
    ).rejects.toThrow();

    await client.end();
  });
});
