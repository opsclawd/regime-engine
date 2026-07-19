import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../../../ledger/pg/db.js";
import { createPostgresPolicyInsightRepository } from "../postgresPolicyInsightRepository.js";
import {
  PolicyInsightStoreUnavailableError,
  PolicyInsightValidationError
} from "../../../application/errors/policyInsightErrors.js";
import { sql } from "drizzle-orm";
import type { NewPolicyInsightRecord } from "../../../application/ports/policyInsightRepositoryPort.js";
import { computeInsightCanonicalAndHash } from "../../../contract/v1/insights.js";
import type { InsightIngestRequest } from "../../../contract/v1/insights.js";
import { SCHEMA_VERSION } from "../../../contract/v1/types.js";
import type { PolicySynthesisEnvelope } from "../../../engine/policy/synthesizePolicyInsight.js";
import type { EvidenceSelectionDecision } from "../../../engine/evidence/selectEvidence.js";

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
  const base: NewPolicyInsightRecord = {
    insightId: "a".repeat(64),
    schemaVersion: "policy-insight.v1",
    rulesetVersion: "ruleset-1.0.0",
    pair: TEST_PAIR,
    scopeKey: "pair",
    positionId: null,
    generatedAtUnixMs: 1700000000000,
    asOfUnixMs: 1700000000000,
    expiresAtUnixMs: 1700000005000,
    persistedAtUnixMs: 1700000001000,
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

describe.skipIf(!process.env.DATABASE_URL)("postgresPolicyInsightRepository.command", () => {
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
  });

  it("findBySynthesisInputHash miss/hit", async () => {
    const record = createTestRecord({ synthesisInputHash: "1".repeat(64) });
    const miss = await repository.findBySynthesisInputHash({
      schemaVersion: record.schemaVersion,
      rulesetVersion: record.rulesetVersion,
      synthesisInputHash: record.synthesisInputHash
    });
    expect(miss).toBeNull();

    await repository.insertOrGet(record);

    const hit = await repository.findBySynthesisInputHash({
      schemaVersion: record.schemaVersion,
      rulesetVersion: record.rulesetVersion,
      synthesisInputHash: record.synthesisInputHash
    });
    expect(hit).not.toBeNull();
    expect(hit!.insightId).toBe(record.insightId);
    expect(hit!.payloadCanonical).toBe(record.payloadCanonical);
  });

  it("identical canonical inputs produce one stored insight", async () => {
    const record = createTestRecord({ synthesisInputHash: "2".repeat(64) });

    const first = await repository.insertOrGet(record);
    expect(first.status).toBe("created");
    expect(first.record.id).toBeGreaterThan(0);

    const second = await repository.insertOrGet(record);
    expect(second.status).toBe("already_exists");
    expect(second.record.id).toBe(first.record.id);

    const rows = await db.execute(sql`
      SELECT id FROM regime_engine.policy_insights
      WHERE synthesis_input_hash = ${record.synthesisInputHash}
    `);
    expect(rows).toHaveLength(1);
  });

  it("concurrent identical inserts return the persisted winner", async () => {
    const record = createTestRecord({ synthesisInputHash: "3".repeat(64) });

    const results = await Promise.all([
      repository.insertOrGet(record),
      repository.insertOrGet(record)
    ]);

    const statuses = results.map((r) => r.status);
    expect(statuses).toContain("created");
    expect(statuses).toContain("already_exists");

    const created = results.find((r) => r.status === "created")!;
    const alreadyExists = results.find((r) => r.status === "already_exists")!;
    expect(alreadyExists.record.id).toBe(created.record.id);
  });

  it("changed-input insertion returns the winner but does not update", async () => {
    const record = createTestRecord({ synthesisInputHash: "4".repeat(64) });
    const first = await repository.insertOrGet(record);

    const changedRecord = {
      ...record,
      insightId: "1".repeat(64)
    };

    const second = await repository.insertOrGet(changedRecord);
    expect(second.status).toBe("already_exists");
    expect(second.record.id).toBe(first.record.id);
    expect(second.record.insightId).toBe(record.insightId);
  });

  it("canonical JSON round-trip for output, input, and lineage", async () => {
    const record = createTestRecord({
      synthesisInputHash: "5".repeat(64),
      synthesisInputJson: {
        ...testSynthesisInput,
        market: { regime: "UP", note: "nested" }
      } as unknown as PolicySynthesisEnvelope
    });

    const result = await repository.insertOrGet(record);
    expect(result.record.synthesisOutputJson).toEqual(testOutput);
    expect(result.record.synthesisInputJson).toEqual(record.synthesisInputJson);
    expect(result.record.selectedLineageJson).toEqual([includedDecision]);
    expect(result.record.excludedLineageJson).toEqual([excludedDecision]);

    const hit = await repository.findBySynthesisInputHash({
      schemaVersion: record.schemaVersion,
      rulesetVersion: record.rulesetVersion,
      synthesisInputHash: record.synthesisInputHash
    });
    expect(hit!.synthesisOutputJson).toEqual(testOutput);
    expect(hit!.selectedLineageJson).toEqual([includedDecision]);
    expect(hit!.excludedLineageJson).toEqual([excludedDecision]);
  });

  it("append-only behavior: throws error when conflict fires but no winner can be read", async () => {
    const stubDb = {
      insert: () => ({
        values: () => ({
          onConflictDoNothing: () => ({
            returning: async () => []
          })
        })
      }),
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => []
          })
        })
      }),
      transaction: async (callback: (tx: Db) => Promise<unknown>) => {
        return callback(stubDb);
      }
    } as unknown as Db;

    const stubRepository = createPostgresPolicyInsightRepository(stubDb);

    await expect(stubRepository.insertOrGet(createTestRecord())).rejects.toThrow(
      "Append-only invariant violated"
    );
  });
});

