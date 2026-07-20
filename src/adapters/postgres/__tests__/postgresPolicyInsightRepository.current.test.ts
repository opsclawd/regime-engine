import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../../../ledger/pg/db.js";
import { createPostgresPolicyInsightRepository } from "../postgresPolicyInsightRepository.js";
import { sql } from "drizzle-orm";
import type { NewPolicyInsightRecord } from "../../../application/ports/policyInsightRepositoryPort.js";
import { computePolicyInsightContentCanonicalAndHash } from "../../../contract/policyInsight/v1/canonical.js";
import type { PolicyInsightContent } from "../../../contract/policyInsight/v1/types.generated.js";
import type { PolicySynthesisEnvelope } from "../../../engine/policy/synthesizePolicyInsight.js";
import type { EvidenceSelectionDecision } from "../../../engine/evidence/selectEvidence.js";
import { clmmInsights } from "../../../ledger/pg/schema/clmmInsights.js";
const POLICY_INSIGHT_V1_WIRE_CONTRACT_SHA256 =
  "80487b0a9374d0b535accf535ef9819f2b2de00e1d65980deb73c97afaa02800";

const TEST_PAIR = "SOL/USDC";

const testOutput: PolicyInsightContent = {
  schemaVersion: "policy-insight.v1",
  insightId: "a".repeat(64),
  rulesetVersion: "ruleset-1.0.0",
  pair: "SOL/USDC",
  position: null,
  generatedAt: "2024-01-01T00:00:00.000Z",
  asOf: "2023-12-31T23:59:59.000Z",
  expiresAt: "2024-01-01T00:05:00.000Z",
  marketRegime: "UP",
  fundamentalRegime: "NEUTRAL",
  posture: "NEUTRAL",
  recommendedAction: "HOLD",
  riskLevel: "NORMAL",
  clmmPolicy: {
    rangeBias: "MEDIUM",
    rebalanceSensitivity: "NORMAL",
    maxCapitalDeploymentBps: 7500
  },
  levels: {
    supportsUsdcPerSol: ["96", "95"],
    resistancesUsdcPerSol: ["110", "111"]
  },
  evidence: {
    selectionStatus: "FULL",
    selectionPolicyVersion: "selector.v1.2026-07",
    selectedBundleRefs: [],
    selectedSourceRefs: []
  },
  confidenceBps: 7500,
  dataQuality: "COMPLETE",
  reasonCodes: ["MARKET_REGIME_UP"],
  reasoning: "Market regime is UP.",
  warnings: []
};

const testSynthesisInput: PolicySynthesisEnvelope = {
  synthesisAtUnixMs: 1700000000000,
  pair: "SOL/USDC",
  scope: { kind: "pair" },
  market: { regime: "UP" },
  positionPlan: null,
  evidence: { mode: "FULL" },
  hashes: { inputHash: "a".repeat(64), rulesetHash: "b".repeat(64) }
} as unknown as PolicySynthesisEnvelope;

const includedDecision: EvidenceSelectionDecision = {
  candidateId: "bundle-1/deterministic_feature/feature-1",
  bundleHash: "c".repeat(64),
  publisher: "publisher-a",
  sourceId: "source-a",
  runId: "run-a",
  correlationId: "corr-a",
  receivedAtUnixMs: 1700000000000,
  kind: "deterministic_feature",
  localId: "feature-1",
  rawConfidence: 9000,
  sourceQuality: 9000,
  provenanceQuality: 9000,
  freshnessWeight: 10000,
  score: 8000,
  status: "INCLUDED",
  reasons: ["fresh_inclusion"]
};

const excludedDecision: EvidenceSelectionDecision = {
  ...includedDecision,
  candidateId: "bundle-1/deterministic_feature/feature-2",
  localId: "feature-2",
  score: null,
  status: "EXCLUDED",
  reasons: ["score_threshold"]
};

const { canonical: testPayloadCanonical, hash: testPayloadHash } =
  computePolicyInsightContentCanonicalAndHash(testOutput);

const createTestRecord = (
  overrides: Partial<NewPolicyInsightRecord> = {}
): NewPolicyInsightRecord => {
  const generatedAtUnixMs = overrides.generatedAtUnixMs ?? 1700000000000;
  const asOfUnixMs = overrides.asOfUnixMs ?? generatedAtUnixMs - 1000;
  const persistedAtUnixMs = overrides.persistedAtUnixMs ?? generatedAtUnixMs + 1000;
  const expiresAtUnixMs = overrides.expiresAtUnixMs ?? generatedAtUnixMs + 5000;

  const base: NewPolicyInsightRecord = {
    insightId: "a".repeat(64),
    schemaVersion: "policy-insight.v1",
    rulesetVersion: "ruleset-1.0.0",
    pair: TEST_PAIR,
    scopeKey: "pair",
    positionId: null,
    generatedAtUnixMs,
    asOfUnixMs,
    expiresAtUnixMs,
    persistedAtUnixMs,
    marketHash: "b".repeat(64),
    positionHash: "c".repeat(64),
    selectionHash: "d".repeat(64),
    synthesisInputHash: "e".repeat(64),
    wireContractSha256: POLICY_INSIGHT_V1_WIRE_CONTRACT_SHA256,
    selectionPolicyVersion: "policy-v1",
    synthesisInputJson: testSynthesisInput,
    synthesisOutputJson: testOutput,
    payloadCanonical: testPayloadCanonical,
    payloadHash: testPayloadHash,
    selectedLineageJson: [includedDecision],
    excludedLineageJson: [excludedDecision]
  };
  return { ...base, ...overrides };
};

