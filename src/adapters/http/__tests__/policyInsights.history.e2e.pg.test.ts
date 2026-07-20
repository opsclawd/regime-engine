import { afterAll, afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../../app.js";
import type { Db } from "../../../ledger/pg/db.js";
import { createDb } from "../../../ledger/pg/db.js";
import { clmmInsights } from "../../../ledger/pg/schema/index.js";
import { createPostgresPolicyInsightRepository } from "../../postgres/postgresPolicyInsightRepository.js";
import type { NewPolicyInsightRecord } from "../../../application/ports/policyInsightRepositoryPort.js";
import { sql } from "drizzle-orm";
import type { PolicySynthesisEnvelope } from "../../../engine/policy/synthesizePolicyInsight.js";
import { computeInsightCanonicalAndHash } from "../../../contract/v1/insights.js";

const PG_CONNECTION_STRING =
  process.env.DATABASE_URL ?? "postgres://test:test@localhost:5432/regime_engine_test";

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

const testOutput = {
  schemaVersion: "1.0" as const,
  pair: "SOL/USDC" as const,
  asOf: "2026-04-29T12:00:00Z",
  source: "openclaw" as const,
  runId: "run-001",
  marketRegime: "ranging",
  fundamentalRegime: "neutral",
  recommendedAction: "hold" as const,
  confidence: "medium" as const,
  riskLevel: "normal" as const,
  dataQuality: "complete" as const,
  clmmPolicy: {
    posture: "neutral" as const,
    rangeBias: "medium" as const,
    rebalanceSensitivity: "normal" as const,
    maxCapitalDeploymentPercent: 80
  },
  levels: { support: [140.5], resistance: [180.25] },
  reasoning: ["Market ranging"],
  sourceRefs: ["https://example.com"],
  expiresAt: "2026-04-30T12:00:00Z"
};

const createTestRecord = (
  overrides: Partial<NewPolicyInsightRecord> = {}
): NewPolicyInsightRecord => {
  const generatedAtUnixMs = overrides.generatedAtUnixMs ?? 1700000000000;
  const asOfUnixMs = overrides.asOfUnixMs ?? generatedAtUnixMs - 1000;
  const persistedAtUnixMs = overrides.persistedAtUnixMs ?? generatedAtUnixMs + 1000;
  const expiresAtUnixMs = overrides.expiresAtUnixMs ?? generatedAtUnixMs + 5000;

  const output = overrides.synthesisOutputJson ?? testOutput;
  const { canonical, hash } = computeInsightCanonicalAndHash(output);

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
    await db.execute(sql`DELETE FROM regime_engine.clmm_insights`);
  }
});

