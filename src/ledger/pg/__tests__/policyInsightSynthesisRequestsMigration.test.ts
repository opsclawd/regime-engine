import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm/sql";
import { createDb } from "../db.js";

describe.skipIf(!process.env.DATABASE_URL)(
  "policy_insight_synthesis_requests migration (PG)",
  () => {
    const HASH_A = "1111111111111111111111111111111111111111111111111111111111111111";
    const HASH_B = "2222222222222222222222222222222222222222222222222222222222222222";

    it("allows one ready request per scope selection plan and ruleset identity", async () => {
      const { db, client } = createDb(process.env.DATABASE_URL!);

      await db.execute(sql`DELETE FROM regime_engine.policy_insight_synthesis_requests`);

      await db.execute(
        sql`INSERT INTO regime_engine.policy_insight_synthesis_requests
              (scope_key, selection_hash, plan_hash, ruleset_version, status, attempt_count, next_attempt_at_unix_ms, lease_owner, lease_expires_at_unix_ms, last_error_code, last_error_message, created_at_unix_ms, updated_at_unix_ms)
              VALUES
              ('sol-usdc:pos:1', ${HASH_A}, ${HASH_B}, 'v1', 'pending', 0, NULL, NULL, NULL, NULL, NULL, 1700000000000, 1700000000000)`
      );

      // Duplicate ready request for exact same identity must fail
      await expect(
        db.execute(
          sql`INSERT INTO regime_engine.policy_insight_synthesis_requests
                (scope_key, selection_hash, plan_hash, ruleset_version, status, attempt_count, next_attempt_at_unix_ms, lease_owner, lease_expires_at_unix_ms, last_error_code, last_error_message, created_at_unix_ms, updated_at_unix_ms)
                VALUES
                ('sol-usdc:pos:1', ${HASH_A}, ${HASH_B}, 'v1', 'pending', 0, NULL, NULL, NULL, NULL, NULL, 1700000001000, 1700000001000)`
        )
      ).rejects.toThrow();

      await client.end();
    });

    it("keeps independent position scope keys in independent rows", async () => {
      const { db, client } = createDb(process.env.DATABASE_URL!);

      await db.execute(sql`DELETE FROM regime_engine.policy_insight_synthesis_requests`);

      await db.execute(
        sql`INSERT INTO regime_engine.policy_insight_synthesis_requests
              (scope_key, selection_hash, plan_hash, ruleset_version, status, attempt_count, next_attempt_at_unix_ms, lease_owner, lease_expires_at_unix_ms, last_error_code, last_error_message, created_at_unix_ms, updated_at_unix_ms)
              VALUES
              ('sol-usdc:pos:1', ${HASH_A}, ${HASH_B}, 'v1', 'pending', 0, NULL, NULL, NULL, NULL, NULL, 1700000000000, 1700000000000),
              ('sol-usdc:pos:2', ${HASH_A}, ${HASH_B}, 'v1', 'pending', 0, NULL, NULL, NULL, NULL, NULL, 1700000000000, 1700000000000)`
      );

      const rows = await db.execute(
        sql`SELECT * FROM regime_engine.policy_insight_synthesis_requests ORDER BY scope_key ASC`
      );
      expect(rows).toHaveLength(2);
      expect(rows[0].scope_key).toBe("sol-usdc:pos:1");
      expect(rows[1].scope_key).toBe("sol-usdc:pos:2");

      await client.end();
    });

    it("requires coherent lease fields only while processing", async () => {
      const { db, client } = createDb(process.env.DATABASE_URL!);

      await db.execute(sql`DELETE FROM regime_engine.policy_insight_synthesis_requests`);

      // Processing with coherent lease fields succeeds
      await db.execute(
        sql`INSERT INTO regime_engine.policy_insight_synthesis_requests
              (scope_key, selection_hash, plan_hash, ruleset_version, status, attempt_count, next_attempt_at_unix_ms, lease_owner, lease_expires_at_unix_ms, last_error_code, last_error_message, created_at_unix_ms, updated_at_unix_ms)
              VALUES
              ('sol-usdc:pos:1', ${HASH_A}, ${HASH_B}, 'v1', 'processing', 1, NULL, 'worker-1', 1700000060000, NULL, NULL, 1700000000000, 1700000000000)`
      );

      // Processing with missing lease_owner fails
      await expect(
        db.execute(
          sql`INSERT INTO regime_engine.policy_insight_synthesis_requests
                (scope_key, selection_hash, plan_hash, ruleset_version, status, attempt_count, next_attempt_at_unix_ms, lease_owner, lease_expires_at_unix_ms, last_error_code, last_error_message, created_at_unix_ms, updated_at_unix_ms)
                VALUES
                ('sol-usdc:pos:2', ${HASH_A}, ${HASH_B}, 'v1', 'processing', 1, NULL, NULL, 1700000060000, NULL, NULL, 1700000000000, 1700000000000)`
        )
      ).rejects.toThrow();

      // Pending with non-null lease fields fails
      await expect(
        db.execute(
          sql`INSERT INTO regime_engine.policy_insight_synthesis_requests
                (scope_key, selection_hash, plan_hash, ruleset_version, status, attempt_count, next_attempt_at_unix_ms, lease_owner, lease_expires_at_unix_ms, last_error_code, last_error_message, created_at_unix_ms, updated_at_unix_ms)
                VALUES
                ('sol-usdc:pos:3', ${HASH_A}, ${HASH_B}, 'v1', 'pending', 0, NULL, 'worker-1', 1700000060000, NULL, NULL, 1700000000000, 1700000000000)`
        )
      ).rejects.toThrow();

      await client.end();
    });

    it("allows waiting rows to omit exactly the unavailable hash", async () => {
      const { db, client } = createDb(process.env.DATABASE_URL!);

      await db.execute(sql`DELETE FROM regime_engine.policy_insight_synthesis_requests`);

      // waiting_for_plan has selection_hash and no plan_hash
      await db.execute(
        sql`INSERT INTO regime_engine.policy_insight_synthesis_requests
              (scope_key, selection_hash, plan_hash, ruleset_version, status, attempt_count, next_attempt_at_unix_ms, lease_owner, lease_expires_at_unix_ms, last_error_code, last_error_message, created_at_unix_ms, updated_at_unix_ms)
              VALUES
              ('sol-usdc:pos:1', ${HASH_A}, NULL, 'v1', 'waiting_for_plan', 0, NULL, NULL, NULL, NULL, NULL, 1700000000000, 1700000000000)`
      );

      // waiting_for_evidence has plan_hash and no selection_hash
      await db.execute(
        sql`INSERT INTO regime_engine.policy_insight_synthesis_requests
              (scope_key, selection_hash, plan_hash, ruleset_version, status, attempt_count, next_attempt_at_unix_ms, lease_owner, lease_expires_at_unix_ms, last_error_code, last_error_message, created_at_unix_ms, updated_at_unix_ms)
              VALUES
              ('sol-usdc:pos:2', NULL, ${HASH_B}, 'v1', 'waiting_for_evidence', 0, NULL, NULL, NULL, NULL, NULL, 1700000000000, 1700000000000)`
      );

      // waiting_for_plan with plan_hash provided fails
      await expect(
        db.execute(
          sql`INSERT INTO regime_engine.policy_insight_synthesis_requests
                (scope_key, selection_hash, plan_hash, ruleset_version, status, attempt_count, next_attempt_at_unix_ms, lease_owner, lease_expires_at_unix_ms, last_error_code, last_error_message, created_at_unix_ms, updated_at_unix_ms)
                VALUES
                ('sol-usdc:pos:3', ${HASH_A}, ${HASH_B}, 'v1', 'waiting_for_plan', 0, NULL, NULL, NULL, NULL, NULL, 1700000000000, 1700000000000)`
        )
      ).rejects.toThrow();

      // pending without plan_hash fails
      await expect(
        db.execute(
          sql`INSERT INTO regime_engine.policy_insight_synthesis_requests
                (scope_key, selection_hash, plan_hash, ruleset_version, status, attempt_count, next_attempt_at_unix_ms, lease_owner, lease_expires_at_unix_ms, last_error_code, last_error_message, created_at_unix_ms, updated_at_unix_ms)
                VALUES
                ('sol-usdc:pos:4', ${HASH_A}, NULL, 'v1', 'pending', 0, NULL, NULL, NULL, NULL, NULL, 1700000000000, 1700000000000)`
        )
      ).rejects.toThrow();

      await client.end();
    });

    it("rejects invalid statuses negative attempts malformed hashes and terminal rows with active leases", async () => {
      const { db, client } = createDb(process.env.DATABASE_URL!);

      await db.execute(sql`DELETE FROM regime_engine.policy_insight_synthesis_requests`);

      // Invalid status
      await expect(
        db.execute(
          sql`INSERT INTO regime_engine.policy_insight_synthesis_requests
                (scope_key, selection_hash, plan_hash, ruleset_version, status, attempt_count, next_attempt_at_unix_ms, lease_owner, lease_expires_at_unix_ms, last_error_code, last_error_message, created_at_unix_ms, updated_at_unix_ms)
                VALUES
                ('sol-usdc:pos:1', ${HASH_A}, ${HASH_B}, 'v1', 'unknown_status', 0, NULL, NULL, NULL, NULL, NULL, 1700000000000, 1700000000000)`
        )
      ).rejects.toThrow();

      // Negative attempt_count
      await expect(
        db.execute(
          sql`INSERT INTO regime_engine.policy_insight_synthesis_requests
                (scope_key, selection_hash, plan_hash, ruleset_version, status, attempt_count, next_attempt_at_unix_ms, lease_owner, lease_expires_at_unix_ms, last_error_code, last_error_message, created_at_unix_ms, updated_at_unix_ms)
                VALUES
                ('sol-usdc:pos:1', ${HASH_A}, ${HASH_B}, 'v1', 'pending', -1, NULL, NULL, NULL, NULL, NULL, 1700000000000, 1700000000000)`
        )
      ).rejects.toThrow();

      // Malformed hash
      await expect(
        db.execute(
          sql`INSERT INTO regime_engine.policy_insight_synthesis_requests
                (scope_key, selection_hash, plan_hash, ruleset_version, status, attempt_count, next_attempt_at_unix_ms, lease_owner, lease_expires_at_unix_ms, last_error_code, last_error_message, created_at_unix_ms, updated_at_unix_ms)
                VALUES
                ('sol-usdc:pos:1', 'not_a_valid_hash', ${HASH_B}, 'v1', 'pending', 0, NULL, NULL, NULL, NULL, NULL, 1700000000000, 1700000000000)`
        )
      ).rejects.toThrow();

      // Terminal row (completed) with active lease
      await expect(
        db.execute(
          sql`INSERT INTO regime_engine.policy_insight_synthesis_requests
                (scope_key, selection_hash, plan_hash, ruleset_version, status, attempt_count, next_attempt_at_unix_ms, lease_owner, lease_expires_at_unix_ms, last_error_code, last_error_message, created_at_unix_ms, updated_at_unix_ms)
                VALUES
                ('sol-usdc:pos:1', ${HASH_A}, ${HASH_B}, 'v1', 'completed', 1, NULL, 'worker-1', 1700000060000, NULL, NULL, 1700000000000, 1700000000000)`
        )
      ).rejects.toThrow();

      await client.end();
    });
  }
);
