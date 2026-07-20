import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../../../ledger/pg/db.js";
import { createPostgresPolicyInsightRepository } from "../postgresPolicyInsightRepository.js";
import {
  PolicyInsightStoreUnavailableError,
  PolicyInsightValidationError
} from "../../../application/errors/policyInsightErrors.js";
import { sql } from "drizzle-orm";
import type { NewPolicyInsightRecord } from "../../../application/ports/policyInsightRepositoryPort.js";
import { computePolicyInsightContentCanonicalAndHash } from "../../../contract/policyInsight/v1/canonical.js";
import type { PolicyInsightContent } from "../../../contract/policyInsight/v1/types.generated.js";
import type { PolicySynthesisEnvelope } from "../../../engine/policy/synthesizePolicyInsight.js";
import type { EvidenceSelectionDecision } from "../../../engine/evidence/selectEvidence.js";
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
  const base: NewPolicyInsightRecord = {
    insightId: "a".repeat(64),
    schemaVersion: "policy-insight.v1",
    rulesetVersion: "ruleset-1.0.0",
    pair: TEST_PAIR,
    scopeKey: "pair",
    positionId: null,
    generatedAtUnixMs: 1700000000000,
    asOfUnixMs: 1699999999000,
    expiresAtUnixMs: 1700000005000,
    persistedAtUnixMs: 1700000001000,
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
      wireContractSha256: record.wireContractSha256,
      rulesetVersion: record.rulesetVersion,
      synthesisInputHash: record.synthesisInputHash
    });
    expect(miss).toBeNull();

    await repository.insertOrGet(record);

    const hit = await repository.findBySynthesisInputHash({
      schemaVersion: record.schemaVersion,
      wireContractSha256: record.wireContractSha256,
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
      wireContractSha256: record.wireContractSha256,
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
  it("rejects a synthesisOutputJson that fails PolicyInsightContent validation", async () => {
    const repository = createPostgresPolicyInsightRepository({} as unknown as Db);
    const record = createTestRecord({
      synthesisOutputJson: {
        ...testOutput,
        recommendedAction: "INVALID_ACTION"
      } as unknown as PolicyInsightContent
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
              orderBy: () => ({
                limit: async () => {
                  throw makeTransientDbError(code);
                }
              }),
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
          wireContractSha256: record.wireContractSha256,
          rulesetVersion: record.rulesetVersion,
          synthesisInputHash: record.synthesisInputHash
        })
      ).rejects.toThrow(PolicyInsightStoreUnavailableError);

      await expect(repository.insertOrGet(record)).rejects.toThrow(
        PolicyInsightStoreUnavailableError
      );

      await expect(
        repository.getCurrent({
          pair: TEST_PAIR,
          scopeKey: "pair",
          wireContractSha256: POLICY_INSIGHT_V1_WIRE_CONTRACT_SHA256
        })
      ).rejects.toThrow(PolicyInsightStoreUnavailableError);

      await expect(
        repository.getHistory({
          pair: TEST_PAIR,
          scopeKey: "pair",
          limit: 10,
          cursor: null,
          wireContractSha256: POLICY_INSIGHT_V1_WIRE_CONTRACT_SHA256
        })
      ).rejects.toThrow(PolicyInsightStoreUnavailableError);
    }
  );
});
