import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../../../ledger/pg/db.js";
import { createPostgresPolicyInsightRepository } from "../postgresPolicyInsightRepository.js";
import { sql } from "drizzle-orm";
import type { NewPolicyInsightRecord } from "../../../application/ports/policyInsightRepositoryPort.js";
import { computeInsightCanonicalAndHash } from "../../../contract/v1/insights.js";
import type { InsightIngestRequest } from "../../../contract/v1/insights.js";
import { SCHEMA_VERSION } from "../../../contract/v1/types.js";
import type { PolicySynthesisEnvelope } from "../../../engine/policy/synthesizePolicyInsight.js";
import type { EvidenceSelectionDecision } from "../../../engine/evidence/selectEvidence.js";
import { clmmInsights } from "../../../ledger/pg/schema/clmmInsights.js";

const TEST_PAIR = "SOL/USDC";

const testOutput: InsightIngestRequest = {
  schemaVersion: SCHEMA_VERSION,
  pair: "SOL/USDC",
  asOf: "2024-01-01T00:00:00.000Z",
  source: "openclaw",
  runId: "synthesis-sol-usdc-1700000000000",
  marketRegime: "up",
  fundamentalRegime: "unknown",
  recommendedAction: "watch",
  confidence: "medium",
  riskLevel: "normal",
  dataQuality: "complete",
  clmmPolicy: {
    posture: "neutral",
    rangeBias: "medium",
    rebalanceSensitivity: "normal",
    maxCapitalDeploymentPercent: 75
  },
  levels: { support: [95], resistance: [110] },
  reasoning: ["MARKET_REGIME_UP"],
  sourceRefs: [],
  expiresAt: "2024-01-01T00:05:00.000Z"
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
  computeInsightCanonicalAndHash(testOutput);

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
      scopeKey: "pair"
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
      scopeKey: "pair"
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
      scopeKey: "pair"
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
      scopeKey: "pair"
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