describe.skipIf(!process.env.DATABASE_URL)("postgresPolicyInsightRepository.current", () => {
  let db: Db;
  let repository: ReturnType<typeof createPostgresPolicyInsightRepository>;

  beforeAll(() => {
    const result = createDb(process.env.DATABASE_URL!);
    db = result.db;
    repository = createPostgresPolicyInsightRepository(db);
  });

  afterEach(async () => {
    await db.execute(sql`
      DELETE FROM regime_engine.policy_insights
      WHERE pair = ${TEST_PAIR}
    `);
    await db.delete(clmmInsights).where(sql`pair = ${TEST_PAIR}`);
  });

  it("current returns null on no row", async () => {
    const result = await repository.getCurrent({
      pair: TEST_PAIR,
      scopeKey: "pair",
      wireContractSha256: POLICY_INSIGHT_V1_WIRE_CONTRACT_SHA256
    });
    expect(result).toBeNull();
  });

  it("current returns newest canonical row by generated time then row id", async () => {
    // Create record A (earlier generatedAtUnixMs)
    const recA = createTestRecord({
      insightId: "1".repeat(64),
      synthesisInputHash: "1".repeat(64),
      scopeKey: "pair",
      generatedAtUnixMs: 1700000001000
    });
    await repository.insertOrGet(recA);

    // Create record B (later generatedAtUnixMs)
    const recB = createTestRecord({
      insightId: "2".repeat(64),
      synthesisInputHash: "2".repeat(64),
      scopeKey: "pair",
      generatedAtUnixMs: 1700000002000
    });
    await repository.insertOrGet(recB);

    // Create record C (same generatedAtUnixMs as B, but inserted later so higher row id)
    const recC = createTestRecord({
      insightId: "3".repeat(64),
      synthesisInputHash: "3".repeat(64),
      scopeKey: "pair",
      generatedAtUnixMs: 1700000002000
    });
    const resC = await repository.insertOrGet(recC);

    const current = await repository.getCurrent({
      pair: TEST_PAIR,
      scopeKey: "pair",
      wireContractSha256: POLICY_INSIGHT_V1_WIRE_CONTRACT_SHA256
    });

    expect(current).not.toBeNull();
    expect(current!.insightId).toBe(recC.insightId);
    expect(current!.id).toBe(resC.record.id);
  });

  it("current never reads legacy clmm_insights", async () => {
    // Insert into legacy clmm_insights
    await db.insert(clmmInsights).values({
      schemaVersion: "clmm-insight.v1",
      pair: TEST_PAIR,
      asOfUnixMs: 1700000000000,
      source: "openclaw",
      runId: "legacy-run",
      marketRegime: "up",
      fundamentalRegime: "unknown",
      recommendedAction: "watch",
      confidence: "medium",
      riskLevel: "normal",
      dataQuality: "complete",
      clmmPolicyJson: {},
      levelsJson: {},
      reasoningJson: [],
      sourceRefsJson: [],
      payloadCanonical: "legacy-canonical-payload",
      payloadHash: "a".repeat(64),
      expiresAtUnixMs: 1700000005000,
      receivedAtUnixMs: 1700000001000
    });

    // Verify getCurrent returns null if no rows in policy_insights
    const result = await repository.getCurrent({
      pair: TEST_PAIR,
      scopeKey: "pair",
      wireContractSha256: POLICY_INSIGHT_V1_WIRE_CONTRACT_SHA256
    });
    expect(result).toBeNull();
  });

  it("never returns an unmarked legacy row from current or history", async () => {
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
             'policy-insight.v1', 'ruleset.v1', 'SOL/USDC', 'pair', 'position-id',
             1700000000000, 1690000000000, 1800000000000, 1710000000000,
             '0000000000000000000000000000000000000000000000000000000000000002',
             '0000000000000000000000000000000000000000000000000000000000000003',
             '0000000000000000000000000000000000000000000000000000000000000004',
             '0000000000000000000000000000000000000000000000000000000000000005',
             'policy-v1', '{}', '{}', 'canonical payload',
             '0000000000000000000000000000000000000000000000000000000000000006',
             '[]', '[]', NULL)`
    );

    const result = await repository.getCurrent({
      pair: TEST_PAIR,
      scopeKey: "pair",
      wireContractSha256: POLICY_INSIGHT_V1_WIRE_CONTRACT_SHA256
    });
    expect(result).toBeNull();
  });

  it("current read is side-effect free", async () => {
    const record = createTestRecord({
      insightId: "4".repeat(64),
      synthesisInputHash: "4".repeat(64),
      scopeKey: "pair"
    });
    await repository.insertOrGet(record);

    // Count rows before read
    const beforeCountResult = await db.execute(sql`
      SELECT COUNT(*)::int as count FROM regime_engine.policy_insights WHERE pair = ${TEST_PAIR}
    `);
    const countBefore = beforeCountResult[0].count;

    // Read current
    const current = await repository.getCurrent({
      pair: TEST_PAIR,
      scopeKey: "pair",
      wireContractSha256: POLICY_INSIGHT_V1_WIRE_CONTRACT_SHA256
    });
    expect(current).not.toBeNull();

    // Count rows after read
    const afterCountResult = await db.execute(sql`
      SELECT COUNT(*)::int as count FROM regime_engine.policy_insights WHERE pair = ${TEST_PAIR}
    `);
    const countAfter = afterCountResult[0].count;

    expect(countBefore).toBe(countAfter);
  });
});