describe("postgresPolicyInsightRepository payload and lineage validation", () => {
  it("rejects a synthesisOutputJson that fails InsightIngestRequest validation", async () => {
    const repository = createPostgresPolicyInsightRepository({} as unknown as Db);
    const record = createTestRecord({
      synthesisOutputJson: {
        ...testOutput,
        recommendedAction: "not_a_real_action"
      } as unknown as InsightIngestRequest
    });

    await expect(repository.insertOrGet(record)).rejects.toThrow(PolicyInsightValidationError);
  });

  it("rejects a payloadCanonical/payloadHash that does not match synthesisOutputJson", async () => {
    const repository = createPostgresPolicyInsightRepository({} as unknown as Db);
    const record = createTestRecord({ payloadHash: "f".repeat(64) });

    await expect(repository.insertOrGet(record)).rejects.toThrow(PolicyInsightValidationError);
  });

  it("rejects a malformed synthesisInputJson envelope", async () => {
    const repository = createPostgresPolicyInsightRepository({} as unknown as Db);
    const record = createTestRecord({
      synthesisInputJson: { not: "an envelope" } as unknown as PolicySynthesisEnvelope
    });

    await expect(repository.insertOrGet(record)).rejects.toThrow(PolicyInsightValidationError);
  });

  it("rejects selectedLineageJson containing an EXCLUDED decision", async () => {
    const repository = createPostgresPolicyInsightRepository({} as unknown as Db);
    const record = createTestRecord({ selectedLineageJson: [excludedDecision] });

    await expect(repository.insertOrGet(record)).rejects.toThrow(PolicyInsightValidationError);
  });

  it("rejects excludedLineageJson containing an INCLUDED decision", async () => {
    const repository = createPostgresPolicyInsightRepository({} as unknown as Db);
    const record = createTestRecord({ excludedLineageJson: [includedDecision] });

    await expect(repository.insertOrGet(record)).rejects.toThrow(PolicyInsightValidationError);
  });
});

describe("postgresPolicyInsightRepository transient failure handling", () => {
  const makeTransientDbError = (code: string, message = "connection refused") => {
    const err = new Error(message);
    (err as unknown as { code: string }).code = code;
    return err;
  };

  const transientCodes = [
    "ECONNREFUSED",
    "CONNECT_TIMEOUT",
    "CONNECTION_CLOSED",
    "CONNECTION_ENDED",
    "CONNECTION_DESTROYED",
    "08006",
    "08003"
  ];

  it.each(transientCodes)(
    "repository unavailability never returns an unstored insight for code %s",
    async (code) => {
      const transientDb = {
        insert: () => ({
          values: () => ({
            onConflictDoNothing: () => ({
              returning: async () => {
                throw makeTransientDbError(code);
              }
            })
          })
        }),
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => {
                throw makeTransientDbError(code);
              }
            })
          })
        }),
        transaction: async (callback: (tx: Db) => Promise<unknown>) => {
          return callback(transientDb);
        },
        execute: async () => {
          throw makeTransientDbError(code);
        }
      } as unknown as Db;

      const repository = createPostgresPolicyInsightRepository(transientDb);

      const record = createTestRecord();

      await expect(
        repository.findBySynthesisInputHash({
          schemaVersion: record.schemaVersion,
          rulesetVersion: record.rulesetVersion,
          synthesisInputHash: record.synthesisInputHash
        })
      ).rejects.toThrow(PolicyInsightStoreUnavailableError);

      await expect(repository.insertOrGet(record)).rejects.toThrow(
        PolicyInsightStoreUnavailableError
      );
    }
  );
});
