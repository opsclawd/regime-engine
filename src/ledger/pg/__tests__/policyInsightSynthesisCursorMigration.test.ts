import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm/sql";
import { createDb } from "../db.js";

describe.skipIf(!process.env.DATABASE_URL)("policy_insight_synthesis_cursor migration (PG)", () => {
  it("creates one pair synthesis cursor row per cursor key", async () => {
    const { db, client } = createDb(process.env.DATABASE_URL!);

    await db.execute(sql`DELETE FROM regime_engine.policy_insight_synthesis_cursor`);

    await db.execute(
      sql`INSERT INTO regime_engine.policy_insight_synthesis_cursor
            (cursor_key, last_processed_receipt_id, target_receipt_id, lease_owner, lease_expires_at_unix_ms,
             attempt_count, next_attempt_at_unix_ms, last_outcome, last_error_code, last_error_message, updated_at_unix_ms)
            VALUES
            ('SOL/USDC', 10, NULL, NULL, NULL, 0, NULL, NULL, NULL, NULL, 1700000000000)`
    );

    // Duplicate insert for same cursor_key must fail
    await expect(
      db.execute(
        sql`INSERT INTO regime_engine.policy_insight_synthesis_cursor
              (cursor_key, last_processed_receipt_id, target_receipt_id, lease_owner, lease_expires_at_unix_ms,
               attempt_count, next_attempt_at_unix_ms, last_outcome, last_error_code, last_error_message, updated_at_unix_ms)
              VALUES
              ('SOL/USDC', 12, NULL, NULL, NULL, 0, NULL, NULL, NULL, NULL, 1700000005000)`
      )
    ).rejects.toThrow();

    await client.end();
  });

  it("enforces non-negative receipt and retry values", async () => {
    const { db, client } = createDb(process.env.DATABASE_URL!);

    await db.execute(sql`DELETE FROM regime_engine.policy_insight_synthesis_cursor`);

    // Negative last_processed_receipt_id
    await expect(
      db.execute(
        sql`INSERT INTO regime_engine.policy_insight_synthesis_cursor
              (cursor_key, last_processed_receipt_id, target_receipt_id, lease_owner, lease_expires_at_unix_ms,
               attempt_count, next_attempt_at_unix_ms, last_outcome, last_error_code, last_error_message, updated_at_unix_ms)
              VALUES
              ('SOL/USDC', -1, NULL, NULL, NULL, 0, NULL, NULL, NULL, NULL, 1700000000000)`
      )
    ).rejects.toThrow();

    // Negative attempt_count
    await expect(
      db.execute(
        sql`INSERT INTO regime_engine.policy_insight_synthesis_cursor
              (cursor_key, last_processed_receipt_id, target_receipt_id, lease_owner, lease_expires_at_unix_ms,
               attempt_count, next_attempt_at_unix_ms, last_outcome, last_error_code, last_error_message, updated_at_unix_ms)
              VALUES
              ('SOL/USDC', 0, NULL, NULL, NULL, -1, NULL, NULL, NULL, NULL, 1700000000000)`
      )
    ).rejects.toThrow();

    // Incoherent lease fields (lease_owner present, target_receipt_id absent)
    await expect(
      db.execute(
        sql`INSERT INTO regime_engine.policy_insight_synthesis_cursor
              (cursor_key, last_processed_receipt_id, target_receipt_id, lease_owner, lease_expires_at_unix_ms,
               attempt_count, next_attempt_at_unix_ms, last_outcome, last_error_code, last_error_message, updated_at_unix_ms)
              VALUES
              ('SOL/USDC', 0, NULL, 'owner-1', 1700000060000, 1, NULL, NULL, NULL, NULL, 1700000000000)`
      )
    ).rejects.toThrow();

    await client.end();
  });

  it("supports an expiring lease and classified outcome", async () => {
    const { db, client } = createDb(process.env.DATABASE_URL!);

    await db.execute(sql`DELETE FROM regime_engine.policy_insight_synthesis_cursor`);

    await db.execute(
      sql`INSERT INTO regime_engine.policy_insight_synthesis_cursor
            (cursor_key, last_processed_receipt_id, target_receipt_id, lease_owner, lease_expires_at_unix_ms,
             attempt_count, next_attempt_at_unix_ms, last_outcome, last_error_code, last_error_message, updated_at_unix_ms)
            VALUES
            ('SOL/USDC', 5, 6, 'worker-1', 1700000060000, 1, 1700000065000, 'transient_failure', 'TIMEOUT', 'Upstream timeout', 1700000000000)`
    );

    const rows = await db.execute(
      sql`SELECT * FROM regime_engine.policy_insight_synthesis_cursor WHERE cursor_key = 'SOL/USDC'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].last_outcome).toBe("transient_failure");
    expect(rows[0].lease_owner).toBe("worker-1");

    // Invalid outcome value
    await expect(
      db.execute(
        sql`INSERT INTO regime_engine.policy_insight_synthesis_cursor
              (cursor_key, last_processed_receipt_id, target_receipt_id, lease_owner, lease_expires_at_unix_ms,
               attempt_count, next_attempt_at_unix_ms, last_outcome, last_error_code, last_error_message, updated_at_unix_ms)
              VALUES
              ('ETH/USDC', 0, NULL, NULL, NULL, 0, NULL, 'invalid_outcome', NULL, NULL, 1700000000000)`
      )
    ).rejects.toThrow();

    await client.end();
  });
});
