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
    insightId: overrides.insightId ?? "a".repeat(64),
    schemaVersion: "policy-insight.v1",
    rulesetVersion: "ruleset-1.0.0",
    pair: TEST_PAIR,
    scopeKey: overrides.scopeKey ?? "pair",
    positionId: null,
    generatedAtUnixMs,
    asOfUnixMs,
    expiresAtUnixMs,
    persistedAtUnixMs,
    marketHash: "b".repeat(64),
    positionHash: "c".repeat(64),
    selectionHash: "d".repeat(64),
    synthesisInputHash: overrides.synthesisInputHash ?? "e".repeat(64),
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

describe.skipIf(!process.env.DATABASE_URL)("postgresPolicyInsightRepository.history", () => {
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

  it("empty history returns empty list and null cursor", async () => {
    const result = await repository.getHistory({
      pair: TEST_PAIR,
      scopeKey: "pair",
      limit: 10,
      cursor: null
    });
    expect(result.records).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });

  it("invalid limits are rejected", async () => {
    await expect(
      repository.getHistory({
        pair: TEST_PAIR,
        scopeKey: "pair",
        limit: 0,
        cursor: null
      })
    ).rejects.toThrow();

    await expect(
      repository.getHistory({
        pair: TEST_PAIR,
        scopeKey: "pair",
        limit: 101,
        cursor: null
      })
    ).rejects.toThrow();
  });

  it("exact scope filtering works", async () => {
    const recPair = createTestRecord({
      insightId: "1".repeat(64),
      synthesisInputHash: "1".repeat(64),
      scopeKey: "pair"
    });
    const recPosition = createTestRecord({
      insightId: "2".repeat(64),
      synthesisInputHash: "2".repeat(64),
      scopeKey: "position-1"
    });

    await repository.insertOrGet(recPair);
    await repository.insertOrGet(recPosition);

    const pairHistory = await repository.getHistory({
      pair: TEST_PAIR,
      scopeKey: "pair",
      limit: 10,
      cursor: null
    });

    expect(pairHistory.records).toHaveLength(1);
    expect(pairHistory.records[0].insightId).toBe(recPair.insightId);
  });

  it("history pagination is stable across equal generation timestamps", async () => {
    const genTime = 1700000000000;
    const recA = createTestRecord({
      insightId: "1".repeat(64),
      synthesisInputHash: "1".repeat(64),
      generatedAtUnixMs: genTime
    });
    const recB = createTestRecord({
      insightId: "2".repeat(64),
      synthesisInputHash: "2".repeat(64),
      generatedAtUnixMs: genTime
    });
    const recC = createTestRecord({
      insightId: "3".repeat(64),
      synthesisInputHash: "3".repeat(64),
      generatedAtUnixMs: genTime
    });

    const resA = await repository.insertOrGet(recA);
    const resB = await repository.insertOrGet(recB);
    const resC = await repository.insertOrGet(recC);

    // Records are ordered by generatedAtUnixMs DESC, id DESC.
    // So the order should be: C (last inserted, highest id), B, A.

    const page1 = await repository.getHistory({
      pair: TEST_PAIR,
      scopeKey: "pair",
      limit: 2,
      cursor: null
    });

    expect(page1.records).toHaveLength(2);
    expect(page1.records[0].id).toBe(resC.record.id);
    expect(page1.records[1].id).toBe(resB.record.id);
    expect(page1.nextCursor).toEqual({
      generatedAtUnixMs: genTime,
      id: resB.record.id
    });

    const page2 = await repository.getHistory({
      pair: TEST_PAIR,
      scopeKey: "pair",
      limit: 2,
      cursor: page1.nextCursor
    });

    expect(page2.records).toHaveLength(1);
    expect(page2.records[0].id).toBe(resA.record.id);
    expect(page2.nextCursor).toBeNull();
  });

  it("history returns changed canonical inputs as distinct rows", async () => {
    const recA = createTestRecord({
      insightId: "1".repeat(64),
      synthesisInputHash: "1".repeat(64),
      generatedAtUnixMs: 1700000001000
    });
    const recB = createTestRecord({
      insightId: "2".repeat(64),
      synthesisInputHash: "2".repeat(64),
      generatedAtUnixMs: 1700000002000
    });

    const resA = await repository.insertOrGet(recA);
    const resB = await repository.insertOrGet(recB);

    const history = await repository.getHistory({
      pair: TEST_PAIR,
      scopeKey: "pair",
      limit: 10,
      cursor: null
    });

    expect(history.records).toHaveLength(2);
    expect(history.records[0].id).toBe(resB.record.id);
    expect(history.records[1].id).toBe(resA.record.id);
  });

  it("history never returns legacy externally authored rows", async () => {
    // Insert legacy clmm_insights row
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

    const history = await repository.getHistory({
      pair: TEST_PAIR,
      scopeKey: "pair",
      limit: 10,
      cursor: null
    });

    expect(history.records).toHaveLength(0);
  });
});
