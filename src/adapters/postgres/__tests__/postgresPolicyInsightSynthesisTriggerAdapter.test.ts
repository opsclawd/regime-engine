import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../../../ledger/pg/db.js";
import { createPostgresPolicyInsightSynthesisTriggerAdapter } from "../postgresPolicyInsightSynthesisTriggerAdapter.js";
import { sql } from "drizzle-orm";

const TEST_CURSOR_KEY = "test-pair-synthesis-cursor";
const TEST_PUBLISHER = "test-trigger-publisher";

describe.skipIf(!process.env.DATABASE_URL)("postgresPolicyInsightSynthesisTriggerAdapter", () => {
  let db: Db;
  let adapter: ReturnType<typeof createPostgresPolicyInsightSynthesisTriggerAdapter>;

  beforeAll(() => {
    const result = createDb(process.env.DATABASE_URL!);
    db = result.db;
    adapter = createPostgresPolicyInsightSynthesisTriggerAdapter(db);
  });

  afterEach(async () => {
    await db.execute(sql`
      DELETE FROM regime_engine.policy_insight_synthesis_cursor
      WHERE cursor_key LIKE 'test-%'
    `);
    await db.execute(sql`
      DELETE FROM regime_engine.evidence_bundles
      WHERE source_publisher = ${TEST_PUBLISHER}
    `);
  });

  async function insertBundle(
    opts: {
      pair?: string;
      scopeKey?: string;
      sourceId?: string;
      runId?: string;
    } = {}
  ): Promise<number> {
    const pair = opts.pair ?? "SOL/USDC";
    const scopeKey = opts.scopeKey ?? "pair";
    const publisher = TEST_PUBLISHER;
    const sourceId = opts.sourceId ?? `source-${Math.random().toString(36).substring(2, 9)}`;
    const runId = opts.runId ?? `run-${Math.random().toString(36).substring(2, 9)}`;

    const result = await db.execute(sql`
      INSERT INTO regime_engine.evidence_bundles (
        schema_version,
        source_publisher,
        source_id,
        run_id,
        pair,
        scope_key,
        correlation_id,
        as_of_unix_ms,
        created_at_unix_ms,
        received_at_unix_ms,
        fresh_until_unix_ms,
        expires_at_unix_ms,
        evidence_json,
        evidence_canonical,
        evidence_hash,
        ingested_at_unix_ms,
        processed_at_unix_ms
      ) VALUES (
        'evidence-bundle.v1',
        ${publisher},
        ${sourceId},
        ${runId},
        ${pair},
        ${scopeKey},
        'corr-001',
        1000,
        1000,
        1000,
        2000,
        3000,
        '{}'::jsonb,
        '{}',
        'a000000000000000000000000000000000000000000000000000000000000000',
        1000,
        0
      )
      RETURNING id
    `);
    return Number((result[0] as unknown as { id: number }).id);
  }

  it("claims the newest historical pair receipt when the cursor is absent", async () => {
    const id1 = await insertBundle();
    const id2 = await insertBundle();
    expect(id2).toBeGreaterThan(id1);

    const claim = await adapter.claimLatestPairEvidence({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-1",
      leaseDurationMs: 60000,
      nowUnixMs: 1000
    });

    expect(claim).not.toBeNull();
    expect(claim?.targetReceiptId).toBe(id2);
    expect(claim?.lastProcessedReceiptId).toBe(0);
    expect(claim?.attemptCount).toBe(1);
    expect(claim?.leaseOwner).toBe("worker-1");
  });

  it("coalesces multiple pending pair receipts to the highest id", async () => {
    const id1 = await insertBundle();
    const claim1 = await adapter.claimLatestPairEvidence({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-1",
      leaseDurationMs: 60000,
      nowUnixMs: 1000
    });
    expect(claim1?.targetReceiptId).toBe(id1);
    await adapter.complete({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-1",
      targetReceiptId: id1,
      nowUnixMs: 1500,
      outcome: "success"
    });

    await insertBundle();
    await insertBundle();
    const id4 = await insertBundle();

    const claim2 = await adapter.claimLatestPairEvidence({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-2",
      leaseDurationMs: 60000,
      nowUnixMs: 2000
    });

    expect(claim2).not.toBeNull();
    expect(claim2?.targetReceiptId).toBe(id4);
    expect(claim2?.lastProcessedReceiptId).toBe(id1);
  });

  it("never claims non-pair evidence", async () => {
    await insertBundle({ scopeKey: "wallet:abc12345" });
    await insertBundle({ scopeKey: "whirlpool:xyz987" });

    const claim = await adapter.claimLatestPairEvidence({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-1",
      leaseDurationMs: 60000,
      nowUnixMs: 1000
    });

    expect(claim).toBeNull();
  });

  it("returns idle while another unexpired lease owns the claim", async () => {
    const id1 = await insertBundle();
    const claim1 = await adapter.claimLatestPairEvidence({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-1",
      leaseDurationMs: 60000,
      nowUnixMs: 1000
    });
    expect(claim1?.targetReceiptId).toBe(id1);

    const claim2 = await adapter.claimLatestPairEvidence({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-2",
      leaseDurationMs: 60000,
      nowUnixMs: 2000
    });

    expect(claim2).toBeNull();
  });

  it("reclaims the target after lease expiry", async () => {
    const id1 = await insertBundle();
    const claim1 = await adapter.claimLatestPairEvidence({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-1",
      leaseDurationMs: 5000,
      nowUnixMs: 1000
    });
    expect(claim1?.targetReceiptId).toBe(id1);

    const claim2 = await adapter.claimLatestPairEvidence({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-2",
      leaseDurationMs: 5000,
      nowUnixMs: 7000
    });

    expect(claim2).not.toBeNull();
    expect(claim2?.targetReceiptId).toBe(id1);
    expect(claim2?.leaseOwner).toBe("worker-2");
    expect(claim2?.attemptCount).toBe(2);
  });

  it("only the matching owner and target can complete a claim", async () => {
    const id1 = await insertBundle();
    await adapter.claimLatestPairEvidence({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-1",
      leaseDurationMs: 60000,
      nowUnixMs: 1000
    });

    const wrongOwnerResult = await adapter.complete({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-2",
      targetReceiptId: id1,
      nowUnixMs: 2000,
      outcome: "success"
    });
    expect(wrongOwnerResult).toBe(false);

    const wrongTargetResult = await adapter.complete({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-1",
      targetReceiptId: id1 + 999,
      nowUnixMs: 2000,
      outcome: "success"
    });
    expect(wrongTargetResult).toBe(false);

    const correctResult = await adapter.complete({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-1",
      targetReceiptId: id1,
      nowUnixMs: 2000,
      outcome: "success"
    });
    expect(correctResult).toBe(true);
  });

  it("success advances the cursor and clears retry state", async () => {
    const id1 = await insertBundle();
    await adapter.claimLatestPairEvidence({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-1",
      leaseDurationMs: 60000,
      nowUnixMs: 1000
    });

    const ok = await adapter.complete({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-1",
      targetReceiptId: id1,
      nowUnixMs: 2000,
      outcome: "success"
    });
    expect(ok).toBe(true);

    const rows = await db.execute(sql`
      SELECT * FROM regime_engine.policy_insight_synthesis_cursor
      WHERE cursor_key = ${TEST_CURSOR_KEY}
    `);
    const row = rows[0] as unknown as {
      last_processed_receipt_id: number;
      target_receipt_id: number | null;
      lease_owner: string | null;
      attempt_count: number;
      next_attempt_at_unix_ms: number | null;
      last_outcome: string | null;
    };
    expect(Number(row.last_processed_receipt_id)).toBe(id1);
    expect(row.target_receipt_id).toBeNull();
    expect(row.lease_owner).toBeNull();
    expect(row.attempt_count).toBe(0);
    expect(row.next_attempt_at_unix_ms).toBeNull();
    expect(row.last_outcome).toBe("success");
  });

  it("permanent failure advances the cursor", async () => {
    const id1 = await insertBundle();
    await adapter.claimLatestPairEvidence({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-1",
      leaseDurationMs: 60000,
      nowUnixMs: 1000
    });

    const ok = await adapter.complete({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-1",
      targetReceiptId: id1,
      nowUnixMs: 2000,
      outcome: "permanent_failure",
      errorCode: "INVALID_SYNTHESIS_INPUT",
      errorMessage: "Unparseable bundle contents"
    });
    expect(ok).toBe(true);

    const rows = await db.execute(sql`
      SELECT * FROM regime_engine.policy_insight_synthesis_cursor
      WHERE cursor_key = ${TEST_CURSOR_KEY}
    `);
    const row = rows[0] as unknown as {
      last_processed_receipt_id: number;
      target_receipt_id: number | null;
      lease_owner: string | null;
      last_outcome: string | null;
      last_error_code: string | null;
      last_error_message: string | null;
    };
    expect(Number(row.last_processed_receipt_id)).toBe(id1);
    expect(row.target_receipt_id).toBeNull();
    expect(row.lease_owner).toBeNull();
    expect(row.last_outcome).toBe("permanent_failure");
    expect(row.last_error_code).toBe("INVALID_SYNTHESIS_INPUT");
    expect(row.last_error_message).toBe("Unparseable bundle contents");
  });

  it("transient failure preserves the cursor and schedules retry", async () => {
    const id1 = await insertBundle();

    await adapter.claimLatestPairEvidence({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-1",
      leaseDurationMs: 60000,
      nowUnixMs: 1000
    });
    await adapter.complete({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-1",
      targetReceiptId: id1,
      nowUnixMs: 1500,
      outcome: "success"
    });

    const id2 = await insertBundle();

    await adapter.claimLatestPairEvidence({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-1",
      leaseDurationMs: 60000,
      nowUnixMs: 2000
    });

    const retryOk = await adapter.releaseForRetry({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-1",
      targetReceiptId: id2,
      nowUnixMs: 2500,
      classification: "DB_CONNECTION_TIMEOUT",
      sanitizedMessage: "Database timeout after 5000ms",
      retryAtUnixMs: 10000
    });
    expect(retryOk).toBe(true);

    const rows = await db.execute(sql`
      SELECT * FROM regime_engine.policy_insight_synthesis_cursor
      WHERE cursor_key = ${TEST_CURSOR_KEY}
    `);
    const row = rows[0] as unknown as {
      last_processed_receipt_id: number;
      target_receipt_id: number | null;
      lease_owner: string | null;
      next_attempt_at_unix_ms: number | null;
      last_outcome: string | null;
      last_error_code: string | null;
      last_error_message: string | null;
    };
    expect(Number(row.last_processed_receipt_id)).toBe(id1);
    expect(Number(row.target_receipt_id)).toBe(id2);
    expect(row.lease_owner).toBeNull();
    expect(Number(row.next_attempt_at_unix_ms)).toBe(10000);
    expect(row.last_outcome).toBe("transient_failure");
    expect(row.last_error_code).toBe("DB_CONNECTION_TIMEOUT");
    expect(row.last_error_message).toBe("Database timeout after 5000ms");

    const claimEarly = await adapter.claimLatestPairEvidence({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-2",
      leaseDurationMs: 60000,
      nowUnixMs: 5000
    });
    expect(claimEarly).toBeNull();

    const claimLate = await adapter.claimLatestPairEvidence({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-2",
      leaseDurationMs: 60000,
      nowUnixMs: 11000
    });
    expect(claimLate).not.toBeNull();
    expect(claimLate?.targetReceiptId).toBe(id2);
    expect(claimLate?.lastProcessedReceiptId).toBe(id1);
    expect(claimLate?.leaseOwner).toBe("worker-2");
    expect(claimLate?.attemptCount).toBe(2);
  });

  it("claims evidence for custom pair and scopeKey when specified", async () => {
    const id1 = await insertBundle({ pair: "ETH/USDC", scopeKey: "pair" });

    const claimDefault = await adapter.claimLatestPairEvidence({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-1",
      leaseDurationMs: 60000,
      nowUnixMs: 1000,
      pair: "SOL/USDC"
    });
    expect(claimDefault).toBeNull();

    const claimCustom = await adapter.claimLatestPairEvidence({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-1",
      leaseDurationMs: 60000,
      nowUnixMs: 1000,
      pair: "ETH/USDC",
      scopeKey: "pair"
    });
    expect(claimCustom).not.toBeNull();
    expect(claimCustom?.targetReceiptId).toBe(id1);
  });
});