setupPg("GET /v1/insights/sol-usdc/history (PG Canonical Policy History)", () => {
  it("history endpoint returns canonical rows only", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.DATABASE_URL = PG_CONNECTION_STRING;
    process.env.PG_SSL = "false";
    const app = buildApp();

    // 1. Insert a legacy row in clmm_insights
    await db.insert(clmmInsights).values({
      schemaVersion: "1.0",
      pair: "SOL/USDC",
      asOfUnixMs: 1700000000000,
      source: "openclaw",
      runId: "legacy-run-123",
      marketRegime: "ranging",
      fundamentalRegime: "neutral",
      recommendedAction: "hold",
      confidence: "medium",
      riskLevel: "normal",
      dataQuality: "complete",
      clmmPolicyJson: {
        posture: "neutral",
        rangeBias: "medium",
        rebalanceSensitivity: "normal",
        maxCapitalDeploymentPercent: 80
      },
      levelsJson: { support: [100], resistance: [200] },
      reasoningJson: ["Legacy reasoning"],
      sourceRefsJson: [],
      expiresAtUnixMs: 1700000005000,
      payloadCanonical: "{}",
      payloadHash: "g".repeat(64),
      receivedAtUnixMs: 1700000001000
    });

    // 2. Insert a canonical row in policy_insights
    const record = createTestRecord({
      insightId: "1".repeat(64),
      synthesisInputHash: "1".repeat(64),
      generatedAtUnixMs: 1700000000000
    });
    await repository.insertOrGet(record);

    const res = await app.inject({
      method: "GET",
      url: "/v1/insights/sol-usdc/history"
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.length).toBe(1);
    expect(body.items[0].payloadHash).toBe(record.payloadHash);

    await app.close();
  });

  it("history endpoint uses the same tuple order as current", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.DATABASE_URL = PG_CONNECTION_STRING;
    process.env.PG_SSL = "false";
    const app = buildApp();

    const record1 = createTestRecord({
      insightId: "1".repeat(64),
      synthesisInputHash: "1".repeat(64),
      generatedAtUnixMs: 1700000000000,
      synthesisOutputJson: { ...testOutput, runId: "run-1" }
    });
    const record2 = createTestRecord({
      insightId: "2".repeat(64),
      synthesisInputHash: "2".repeat(64),
      generatedAtUnixMs: 1700000005000,
      synthesisOutputJson: { ...testOutput, runId: "run-2" }
    });
    const record3 = createTestRecord({
      insightId: "3".repeat(64),
      synthesisInputHash: "3".repeat(64),
      generatedAtUnixMs: 1700000005000, // tie-breaker by id/insert order
      synthesisOutputJson: { ...testOutput, runId: "run-3" }
    });

    await repository.insertOrGet(record1);
    await repository.insertOrGet(record2);
    await repository.insertOrGet(record3);

    const resHistory = await app.inject({
      method: "GET",
      url: "/v1/insights/sol-usdc/history"
    });
    expect(resHistory.statusCode).toBe(200);
    const historyBody = resHistory.json();
    expect(historyBody.items.length).toBe(3);
    // Order should be record3 (newest timestamp + highest id), record2 (newest timestamp + lower id), record1
    expect(historyBody.items[0].runId).toBe("run-3");
    expect(historyBody.items[1].runId).toBe("run-2");
    expect(historyBody.items[2].runId).toBe("run-1");

    const resCurrent = await app.inject({
      method: "GET",
      url: "/v1/insights/sol-usdc/current"
    });
    expect(resCurrent.statusCode).toBe(200);
    const currentBody = resCurrent.json();
    // Current should return the very first one from the history array (newest/winner)
    expect(currentBody.runId).toBe("run-3");

    await app.close();
  });

  it("history cursor returns no duplicates or gaps for equal timestamps", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.DATABASE_URL = PG_CONNECTION_STRING;
    process.env.PG_SSL = "false";
    const app = buildApp();

    const record1 = createTestRecord({
      insightId: "1".repeat(64),
      synthesisInputHash: "1".repeat(64),
      generatedAtUnixMs: 1700000000000,
      synthesisOutputJson: { ...testOutput, runId: "run-1" }
    });
    const record2 = createTestRecord({
      insightId: "2".repeat(64),
      synthesisInputHash: "2".repeat(64),
      generatedAtUnixMs: 1700000000000,
      synthesisOutputJson: { ...testOutput, runId: "run-2" }
    });
    const record3 = createTestRecord({
      insightId: "3".repeat(64),
      synthesisInputHash: "3".repeat(64),
      generatedAtUnixMs: 1700000000000,
      synthesisOutputJson: { ...testOutput, runId: "run-3" }
    });

    await repository.insertOrGet(record1);
    await repository.insertOrGet(record2);
    await repository.insertOrGet(record3);

    // Get page 1 (limit 1)
    const page1Res = await app.inject({
      method: "GET",
      url: "/v1/insights/sol-usdc/history?limit=1"
    });
    expect(page1Res.statusCode).toBe(200);
    const page1 = page1Res.json();
    expect(page1.items.length).toBe(1);
    expect(page1.items[0].runId).toBe("run-3");
    expect(page1.nextCursor).toBeDefined();

    // Get page 2 (limit 1) using cursor
    const page2Res = await app.inject({
      method: "GET",
      url: `/v1/insights/sol-usdc/history?limit=1&cursor=${page1.nextCursor}`
    });
    expect(page2Res.statusCode).toBe(200);
    const page2 = page2Res.json();
    expect(page2.items.length).toBe(1);
    expect(page2.items[0].runId).toBe("run-2");
    expect(page2.nextCursor).toBeDefined();

    // Get page 3 (limit 1) using cursor
    const page3Res = await app.inject({
      method: "GET",
      url: `/v1/insights/sol-usdc/history?limit=1&cursor=${page2.nextCursor}`
    });
    expect(page3Res.statusCode).toBe(200);
    const page3 = page3Res.json();
    expect(page3.items.length).toBe(1);
    expect(page3.items[0].runId).toBe("run-1");

    await app.close();
  });

  it("handles query params, limits, invalid cursors, 503 unavailable, etc.", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.DATABASE_URL = PG_CONNECTION_STRING;
    process.env.PG_SSL = "false";

    // 1. Empty history
    {
      const app = buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/v1/insights/sol-usdc/history"
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().items.length).toBe(0);
      await app.close();
    }

    // 2. Limits validation (min 1, max 200)
    {
      const app = buildApp();
      const resMin = await app.inject({
        method: "GET",
        url: "/v1/insights/sol-usdc/history?limit=0"
      });
      expect(resMin.statusCode).toBe(400);

      const resMax = await app.inject({
        method: "GET",
        url: "/v1/insights/sol-usdc/history?limit=201"
      });
      expect(resMax.statusCode).toBe(400);
      await app.close();
    }

    // 3. Invalid/tampered cursor
    {
      const app = buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/v1/insights/sol-usdc/history?cursor=invalid_base64_or_format"
      });
      expect(res.statusCode).toBe(400);
      await app.close();
    }

    // 4. Store unavailable (no DATABASE_URL configured)
    {
      delete process.env.DATABASE_URL;
      const app = buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/v1/insights/sol-usdc/history"
      });
      expect(res.statusCode).toBe(503);
      await app.close();
    }
  });
});
