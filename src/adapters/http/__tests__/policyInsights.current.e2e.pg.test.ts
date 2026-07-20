import { afterAll, afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../../app.js";
import type { Db } from "../../../ledger/pg/db.js";
import { createDb } from "../../../ledger/pg/db.js";
import { createPostgresPolicyInsightRepository } from "../../postgres/postgresPolicyInsightRepository.js";
import type { NewPolicyInsightRecord } from "../../../application/ports/policyInsightRepositoryPort.js";
import { sql } from "drizzle-orm";
import type { PolicySynthesisEnvelope } from "../../../engine/policy/synthesizePolicyInsight.js";
import { computePolicyInsightContentCanonicalAndHash } from "../../../contract/policyInsight/v1/canonical.js";
import type { PolicyInsightContent } from "../../../contract/policyInsight/v1/types.generated.js";

const PG_CONNECTION_STRING =
  process.env.DATABASE_URL ?? "postgres://test:test@localhost:5432/regime_engine_test";

const POLICY_INSIGHT_V1_WIRE_CONTRACT_SHA256 =
  "80487b0a9374d0b535accf535ef9819f2b2de00e1d65980deb73c97afaa02800";

const testSynthesisInput = {
  synthesisAtUnixMs: 1700000000000,
  pair: "SOL/USDC" as const,
  scope: { kind: "pair" as const },
  market: {
    regime: "CHOP" as const,
    telemetry: {
      realizedVolShort: 0.1,
      realizedVolLong: 0.1,
      volRatio: 1.0,
      trendStrength: 0,
      compression: 0
    },
    suitability: { status: "ALLOWED" as const, reasons: [] },
    freshness: {
      generatedAtIso: "2026-04-29T12:00:00Z",
      lastCandleOpenUnixMs: 1700000000000,
      lastCandleOpenIso: "2026-04-29T12:00:00Z",
      lastCandleCloseUnixMs: 1700000000000,
      lastCandleCloseIso: "2026-04-29T12:00:00Z",
      ageSeconds: 0,
      softStale: false,
      hardStale: false,
      softStaleSeconds: 300,
      hardStaleSeconds: 600
    },
    candleCount: 1,
    sourceCandleCount: 1,
    sourceTimeframe: "15m" as const
  },
  positionPlan: null,
  evidence: {
    selected: {
      deterministicFeatures: [],
      contextualEvidence: {
        supportResistance: [],
        flows: [],
        derivatives: [],
        events: [],
        newsRegulatory: []
      }
    },
    conflicts: [],
    warnings: [],
    sourceReferences: []
  },
  hashes: {
    inputHash: "e".repeat(64),
    rulesetHash: "f".repeat(64)
  }
};

const testOutput: PolicyInsightContent = {
  schemaVersion: "policy-insight.v1",
  insightId: "a".repeat(64),
  rulesetVersion: "ruleset-1.0.0",
  pair: "SOL/USDC",
  position: null,
  generatedAt: "2026-04-29T12:00:00.000Z",
  asOf: "2026-04-29T11:59:59.000Z", // strictly before generatedAt
  expiresAt: "2026-04-30T12:00:00.000Z",
  marketRegime: "CHOP",
  fundamentalRegime: "NEUTRAL",
  posture: "NEUTRAL",
  recommendedAction: "HOLD",
  riskLevel: "NORMAL",
  clmmPolicy: {
    rangeBias: "MEDIUM",
    rebalanceSensitivity: "NORMAL",
    maxCapitalDeploymentBps: 8000
  },
  levels: {
    supportsUsdcPerSol: ["140.5", "141"],
    resistancesUsdcPerSol: ["180.25", "181"]
  },
  evidence: {
    selectionStatus: "FULL",
    selectionPolicyVersion: "selector.v1.2026-07",
    selectedBundleRefs: [],
    selectedSourceRefs: []
  },
  confidenceBps: 7500,
  dataQuality: "COMPLETE",
  reasonCodes: ["MARKET_REGIME_CHOP"],
  reasoning: "Market ranging",
  warnings: []
};

const createTestRecord = (
  overrides: Partial<NewPolicyInsightRecord> = {}
): NewPolicyInsightRecord => {
  const generatedAtUnixMs = overrides.generatedAtUnixMs ?? 1700000000000;
  const asOfUnixMs = overrides.asOfUnixMs ?? generatedAtUnixMs - 1000;
  const persistedAtUnixMs = overrides.persistedAtUnixMs ?? generatedAtUnixMs + 1000;
  const expiresAtUnixMs = overrides.expiresAtUnixMs ?? generatedAtUnixMs + 5000;

  const output: PolicyInsightContent = overrides.synthesisOutputJson ?? {
    ...testOutput,
    insightId: overrides.insightId ?? "a".repeat(64)
  };
  const { canonical, hash } = computePolicyInsightContentCanonicalAndHash(output);

  return {
    insightId: overrides.insightId ?? "a".repeat(64),
    schemaVersion: "policy-insight.v1",
    rulesetVersion: "ruleset-1.0.0",
    pair: "SOL/USDC",
    scopeKey: overrides.scopeKey ?? "pair",
    positionId: overrides.positionId ?? null,
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
    synthesisInputJson: testSynthesisInput as unknown as PolicySynthesisEnvelope,
    synthesisOutputJson: output,
    payloadCanonical: canonical,
    payloadHash: hash,
    selectedLineageJson: [],
    excludedLineageJson: [],
    ...overrides
  };
};

let db: Db;
let pgClient: { end: () => Promise<void> };
let repository: ReturnType<typeof createPostgresPolicyInsightRepository>;

if (process.env.DATABASE_URL) {
  const result = createDb(PG_CONNECTION_STRING);
  db = result.db;
  pgClient = result.client;
  repository = createPostgresPolicyInsightRepository(db);
}

const setupPg = describe.skipIf(!process.env.DATABASE_URL);

afterAll(async () => {
  if (pgClient) {
    await pgClient.end();
  }
});

afterEach(async () => {
  delete process.env.LEDGER_DB_PATH;
  delete process.env.DATABASE_URL;
  if (db) {
    await db.execute(sql`DELETE FROM regime_engine.policy_insights`);
  }
});

setupPg("GET /v1/insights/sol-usdc/current (PG Canonical Policy)", () => {
  it("current endpoint returns only the newest canonical policy insight", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.DATABASE_URL = PG_CONNECTION_STRING;
    process.env.PG_SSL = "false";
    const app = buildApp();

    const record1 = createTestRecord({
      insightId: "1".repeat(64),
      synthesisInputHash: "1".repeat(64),
      generatedAtUnixMs: 1700000000000
    });
    const record2 = createTestRecord({
      insightId: "2".repeat(64),
      synthesisInputHash: "2".repeat(64),
      generatedAtUnixMs: 1700000005000
    });

    await repository.insertOrGet(record1);
    await repository.insertOrGet(record2);

    const res = await app.inject({
      method: "GET",
      url: "/v1/insights/sol-usdc/current"
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.insightId).toBe(record2.insightId);

    await app.close();
  });

  it("current endpoint distinguishes not found store unavailable validation and internal errors", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.DATABASE_URL = PG_CONNECTION_STRING;
    process.env.PG_SSL = "false";

    // 1. Validation error (invalid query parameter)
    {
      const app = buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/v1/insights/sol-usdc/current?scope=position&invalidParam=123"
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
      await app.close();
    }

    // 2. Not Found error
    {
      const app = buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/v1/insights/sol-usdc/current"
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("INSIGHT_NOT_FOUND");
      await app.close();
    }

    // 3. Store Unavailable error (no DATABASE_URL configured)
    {
      delete process.env.DATABASE_URL;
      const app = buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/v1/insights/sol-usdc/current"
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe("SERVICE_UNAVAILABLE");
      await app.close();
    }
  });

  it("handles pair/position scope queries correctly", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.DATABASE_URL = PG_CONNECTION_STRING;
    process.env.PG_SSL = "false";
    const app = buildApp();

    const recordPair = createTestRecord({
      insightId: "3".repeat(64),
      synthesisInputHash: "3".repeat(64),
      scopeKey: "pair"
    });

    const LENGTH_PREFIX = (s: string): string => `${s.length}:${s}`;
    const scopeKeyPos =
      "position:" + LENGTH_PREFIX("wallet1") + LENGTH_PREFIX("pool1") + LENGTH_PREFIX("pos1");

    const recordPos = createTestRecord({
      insightId: "4".repeat(64),
      synthesisInputHash: "4".repeat(64),
      scopeKey: scopeKeyPos,
      positionId: "pos1"
    });

    await repository.insertOrGet(recordPair);
    await repository.insertOrGet(recordPos);

    // Query pair scope
    const resPair = await app.inject({
      method: "GET",
      url: "/v1/insights/sol-usdc/current?scope=pair"
    });
    expect(resPair.statusCode).toBe(200);
    expect(resPair.json().insightId).toBe(recordPair.insightId);

    // Query position scope
    const resPos = await app.inject({
      method: "GET",
      url: "/v1/insights/sol-usdc/current?scope=position&walletAddress=wallet1&whirlpoolAddress=pool1&positionId=pos1"
    });
    expect(resPos.statusCode).toBe(200);
    expect(resPos.json().insightId).toBe(recordPos.insightId);

    await app.close();
  });

  it("handles stable same-timestamp winner", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.DATABASE_URL = PG_CONNECTION_STRING;
    process.env.PG_SSL = "false";
    const app = buildApp();

    const record1 = createTestRecord({
      insightId: "5".repeat(64),
      synthesisInputHash: "5".repeat(64),
      generatedAtUnixMs: 1700000000000
    });
    const record2 = createTestRecord({
      insightId: "6".repeat(64),
      synthesisInputHash: "6".repeat(64),
      generatedAtUnixMs: 1700000000000
    });

    // Insertion order: record1, then record2. record2 will have a higher id
    await repository.insertOrGet(record1);
    await repository.insertOrGet(record2);

    const res = await app.inject({
      method: "GET",
      url: "/v1/insights/sol-usdc/current"
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().insightId).toBe(record2.insightId); // Winner by id descending

    await app.close();
  });
});
