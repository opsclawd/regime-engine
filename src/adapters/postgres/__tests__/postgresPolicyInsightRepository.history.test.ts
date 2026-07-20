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
      cursor: null,
      wireContractSha256: POLICY_INSIGHT_V1_WIRE_CONTRACT_SHA256
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
        cursor: null,
        wireContractSha256: POLICY_INSIGHT_V1_WIRE_CONTRACT_SHA256
      })
    ).rejects.toThrow();

    await expect(
      repository.getHistory({
        pair: TEST_PAIR,
        scopeKey: "pair",
        limit: 101,
        cursor: null,
        wireContractSha256: POLICY_INSIGHT_V1_WIRE_CONTRACT_SHA256
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
      cursor: null,
      wireContractSha256: POLICY_INSIGHT_V1_WIRE_CONTRACT_SHA256
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
      cursor: null,
      wireContractSha256: POLICY_INSIGHT_V1_WIRE_CONTRACT_SHA256
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
      cursor: page1.nextCursor,
      wireContractSha256: POLICY_INSIGHT_V1_WIRE_CONTRACT_SHA256
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
      cursor: null,
      wireContractSha256: POLICY_INSIGHT_V1_WIRE_CONTRACT_SHA256
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
      cursor: null,
      wireContractSha256: POLICY_INSIGHT_V1_WIRE_CONTRACT_SHA256
    });

    expect(history.records).toHaveLength(0);
  });

  it("cursor encode/decode round-trip", () => {
    const originalCursor = {
      generatedAtUnixMs: 1700000000000,
      id: 42
    };

    const encodeCursor = (cursor: typeof originalCursor): string => {
      const obj = {
        v: 1,
        generatedAtUnixMs: cursor.generatedAtUnixMs,
        id: cursor.id
      };
      return Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
    };

    const decodeCursor = (encoded: string): typeof originalCursor => {
      const json = Buffer.from(encoded, "base64url").toString("utf8");
      const obj = JSON.parse(json);
      if (obj.v !== 1 || typeof obj.generatedAtUnixMs !== "number" || typeof obj.id !== "number") {
        throw new Error("Invalid cursor");
      }
      return {
        generatedAtUnixMs: obj.generatedAtUnixMs,
        id: obj.id
      };
    };

    const encoded = encodeCursor(originalCursor);
    const decoded = decodeCursor(encoded);
    expect(decoded).toEqual(originalCursor);
  });

  it("canonical JSON round-trip", async () => {
    const record = createTestRecord({
      insightId: "3".repeat(64),
      synthesisInputHash: "3".repeat(64)
    });

    const res = await repository.insertOrGet(record);
    expect(res.status).toBe("created");

    const history = await repository.getHistory({
      pair: TEST_PAIR,
      scopeKey: "pair",
      limit: 1,
      cursor: null,
      wireContractSha256: POLICY_INSIGHT_V1_WIRE_CONTRACT_SHA256
    });

    expect(history.records).toHaveLength(1);
    const retrieved = history.records[0];

    expect(retrieved.synthesisOutputJson).toEqual(record.synthesisOutputJson);
    expect(retrieved.synthesisInputJson).toEqual(record.synthesisInputJson);
    expect(retrieved.payloadCanonical).toBe(record.payloadCanonical);
    expect(retrieved.payloadHash).toBe(record.payloadHash);
  });
});
