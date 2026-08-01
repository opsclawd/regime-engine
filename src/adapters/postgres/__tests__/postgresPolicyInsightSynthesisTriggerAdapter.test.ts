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
    await db.execute(sql`
      DELETE FROM regime_engine.sr_theses_v2
      WHERE source = ${TEST_PUBLISHER}
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

  async function insertSrThesis(
    opts: {
      symbol?: string;
      source?: string;
      briefId?: string;
    } = {}
  ): Promise<number> {
    const symbol = opts.symbol ?? "SOL/USDC";
    const source = opts.source ?? TEST_PUBLISHER;
    const briefId = opts.briefId ?? `brief-${Math.random().toString(36).substring(2, 9)}`;
    const sourceHandle = `handle-${Math.random().toString(36).substring(2, 9)}`;

    const result = await db.execute(sql`
      INSERT INTO regime_engine.sr_theses_v2 (
        schema_version,
        source,
        symbol,
        brief_id,
        captured_at_iso,
        captured_at_unix_ms,
        asset,
        timeframe,
        support_levels,
        resistance_levels,
        targets,
        source_handle,
        source_kind,
        payload_hash,
        received_at_unix_ms
      ) VALUES (
        'sr-thesis.v2',
        ${source},
        ${symbol},
        ${briefId},
        '2026-08-01T00:00:00Z',
        1000,
        'SOL',
        '1h',
        ARRAY['100'],
        ARRAY['200'],
        ARRAY['150'],
        ${sourceHandle},
        'test-kind',
        'a000000000000000000000000000000000000000000000000000000000000000',
        1000
      )
      RETURNING id
    `);
    return Number((result[0] as unknown as { id: number }).id);
  }

  it("claims when only evidence advances and snapshots both source maxima", async () => {
    const e1 = await insertBundle();
    const claim = await adapter.claimLatestPairEvidence({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-1",
      leaseDurationMs: 60000,
      nowUnixMs: 1000
    });

    expect(claim).toEqual({
      cursorKey: TEST_CURSOR_KEY,
      targetReceiptId: e1,
      targetSrThesesMaxId: 0,
      attemptCount: 1,
      leaseOwner: "worker-1",
      leaseExpiresAtUnixMs: 61000,
      lastProcessedReceiptId: 0,
      lastProcessedSrThesesMaxId: 0
    });
  });

  it("claims when only SR theses advance and snapshots both source maxima", async () => {
    const s1 = await insertSrThesis();
    const claim = await adapter.claimLatestPairEvidence({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-1",
      leaseDurationMs: 60000,
      nowUnixMs: 1000
    });

    expect(claim).toEqual({
      cursorKey: TEST_CURSOR_KEY,
      targetReceiptId: 0,
      targetSrThesesMaxId: s1,
      attemptCount: 1,
      leaseOwner: "worker-1",
      leaseExpiresAtUnixMs: 61000,
      lastProcessedReceiptId: 0,
      lastProcessedSrThesesMaxId: 0
    });
  });

  it("returns idle when neither source has advanced", async () => {
    const claim1 = await adapter.claimLatestPairEvidence({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-1",
      leaseDurationMs: 60000,
      nowUnixMs: 1000
    });
    expect(claim1).toBeNull();

    const e1 = await insertBundle();
    const s1 = await insertSrThesis();

    const claim2 = await adapter.claimLatestPairEvidence({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-1",
      leaseDurationMs: 60000,
      nowUnixMs: 1000
    });
    expect(claim2).not.toBeNull();

    await adapter.complete({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-1",
      targetReceiptId: e1,
      targetSrThesesMaxId: s1,
      nowUnixMs: 2000,
      outcome: "success"
    });

    const claim3 = await adapter.claimLatestPairEvidence({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-1",
      leaseDurationMs: 60000,
      nowUnixMs: 3000
    });
    expect(claim3).toBeNull();
  });

  it("coalesces simultaneous evidence and SR advances into one dual-pointer claim", async () => {
    await insertBundle();
    const e2 = await insertBundle();
    await insertSrThesis();
    const s2 = await insertSrThesis();

    const claim = await adapter.claimLatestPairEvidence({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-1",
      leaseDurationMs: 60000,
      nowUnixMs: 1000
    });

    expect(claim).toEqual({
      cursorKey: TEST_CURSOR_KEY,
      targetReceiptId: e2,
      targetSrThesesMaxId: s2,
      attemptCount: 1,
      leaseOwner: "worker-1",
      leaseExpiresAtUnixMs: 61000,
      lastProcessedReceiptId: 0,
      lastProcessedSrThesesMaxId: 0
    });
  });

  it("increments attempts only when reclaiming the same dual-pointer target", async () => {
    const e1 = await insertBundle();
    const s1 = await insertSrThesis();

    const claim1 = await adapter.claimLatestPairEvidence({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-1",
      leaseDurationMs: 5000,
      nowUnixMs: 1000
    });
    expect(claim1?.attemptCount).toBe(1);

    const claim2 = await adapter.claimLatestPairEvidence({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-2",
      leaseDurationMs: 5000,
      nowUnixMs: 7000
    });
    expect(claim2?.targetReceiptId).toBe(e1);
    expect(claim2?.targetSrThesesMaxId).toBe(s1);
    expect(claim2?.attemptCount).toBe(2);

    const e2 = await insertBundle();

    const claim3 = await adapter.claimLatestPairEvidence({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-3",
      leaseDurationMs: 5000,
      nowUnixMs: 13000
    });
    expect(claim3?.targetReceiptId).toBe(e2);
    expect(claim3?.targetSrThesesMaxId).toBe(s1);
    expect(claim3?.attemptCount).toBe(1);
  });

  it("completion requires the matching owner and both targets", async () => {
    const e1 = await insertBundle();
    const s1 = await insertSrThesis();

    await adapter.claimLatestPairEvidence({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-1",
      leaseDurationMs: 60000,
      nowUnixMs: 1000
    });

    const wrongOwnerResult = await adapter.complete({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-2",
      targetReceiptId: e1,
      targetSrThesesMaxId: s1,
      nowUnixMs: 2000,
      outcome: "success"
    });
    expect(wrongOwnerResult).toBe(false);

    const wrongEvidenceTargetResult = await adapter.complete({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-1",
      targetReceiptId: e1 + 999,
      targetSrThesesMaxId: s1,
      nowUnixMs: 2000,
      outcome: "success"
    });
    expect(wrongEvidenceTargetResult).toBe(false);

    const wrongSrTargetResult = await adapter.complete({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-1",
      targetReceiptId: e1,
      targetSrThesesMaxId: s1 + 999,
      nowUnixMs: 2000,
      outcome: "success"
    });
    expect(wrongSrTargetResult).toBe(false);

    const correctResult = await adapter.complete({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-1",
      targetReceiptId: e1,
      targetSrThesesMaxId: s1,
      nowUnixMs: 2000,
      outcome: "success"
    });
    expect(correctResult).toBe(true);
  });

  it("completion advances both pointers to the exact claimed targets", async () => {
    const e1 = await insertBundle();
    const s1 = await insertSrThesis();

    await adapter.claimLatestPairEvidence({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-1",
      leaseDurationMs: 60000,
      nowUnixMs: 1000
    });

    const ok = await adapter.complete({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-1",
      targetReceiptId: e1,
      targetSrThesesMaxId: s1,
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
      last_processed_sr_theses_max_id: number;
      target_receipt_id: number | null;
      target_sr_theses_max_id: number | null;
      lease_owner: string | null;
      attempt_count: number;
      next_attempt_at_unix_ms: number | null;
      last_outcome: string | null;
    };
    expect(Number(row.last_processed_receipt_id)).toBe(e1);
    expect(Number(row.last_processed_sr_theses_max_id)).toBe(s1);
    expect(row.target_receipt_id).toBeNull();
    expect(row.target_sr_theses_max_id).toBeNull();
    expect(row.lease_owner).toBeNull();
    expect(row.attempt_count).toBe(0);
    expect(row.next_attempt_at_unix_ms).toBeNull();
    expect(row.last_outcome).toBe("success");
  });

  it("transient release preserves both processed pointers and retries the same target pair", async () => {
    const e1 = await insertBundle();
    const s1 = await insertSrThesis();

    await adapter.claimLatestPairEvidence({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-1",
      leaseDurationMs: 60000,
      nowUnixMs: 1000
    });
    await adapter.complete({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-1",
      targetReceiptId: e1,
      targetSrThesesMaxId: s1,
      nowUnixMs: 1500,
      outcome: "success"
    });

    const e2 = await insertBundle();
    const s2 = await insertSrThesis();

    await adapter.claimLatestPairEvidence({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-1",
      leaseDurationMs: 60000,
      nowUnixMs: 2000
    });

    const retryOk = await adapter.releaseForRetry({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-1",
      targetReceiptId: e2,
      targetSrThesesMaxId: s2,
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
      last_processed_sr_theses_max_id: number;
      target_receipt_id: number | null;
      target_sr_theses_max_id: number | null;
      lease_owner: string | null;
      next_attempt_at_unix_ms: number | null;
      last_outcome: string | null;
      last_error_code: string | null;
      last_error_message: string | null;
    };
    expect(Number(row.last_processed_receipt_id)).toBe(e1);
    expect(Number(row.last_processed_sr_theses_max_id)).toBe(s1);
    expect(Number(row.target_receipt_id)).toBe(e2);
    expect(Number(row.target_sr_theses_max_id)).toBe(s2);
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
    expect(claimLate).toEqual({
      cursorKey: TEST_CURSOR_KEY,
      targetReceiptId: e2,
      targetSrThesesMaxId: s2,
      attemptCount: 2,
      leaseOwner: "worker-2",
      leaseExpiresAtUnixMs: 71000,
      lastProcessedReceiptId: e1,
      lastProcessedSrThesesMaxId: s1
    });
  });

  it("does not ping-pong after completing a single-source advance", async () => {
    const e1 = await insertBundle();
    const claim1 = await adapter.claimLatestPairEvidence({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-1",
      leaseDurationMs: 60000,
      nowUnixMs: 1000
    });
    expect(claim1?.targetReceiptId).toBe(e1);
    expect(claim1?.targetSrThesesMaxId).toBe(0);

    await adapter.complete({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-1",
      targetReceiptId: e1,
      targetSrThesesMaxId: 0,
      nowUnixMs: 1500,
      outcome: "success"
    });

    const poll1 = await adapter.claimLatestPairEvidence({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-1",
      leaseDurationMs: 60000,
      nowUnixMs: 2000
    });
    expect(poll1).toBeNull();

    const s1 = await insertSrThesis();
    const claim2 = await adapter.claimLatestPairEvidence({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-1",
      leaseDurationMs: 60000,
      nowUnixMs: 3000
    });
    expect(claim2?.targetReceiptId).toBe(e1);
    expect(claim2?.targetSrThesesMaxId).toBe(s1);

    await adapter.complete({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-1",
      targetReceiptId: e1,
      targetSrThesesMaxId: s1,
      nowUnixMs: 3500,
      outcome: "success"
    });

    const poll2 = await adapter.claimLatestPairEvidence({
      cursorKey: TEST_CURSOR_KEY,
      leaseOwner: "worker-1",
      leaseDurationMs: 60000,
      nowUnixMs: 4000
    });
    expect(poll2).toBeNull();
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
    expect(claim2?.targetSrThesesMaxId).toBe(0);
    expect(claim2?.leaseOwner).toBe("worker-2");
    expect(claim2?.attemptCount).toBe(2);
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
      targetSrThesesMaxId: 0,
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
      last_processed_sr_theses_max_id: number;
      target_receipt_id: number | null;
      target_sr_theses_max_id: number | null;
      lease_owner: string | null;
      last_outcome: string | null;
      last_error_code: string | null;
      last_error_message: string | null;
    };
    expect(Number(row.last_processed_receipt_id)).toBe(id1);
    expect(Number(row.last_processed_sr_theses_max_id)).toBe(0);
    expect(row.target_receipt_id).toBeNull();
    expect(row.target_sr_theses_max_id).toBeNull();
    expect(row.lease_owner).toBeNull();
    expect(row.last_outcome).toBe("permanent_failure");
    expect(row.last_error_code).toBe("INVALID_SYNTHESIS_INPUT");
    expect(row.last_error_message).toBe("Unparseable bundle contents");
  });

  it("claims evidence and sr theses for custom pair and scopeKey when specified", async () => {
    const s1 = await insertSrThesis({ symbol: "ETH/USDC" });

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
    expect(claimCustom).toEqual({
      cursorKey: TEST_CURSOR_KEY,
      targetReceiptId: 0,
      targetSrThesesMaxId: s1,
      attemptCount: 1,
      leaseOwner: "worker-1",
      leaseExpiresAtUnixMs: 61000,
      lastProcessedReceiptId: 0,
      lastProcessedSrThesesMaxId: 0
    });
  });
});
