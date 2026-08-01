import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm/sql";
import { createDb } from "../db.js";

describe.skipIf(!process.env.DATABASE_URL)("policy_insight_synthesis_cursor migration (PG)", () => {
  it("creates one pair synthesis cursor row per cursor key", async () => {
    const { db, client } = createDb(process.env.DATABASE_URL!);

    await db.execute(sql`DELETE FROM regime_engine.policy_insight_synthesis_cursor`);

    await db.execute(
      sql`INSERT INTO regime_engine.policy_insight_synthesis_cursor
            (cursor_key, last_processed_receipt_id, last_processed_sr_theses_max_id, target_receipt_id, target_sr_theses_max_id, lease_owner, lease_expires_at_unix_ms,
             attempt_count, next_attempt_at_unix_ms, last_outcome, last_error_code, last_error_message, updated_at_unix_ms)
            VALUES
            ('SOL/USDC', 10, 0, NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL, NULL, 1700000000000)`
    );

    // Duplicate insert for same cursor_key must fail
    await expect(
      db.execute(
        sql`INSERT INTO regime_engine.policy_insight_synthesis_cursor
              (cursor_key, last_processed_receipt_id, last_processed_sr_theses_max_id, target_receipt_id, target_sr_theses_max_id, lease_owner, lease_expires_at_unix_ms,
               attempt_count, next_attempt_at_unix_ms, last_outcome, last_error_code, last_error_message, updated_at_unix_ms)
              VALUES
              ('SOL/USDC', 12, 0, NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL, NULL, 1700000005000)`
      )
    ).rejects.toThrow();

    await client.end();
  });

  it("defaults the SR last-processed cursor to zero for existing and new rows", async () => {
    const { db, client } = createDb(process.env.DATABASE_URL!);

    await db.execute(sql`DELETE FROM regime_engine.policy_insight_synthesis_cursor`);

    // Insert omitting last_processed_sr_theses_max_id
    await db.execute(
      sql`INSERT INTO regime_engine.policy_insight_synthesis_cursor
            (cursor_key, last_processed_receipt_id, target_receipt_id, target_sr_theses_max_id, lease_owner, lease_expires_at_unix_ms,
             attempt_count, next_attempt_at_unix_ms, last_outcome, last_error_code, last_error_message, updated_at_unix_ms)
            VALUES
            ('SOL/USDC', 10, NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL, NULL, 1700000000000)`
    );

    const rows = (await db.execute(
      sql`SELECT cursor_key, last_processed_receipt_id, last_processed_sr_theses_max_id, target_sr_theses_max_id FROM regime_engine.policy_insight_synthesis_cursor WHERE cursor_key = 'SOL/USDC'`
    )) as unknown as Record<string, unknown>[];

    expect(rows).toHaveLength(1);
    expect(Number(rows[0].last_processed_sr_theses_max_id)).toBe(0);
    expect(rows[0].target_sr_theses_max_id).toBeNull();

    await client.end();
  });

  it("requires both claim targets whenever a lease is active", async () => {
    const { db, client } = createDb(process.env.DATABASE_URL!);

    await db.execute(sql`DELETE FROM regime_engine.policy_insight_synthesis_cursor`);

    // 1. Valid idle state
    await db.execute(
      sql`INSERT INTO regime_engine.policy_insight_synthesis_cursor
            (cursor_key, last_processed_receipt_id, last_processed_sr_theses_max_id, target_receipt_id, target_sr_theses_max_id, lease_owner, lease_expires_at_unix_ms,
             attempt_count, next_attempt_at_unix_ms, last_outcome, last_error_code, last_error_message, updated_at_unix_ms)
            VALUES
            ('IDLE/USDC', 0, 0, NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL, NULL, 1700000000000)`
    );

    // 2. Valid leased state
    await db.execute(
      sql`INSERT INTO regime_engine.policy_insight_synthesis_cursor
            (cursor_key, last_processed_receipt_id, last_processed_sr_theses_max_id, target_receipt_id, target_sr_theses_max_id, lease_owner, lease_expires_at_unix_ms,
             attempt_count, next_attempt_at_unix_ms, last_outcome, last_error_code, last_error_message, updated_at_unix_ms)
            VALUES
            ('LEASED/USDC', 0, 0, 10, 20, 'worker-1', 1700000060000, 1, NULL, NULL, NULL, NULL, 1700000000000)`
    );

    // 3. Valid retry cooldown state
    await db.execute(
      sql`INSERT INTO regime_engine.policy_insight_synthesis_cursor
            (cursor_key, last_processed_receipt_id, last_processed_sr_theses_max_id, target_receipt_id, target_sr_theses_max_id, lease_owner, lease_expires_at_unix_ms,
             attempt_count, next_attempt_at_unix_ms, last_outcome, last_error_code, last_error_message, updated_at_unix_ms)
            VALUES
            ('COOLDOWN/USDC', 0, 0, 10, 20, NULL, NULL, 1, 1700000065000, 'transient_failure', 'ERR', 'Retry', 1700000000000)`
    );

    // Invalid lease state: lease_owner present but missing target_sr_theses_max_id
    await expect(
      db.execute(
        sql`INSERT INTO regime_engine.policy_insight_synthesis_cursor
              (cursor_key, last_processed_receipt_id, last_processed_sr_theses_max_id, target_receipt_id, target_sr_theses_max_id, lease_owner, lease_expires_at_unix_ms,
               attempt_count, next_attempt_at_unix_ms, last_outcome, last_error_code, last_error_message, updated_at_unix_ms)
              VALUES
              ('BAD_LEASE1/USDC', 0, 0, 10, NULL, 'worker-1', 1700000060000, 1, NULL, NULL, NULL, NULL, 1700000000000)`
      )
    ).rejects.toThrow();

    // Invalid lease state: lease_owner present but missing target_receipt_id
    await expect(
      db.execute(
        sql`INSERT INTO regime_engine.policy_insight_synthesis_cursor
              (cursor_key, last_processed_receipt_id, last_processed_sr_theses_max_id, target_receipt_id, target_sr_theses_max_id, lease_owner, lease_expires_at_unix_ms,
               attempt_count, next_attempt_at_unix_ms, last_outcome, last_error_code, last_error_message, updated_at_unix_ms)
              VALUES
              ('BAD_LEASE2/USDC', 0, 0, NULL, 20, 'worker-1', 1700000060000, 1, NULL, NULL, NULL, NULL, 1700000000000)`
      )
    ).rejects.toThrow();

    // Invalid cooldown state: target_sr_theses_max_id missing during cooldown
    await expect(
      db.execute(
        sql`INSERT INTO regime_engine.policy_insight_synthesis_cursor
              (cursor_key, last_processed_receipt_id, last_processed_sr_theses_max_id, target_receipt_id, target_sr_theses_max_id, lease_owner, lease_expires_at_unix_ms,
               attempt_count, next_attempt_at_unix_ms, last_outcome, last_error_code, last_error_message, updated_at_unix_ms)
              VALUES
              ('BAD_COOLDOWN/USDC', 0, 0, 10, NULL, NULL, NULL, 1, 1700000065000, 'transient_failure', NULL, NULL, 1700000000000)`
      )
    ).rejects.toThrow();

    await client.end();
  });

  it("rejects negative SR cursor values", async () => {
    const { db, client } = createDb(process.env.DATABASE_URL!);

    await db.execute(sql`DELETE FROM regime_engine.policy_insight_synthesis_cursor`);

    // Negative last_processed_sr_theses_max_id
    await expect(
      db.execute(
        sql`INSERT INTO regime_engine.policy_insight_synthesis_cursor
              (cursor_key, last_processed_receipt_id, last_processed_sr_theses_max_id, target_receipt_id, target_sr_theses_max_id, lease_owner, lease_expires_at_unix_ms,
               attempt_count, next_attempt_at_unix_ms, last_outcome, last_error_code, last_error_message, updated_at_unix_ms)
              VALUES
              ('SOL/USDC', 0, -1, NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL, NULL, 1700000000000)`
      )
    ).rejects.toThrow();

    // Negative target_sr_theses_max_id
    await expect(
      db.execute(
        sql`INSERT INTO regime_engine.policy_insight_synthesis_cursor
              (cursor_key, last_processed_receipt_id, last_processed_sr_theses_max_id, target_receipt_id, target_sr_theses_max_id, lease_owner, lease_expires_at_unix_ms,
               attempt_count, next_attempt_at_unix_ms, last_outcome, last_error_code, last_error_message, updated_at_unix_ms)
              VALUES
              ('SOL/USDC', 0, 0, 10, -1, 'worker-1', 1700000060000, 1, NULL, NULL, NULL, NULL, 1700000000000)`
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
              (cursor_key, last_processed_receipt_id, last_processed_sr_theses_max_id, target_receipt_id, target_sr_theses_max_id, lease_owner, lease_expires_at_unix_ms,
               attempt_count, next_attempt_at_unix_ms, last_outcome, last_error_code, last_error_message, updated_at_unix_ms)
              VALUES
              ('SOL/USDC', -1, 0, NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL, NULL, 1700000000000)`
      )
    ).rejects.toThrow();

    // Negative attempt_count
    await expect(
      db.execute(
        sql`INSERT INTO regime_engine.policy_insight_synthesis_cursor
              (cursor_key, last_processed_receipt_id, last_processed_sr_theses_max_id, target_receipt_id, target_sr_theses_max_id, lease_owner, lease_expires_at_unix_ms,
               attempt_count, next_attempt_at_unix_ms, last_outcome, last_error_code, last_error_message, updated_at_unix_ms)
              VALUES
              ('SOL/USDC', 0, 0, NULL, NULL, NULL, NULL, -1, NULL, NULL, NULL, NULL, 1700000000000)`
      )
    ).rejects.toThrow();

    // Incoherent lease fields (lease_owner present, target_receipt_id absent)
    await expect(
      db.execute(
        sql`INSERT INTO regime_engine.policy_insight_synthesis_cursor
              (cursor_key, last_processed_receipt_id, last_processed_sr_theses_max_id, target_receipt_id, target_sr_theses_max_id, lease_owner, lease_expires_at_unix_ms,
               attempt_count, next_attempt_at_unix_ms, last_outcome, last_error_code, last_error_message, updated_at_unix_ms)
              VALUES
              ('SOL/USDC', 0, 0, NULL, 10, 'owner-1', 1700000060000, 1, NULL, NULL, NULL, NULL, 1700000000000)`
      )
    ).rejects.toThrow();

    await client.end();
  });

  it("supports an expiring lease and classified outcome", async () => {
    const { db, client } = createDb(process.env.DATABASE_URL!);

    await db.execute(sql`DELETE FROM regime_engine.policy_insight_synthesis_cursor`);

    await db.execute(
      sql`INSERT INTO regime_engine.policy_insight_synthesis_cursor
            (cursor_key, last_processed_receipt_id, last_processed_sr_theses_max_id, target_receipt_id, target_sr_theses_max_id, lease_owner, lease_expires_at_unix_ms,
             attempt_count, next_attempt_at_unix_ms, last_outcome, last_error_code, last_error_message, updated_at_unix_ms)
            VALUES
            ('SOL/USDC', 5, 0, 6, 10, 'worker-1', 1700000060000, 1, 1700000065000, 'transient_failure', 'TIMEOUT', 'Upstream timeout', 1700000000000)`
    );

    const rows = (await db.execute(
      sql`SELECT * FROM regime_engine.policy_insight_synthesis_cursor WHERE cursor_key = 'SOL/USDC'`
    )) as unknown as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0].last_outcome).toBe("transient_failure");
    expect(rows[0].lease_owner).toBe("worker-1");

    // Invalid outcome value
    await expect(
      db.execute(
        sql`INSERT INTO regime_engine.policy_insight_synthesis_cursor
              (cursor_key, last_processed_receipt_id, last_processed_sr_theses_max_id, target_receipt_id, target_sr_theses_max_id, lease_owner, lease_expires_at_unix_ms,
               attempt_count, next_attempt_at_unix_ms, last_outcome, last_error_code, last_error_message, updated_at_unix_ms)
              VALUES
              ('ETH/USDC', 0, 0, NULL, NULL, NULL, NULL, 0, NULL, 'invalid_outcome', NULL, NULL, 1700000000000)`
      )
    ).rejects.toThrow();

    await client.end();
  });
});
