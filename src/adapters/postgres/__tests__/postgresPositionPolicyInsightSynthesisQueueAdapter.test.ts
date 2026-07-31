import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../../../ledger/pg/db.js";
import { createPostgresPositionPolicyInsightSynthesisQueueAdapter } from "../postgresPositionPolicyInsightSynthesisQueueAdapter.js";
import { sql } from "drizzle-orm";

const SUITE_PREFIX = `test-q-${Math.random().toString(36).substring(2, 9)}`;
const TEST_PUBLISHER = `${SUITE_PREFIX}-publisher`;
const HASH_1 = "1111111111111111111111111111111111111111111111111111111111111111";
const HASH_2 = "2222222222222222222222222222222222222222222222222222222222222222";
const HASH_3 = "3333333333333333333333333333333333333333333333333333333333333333";
const RULESET_V1 = "v1.0.0";

describe.skipIf(!process.env.DATABASE_URL)(
  "postgresPositionPolicyInsightSynthesisQueueAdapter",
  () => {
    let db: Db;
    let client: ReturnType<typeof createDb>["client"];
    let adapter: ReturnType<typeof createPostgresPositionPolicyInsightSynthesisQueueAdapter>;

    beforeAll(() => {
      const result = createDb(process.env.DATABASE_URL!);
      db = result.db;
      client = result.client;
      adapter = createPostgresPositionPolicyInsightSynthesisQueueAdapter(db);
    });

    afterEach(async () => {
      await db.execute(sql`
      DELETE FROM regime_engine.policy_insight_synthesis_requests
      WHERE scope_key LIKE ${`${SUITE_PREFIX}%`}
    `);
      await db.execute(sql`
      DELETE FROM regime_engine.evidence_bundles
      WHERE source_publisher = ${TEST_PUBLISHER}
    `);
    });

    afterAll(async () => {
      await db.execute(sql`
      DELETE FROM regime_engine.policy_insight_synthesis_requests
      WHERE scope_key LIKE ${`${SUITE_PREFIX}%`}
    `);
      await db.execute(sql`
      DELETE FROM regime_engine.evidence_bundles
      WHERE source_publisher = ${TEST_PUBLISHER}
    `);
      await client.end();
    });

    it("replaying an identical ready identity returns the original request id", async () => {
      const scopeKey = `${SUITE_PREFIX}-replay-1`;
      const now = 1000;

      const req1 = await adapter.enqueueOrReconcile({
        scopeKey,
        selectionHash: HASH_1,
        planHash: HASH_2,
        rulesetVersion: RULESET_V1,
        nowUnixMs: now
      });

      expect(req1.status).toBe("pending");

      const req2 = await adapter.enqueueOrReconcile({
        scopeKey,
        selectionHash: HASH_1,
        planHash: HASH_2,
        rulesetVersion: RULESET_V1,
        nowUnixMs: now + 500
      });

      expect(req2.id).toBe(req1.id);
      expect(req2.status).toBe("pending");
    });

    it("evidence first persists waiting_for_plan and plan reconciliation promotes it to pending", async () => {
      const scopeKey = `${SUITE_PREFIX}-ev-first`;
      const now = 1000;

      const req1 = await adapter.enqueueOrReconcile({
        scopeKey,
        selectionHash: HASH_1,
        rulesetVersion: RULESET_V1,
        nowUnixMs: now
      });

      expect(req1.status).toBe("waiting_for_plan");
      expect(req1.selectionHash).toBe(HASH_1);
      expect(req1.planHash).toBeNull();

      const req2 = await adapter.enqueueOrReconcile({
        scopeKey,
        selectionHash: HASH_1,
        planHash: HASH_2,
        rulesetVersion: RULESET_V1,
        nowUnixMs: now + 500
      });

      expect(req2.id).toBe(req1.id);
      expect(req2.status).toBe("pending");
      expect(req2.selectionHash).toBe(HASH_1);
      expect(req2.planHash).toBe(HASH_2);
    });

    it("plan first persists waiting_for_evidence and evidence reconciliation promotes it to pending", async () => {
      const scopeKey = `${SUITE_PREFIX}-plan-first`;
      const now = 1000;

      const req1 = await adapter.enqueueOrReconcile({
        scopeKey,
        planHash: HASH_2,
        rulesetVersion: RULESET_V1,
        nowUnixMs: now
      });

      expect(req1.status).toBe("waiting_for_evidence");
      expect(req1.selectionHash).toBeNull();
      expect(req1.planHash).toBe(HASH_2);

      const req2 = await adapter.enqueueOrReconcile({
        scopeKey,
        selectionHash: HASH_1,
        planHash: HASH_2,
        rulesetVersion: RULESET_V1,
        nowUnixMs: now + 500
      });

      expect(req2.id).toBe(req1.id);
      expect(req2.status).toBe("pending");
      expect(req2.selectionHash).toBe(HASH_1);
      expect(req2.planHash).toBe(HASH_2);
    });

    it("claims independent positions in deterministic id order with skip locked", async () => {
      const scope1 = `${SUITE_PREFIX}-pos-1`;
      const scope2 = `${SUITE_PREFIX}-pos-2`;
      const now = 1000;

      const req1 = await adapter.enqueueOrReconcile({
        scopeKey: scope1,
        selectionHash: HASH_1,
        planHash: HASH_2,
        rulesetVersion: RULESET_V1,
        nowUnixMs: now
      });

      const req2 = await adapter.enqueueOrReconcile({
        scopeKey: scope1,
        selectionHash: HASH_2,
        planHash: HASH_3,
        rulesetVersion: RULESET_V1,
        nowUnixMs: now + 10
      });

      const req3 = await adapter.enqueueOrReconcile({
        scopeKey: scope2,
        selectionHash: HASH_1,
        planHash: HASH_3,
        rulesetVersion: RULESET_V1,
        nowUnixMs: now + 20
      });

      const claims = await adapter.claimBatch({
        leaseOwner: "worker-A",
        leaseDurationMs: 60000,
        batchSize: 10,
        nowUnixMs: now + 100
      });

      expect(claims).toHaveLength(2);
      expect(claims[0].id).toBe(req1.id);
      expect(claims[0].scopeKey).toBe(scope1);
      expect(claims[1].id).toBe(req3.id);
      expect(claims[1].scopeKey).toBe(scope2);

      // req2 is for scope1, which is now actively being processed by req1, so req2 is skipped
      expect(claims.find((c) => c.id === req2.id)).toBeUndefined();
    });

    it("does not steal an unexpired processing lease", async () => {
      const scopeKey = `${SUITE_PREFIX}-unexpired`;
      const now = 1000;

      const req1 = await adapter.enqueueOrReconcile({
        scopeKey,
        selectionHash: HASH_1,
        planHash: HASH_2,
        rulesetVersion: RULESET_V1,
        nowUnixMs: now
      });

      const claims1 = await adapter.claimBatch({
        leaseOwner: "worker-A",
        leaseDurationMs: 60000,
        batchSize: 10,
        nowUnixMs: now + 100
      });

      expect(claims1).toHaveLength(1);
      expect(claims1[0].id).toBe(req1.id);

      const claims2 = await adapter.claimBatch({
        leaseOwner: "worker-B",
        leaseDurationMs: 60000,
        batchSize: 10,
        nowUnixMs: now + 5000
      });

      expect(claims2).toHaveLength(0);
    });

    it("reclaims an expired processing lease and increments attempt count", async () => {
      const scopeKey = `${SUITE_PREFIX}-expired`;
      const now = 1000;

      const req1 = await adapter.enqueueOrReconcile({
        scopeKey,
        selectionHash: HASH_1,
        planHash: HASH_2,
        rulesetVersion: RULESET_V1,
        nowUnixMs: now
      });

      const claims1 = await adapter.claimBatch({
        leaseOwner: "worker-A",
        leaseDurationMs: 5000,
        batchSize: 10,
        nowUnixMs: now
      });

      expect(claims1[0].attemptCount).toBe(1);
      expect(claims1[0].leaseOwner).toBe("worker-A");

      const claims2 = await adapter.claimBatch({
        leaseOwner: "worker-B",
        leaseDurationMs: 5000,
        batchSize: 10,
        nowUnixMs: now + 6000
      });

      expect(claims2).toHaveLength(1);
      expect(claims2[0].id).toBe(req1.id);
      expect(claims2[0].leaseOwner).toBe("worker-B");
      expect(claims2[0].attemptCount).toBe(2);
    });

    it("only the current lease owner can complete fail supersede or release a request", async () => {
      const scopeKey = `${SUITE_PREFIX}-owner-guard`;
      const now = 1000;

      const req1 = await adapter.enqueueOrReconcile({
        scopeKey,
        selectionHash: HASH_1,
        planHash: HASH_2,
        rulesetVersion: RULESET_V1,
        nowUnixMs: now
      });

      await adapter.claimBatch({
        leaseOwner: "worker-A",
        leaseDurationMs: 60000,
        batchSize: 10,
        nowUnixMs: now
      });

      const badComplete = await adapter.complete({
        id: req1.id,
        leaseOwner: "worker-B",
        nowUnixMs: now + 100
      });
      expect(badComplete).toBe(false);

      const badFail = await adapter.fail({
        id: req1.id,
        leaseOwner: "worker-B",
        nowUnixMs: now + 100,
        errorCode: "ERR",
        errorMessage: "msg"
      });
      expect(badFail).toBe(false);

      const badSupersede = await adapter.supersede({
        id: req1.id,
        leaseOwner: "worker-B",
        nowUnixMs: now + 100
      });
      expect(badSupersede).toBe(false);

      const badRetry = await adapter.releaseForRetry({
        id: req1.id,
        leaseOwner: "worker-B",
        nowUnixMs: now + 100,
        retryAtUnixMs: now + 5000
      });
      expect(badRetry).toBe(false);

      const goodComplete = await adapter.complete({
        id: req1.id,
        leaseOwner: "worker-A",
        nowUnixMs: now + 100
      });
      expect(goodComplete).toBe(true);

      const checkReq = await adapter.getById(req1.id);
      expect(checkReq?.status).toBe("completed");
      expect(checkReq?.leaseOwner).toBeNull();
    });

    it("release for retry keeps the identity and makes it claimable only at retryAtUnixMs", async () => {
      const scopeKey = `${SUITE_PREFIX}-retry-delay`;
      const now = 1000;

      const req1 = await adapter.enqueueOrReconcile({
        scopeKey,
        selectionHash: HASH_1,
        planHash: HASH_2,
        rulesetVersion: RULESET_V1,
        nowUnixMs: now
      });

      await adapter.claimBatch({
        leaseOwner: "worker-A",
        leaseDurationMs: 60000,
        batchSize: 10,
        nowUnixMs: now
      });

      const retryOk = await adapter.releaseForRetry({
        id: req1.id,
        leaseOwner: "worker-A",
        nowUnixMs: now + 100,
        retryAtUnixMs: now + 10000,
        errorCode: "TRANSIENT_TIMEOUT",
        errorMessage: "Timed out"
      });
      expect(retryOk).toBe(true);

      const reqState = await adapter.getById(req1.id);
      expect(reqState?.status).toBe("pending");
      expect(reqState?.nextAttemptAtUnixMs).toBe(now + 10000);
      expect(reqState?.leaseOwner).toBeNull();

      const claimEarly = await adapter.claimBatch({
        leaseOwner: "worker-B",
        leaseDurationMs: 60000,
        batchSize: 10,
        nowUnixMs: now + 5000
      });
      expect(claimEarly).toHaveLength(0);

      const claimLate = await adapter.claimBatch({
        leaseOwner: "worker-B",
        leaseDurationMs: 60000,
        batchSize: 10,
        nowUnixMs: now + 11000
      });
      expect(claimLate).toHaveLength(1);
      expect(claimLate[0].id).toBe(req1.id);
      expect(claimLate[0].attemptCount).toBe(2);
    });

    it("converts release for retry into permanent failure with EXHAUSTED_RETRIES when attempt count reaches max attempts", async () => {
      const scopeKey = `${SUITE_PREFIX}-exhausted`;
      const now = 1000;

      const req1 = await adapter.enqueueOrReconcile({
        scopeKey,
        selectionHash: HASH_1,
        planHash: HASH_2,
        rulesetVersion: RULESET_V1,
        nowUnixMs: now
      });

      let currentNow = now;
      // Attempt 1 through 4: release for retry succeeds and resets to pending
      for (let i = 1; i <= 4; i++) {
        const claims = await adapter.claimBatch({
          leaseOwner: "worker-A",
          leaseDurationMs: 60000,
          batchSize: 10,
          nowUnixMs: currentNow
        });
        expect(claims).toHaveLength(1);
        expect(claims[0].attemptCount).toBe(i);

        currentNow += 100;
        const retryOk = await adapter.releaseForRetry({
          id: req1.id,
          leaseOwner: "worker-A",
          nowUnixMs: currentNow,
          retryAtUnixMs: currentNow + 50,
          maxAttempts: 5
        });
        expect(retryOk).toBe(true);

        const state = await adapter.getById(req1.id);
        expect(state?.status).toBe("pending");
        currentNow += 100;
      }

      // Attempt 5: claim brings attemptCount to 5
      const claims5 = await adapter.claimBatch({
        leaseOwner: "worker-A",
        leaseDurationMs: 60000,
        batchSize: 10,
        nowUnixMs: currentNow
      });
      expect(claims5).toHaveLength(1);
      expect(claims5[0].attemptCount).toBe(5);

      currentNow += 100;
      const retryOk5 = await adapter.releaseForRetry({
        id: req1.id,
        leaseOwner: "worker-A",
        nowUnixMs: currentNow,
        retryAtUnixMs: currentNow + 500,
        maxAttempts: 5
      });
      expect(retryOk5).toBe(true);

      const finalState = await adapter.getById(req1.id);
      expect(finalState?.status).toBe("failed");
      expect(finalState?.lastErrorCode).toBe("EXHAUSTED_RETRIES");
      expect(finalState?.leaseOwner).toBeNull();
    });

    it("lists waiting scopes correctly", async () => {
      const scopeWaitingPlan = `${SUITE_PREFIX}-wait-plan`;
      const scopeWaitingEv = `${SUITE_PREFIX}-wait-ev`;
      const scopePending = `${SUITE_PREFIX}-pending-scope`;

      await adapter.enqueueOrReconcile({
        scopeKey: scopeWaitingPlan,
        selectionHash: HASH_1,
        rulesetVersion: RULESET_V1,
        nowUnixMs: 1000
      });

      await adapter.enqueueOrReconcile({
        scopeKey: scopeWaitingEv,
        planHash: HASH_2,
        rulesetVersion: RULESET_V1,
        nowUnixMs: 1000
      });

      await adapter.enqueueOrReconcile({
        scopeKey: scopePending,
        selectionHash: HASH_1,
        planHash: HASH_2,
        rulesetVersion: RULESET_V1,
        nowUnixMs: 1000
      });

      const waiting = await adapter.listWaitingScopes();
      expect(waiting).toContain(scopeWaitingPlan);
      expect(waiting).toContain(scopeWaitingEv);
      expect(waiting).not.toContain(scopePending);
    });

    it("lists eligible position scopes from unexpired evidence bundles", async () => {
      const posScope1 = `${SUITE_PREFIX}-evidence-pos-1`;
      const posScope2 = `${SUITE_PREFIX}-evidence-pos-2`;
      const pairScope = "pair";

      await db.execute(sql`
      INSERT INTO regime_engine.evidence_bundles (
        schema_version, source_publisher, source_id, run_id, pair, scope_key, correlation_id,
        as_of_unix_ms, created_at_unix_ms, received_at_unix_ms, fresh_until_unix_ms, expires_at_unix_ms,
        evidence_json, evidence_canonical, evidence_hash, ingested_at_unix_ms, processed_at_unix_ms
      ) VALUES
      ('evidence-bundle.v1', ${TEST_PUBLISHER}, 's1', 'r1', 'SOL/USDC', ${posScope1}, 'c1', 1000, 1000, 1000, 2000, 5000, '{}'::jsonb, '{}', 'a000000000000000000000000000000000000000000000000000000000000000', 1000, 0),
      ('evidence-bundle.v1', ${TEST_PUBLISHER}, 's2', 'r2', 'SOL/USDC', ${posScope2}, 'c2', 1000, 1000, 1000, 1200, 1500, '{}'::jsonb, '{}', 'b000000000000000000000000000000000000000000000000000000000000000', 1000, 0),
      ('evidence-bundle.v1', ${TEST_PUBLISHER}, 's3', 'r3', 'SOL/USDC', ${pairScope}, 'c3', 1000, 1000, 1000, 2000, 5000, '{}'::jsonb, '{}', 'c000000000000000000000000000000000000000000000000000000000000000', 1000, 0)
    `);

      const eligibleAt2000 = await adapter.listEligiblePositionScopes(2000);
      expect(eligibleAt2000).toContain(posScope1);
      expect(eligibleAt2000).not.toContain(posScope2); // expired at 1500
      expect(eligibleAt2000).not.toContain(pairScope); // pair scope excluded
    });

    it("handles concurrent identical enqueues atomically without unique constraint errors", async () => {
      const db2Obj = createDb(process.env.DATABASE_URL!);
      const adapter2 = createPostgresPositionPolicyInsightSynthesisQueueAdapter(db2Obj.db);

      try {
        const scopeKey = `${SUITE_PREFIX}-concurrent-identical`;
        const now = 1000;

        const [req1, req2] = await Promise.all([
          adapter.enqueueOrReconcile({
            scopeKey,
            selectionHash: HASH_1,
            planHash: HASH_2,
            rulesetVersion: RULESET_V1,
            nowUnixMs: now
          }),
          adapter2.enqueueOrReconcile({
            scopeKey,
            selectionHash: HASH_1,
            planHash: HASH_2,
            rulesetVersion: RULESET_V1,
            nowUnixMs: now
          })
        ]);

        expect(req1.id).toBe(req2.id);
        expect(req1.status).toBe("pending");
        expect(req2.status).toBe("pending");
      } finally {
        await db2Obj.client.end();
      }
    });

    it("handles concurrent competing reconciliations cleanly", async () => {
      const db2Obj = createDb(process.env.DATABASE_URL!);
      const adapter2 = createPostgresPositionPolicyInsightSynthesisQueueAdapter(db2Obj.db);

      try {
        const scopeKey = `${SUITE_PREFIX}-concurrent-competing`;
        const now = 1000;

        const initial = await adapter.enqueueOrReconcile({
          scopeKey,
          selectionHash: HASH_1,
          rulesetVersion: RULESET_V1,
          nowUnixMs: now
        });
        expect(initial.status).toBe("waiting_for_plan");

        const [req1, req2] = await Promise.all([
          adapter.enqueueOrReconcile({
            scopeKey,
            selectionHash: HASH_1,
            planHash: HASH_2,
            rulesetVersion: RULESET_V1,
            nowUnixMs: now + 100
          }),
          adapter2.enqueueOrReconcile({
            scopeKey,
            selectionHash: HASH_1,
            planHash: HASH_2,
            rulesetVersion: RULESET_V1,
            nowUnixMs: now + 100
          })
        ]);

        expect(req1.id).toBe(initial.id);
        expect(req2.id).toBe(initial.id);
        expect(req1.status).toBe("pending");
        expect(req2.status).toBe("pending");
        expect(req1.planHash).toBe(HASH_2);
      } finally {
        await db2Obj.client.end();
      }
    });

    it("skips candidate rows locked by another open transaction and claims other eligible scopes", async () => {
      const db2Obj = createDb(process.env.DATABASE_URL!);
      const adapter2 = createPostgresPositionPolicyInsightSynthesisQueueAdapter(db2Obj.db);

      try {
        const scope1 = `${SUITE_PREFIX}-locked-scope-1`;
        const scope2 = `${SUITE_PREFIX}-locked-scope-2`;
        const now = 1000;

        const req1 = await adapter.enqueueOrReconcile({
          scopeKey: scope1,
          selectionHash: HASH_1,
          planHash: HASH_2,
          rulesetVersion: RULESET_V1,
          nowUnixMs: now
        });

        const req2 = await adapter.enqueueOrReconcile({
          scopeKey: scope2,
          selectionHash: HASH_1,
          planHash: HASH_3,
          rulesetVersion: RULESET_V1,
          nowUnixMs: now + 10
        });

        let releaseLock!: () => void;
        const lockPromise = new Promise<void>((resolve) => {
          releaseLock = resolve;
        });

        const txPromise = db.transaction(async (tx) => {
          await tx.execute(sql`
          SELECT * FROM regime_engine.policy_insight_synthesis_requests
          WHERE id = ${req1.id}
          FOR UPDATE
        `);
          await lockPromise;
        });

        await new Promise((r) => setTimeout(r, 50));

        const claims = await adapter2.claimBatch({
          leaseOwner: "worker-B",
          leaseDurationMs: 60000,
          batchSize: 2,
          nowUnixMs: now + 100
        });

        releaseLock();
        await txPromise;

        expect(claims).toHaveLength(1);
        expect(claims[0].id).toBe(req2.id);
        expect(claims[0].scopeKey).toBe(scope2);
      } finally {
        await db2Obj.client.end();
      }
    });

    it("refills candidate batch up to batchSize when earlier candidate scopes are locked", async () => {
      const db2Obj = createDb(process.env.DATABASE_URL!);
      const adapter2 = createPostgresPositionPolicyInsightSynthesisQueueAdapter(db2Obj.db);

      try {
        const scope1 = `${SUITE_PREFIX}-refill-1`;
        const scope2 = `${SUITE_PREFIX}-refill-2`;
        const scope3 = `${SUITE_PREFIX}-refill-3`;
        const now = 1000;

        const req1 = await adapter.enqueueOrReconcile({
          scopeKey: scope1,
          selectionHash: HASH_1,
          planHash: HASH_2,
          rulesetVersion: RULESET_V1,
          nowUnixMs: now
        });
        const req2 = await adapter.enqueueOrReconcile({
          scopeKey: scope2,
          selectionHash: HASH_1,
          planHash: HASH_2,
          rulesetVersion: RULESET_V1,
          nowUnixMs: now + 5
        });
        const req3 = await adapter.enqueueOrReconcile({
          scopeKey: scope3,
          selectionHash: HASH_1,
          planHash: HASH_2,
          rulesetVersion: RULESET_V1,
          nowUnixMs: now + 10
        });

        let releaseLock!: () => void;
        const lockPromise = new Promise<void>((resolve) => {
          releaseLock = resolve;
        });

        const txPromise = db.transaction(async (tx) => {
          await tx.execute(sql`
          SELECT * FROM regime_engine.policy_insight_synthesis_requests
          WHERE id = ${req1.id}
          FOR UPDATE
        `);
          await lockPromise;
        });

        await new Promise((r) => setTimeout(r, 50));

        const claims = await adapter2.claimBatch({
          leaseOwner: "worker-B",
          leaseDurationMs: 60000,
          batchSize: 2,
          nowUnixMs: now + 100
        });

        releaseLock();
        await txPromise;

        expect(claims).toHaveLength(2);
        expect(claims[0].id).toBe(req2.id);
        expect(claims[1].id).toBe(req3.id);
      } finally {
        await db2Obj.client.end();
      }
    });
  }
);
