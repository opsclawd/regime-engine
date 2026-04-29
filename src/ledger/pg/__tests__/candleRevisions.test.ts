import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm/sql";
import { createDb } from "../db.js";

describe.skipIf(!process.env.DATABASE_URL)("candle_revisions schema (PG)", () => {
  it("has all required columns with correct types", async () => {
    const { db, client } = createDb(process.env.DATABASE_URL!);

    const result = await db.execute(
      sql`SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
           WHERE table_schema = 'regime_engine' AND table_name = 'candle_revisions'
           ORDER BY ordinal_position`
    );

    const columns = result.map((row: any) => row.column_name);

    expect(columns).toContain("id");
    expect(columns).toContain("symbol");
    expect(columns).toContain("source");
    expect(columns).toContain("network");
    expect(columns).toContain("pool_address");
    expect(columns).toContain("timeframe");
    expect(columns).toContain("unix_ms");
    expect(columns).toContain("source_recorded_at_iso");
    expect(columns).toContain("source_recorded_at_unix_ms");
    expect(columns).toContain("open");
    expect(columns).toContain("high");
    expect(columns).toContain("low");
    expect(columns).toContain("close");
    expect(columns).toContain("volume");
    expect(columns).toContain("ohlcv_canonical");
    expect(columns).toContain("ohlcv_hash");
    expect(columns).toContain("received_at_unix_ms");

    const openCol = result.find((row: any) => row.column_name === "open");
    expect(openCol?.data_type).toBe("double precision");

    await client.end();
  });

  it("has the unique index on slot+hash", async () => {
    const { db, client } = createDb(process.env.DATABASE_URL!);

    const result = await db.execute(
      sql`SELECT indexname FROM pg_indexes
           WHERE schemaname = 'regime_engine' AND tablename = 'candle_revisions'`
    );

    const indexNames = result.map((row: any) => row.indexname);

    expect(indexNames).toContain("ux_candle_revisions_slot_hash");
    expect(indexNames).toContain("idx_candle_revisions_slot_latest");
    expect(indexNames).toContain("idx_candle_revisions_feed_window");

    await client.end();
  });
});