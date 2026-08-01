import { afterAll, afterEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { buildApp } from "../../app.js";
import { buildStoreContext } from "../../composition/buildStoreContext.js";
import { buildApplication } from "../../composition/buildApplication.js";
import { createPostgresPolicyInsightSynthesisTriggerAdapter } from "../../adapters/postgres/postgresPolicyInsightSynthesisTriggerAdapter.js";
import { runPolicyInsightSynthesisCycle } from "../policyInsight/runSynthesisCycle.js";
import { parsePolicyInsightSynthesisWorkerConfig } from "../policyInsight/config.js";
import type { Db } from "../../ledger/pg/db.js";
import { createDb } from "../../ledger/pg/db.js";
import type { WorkerLogger } from "../gecko/logger.js";
import { policyInsights } from "../../ledger/pg/schema/policyInsights.js";

const PG_CONNECTION_STRING =
  process.env.DATABASE_URL ?? "postgres://test:test@localhost:5432/regime_engine_test";
const EVIDENCE_TOKEN = "test-evidence-token";
const POOL_ADDRESS = "PoolTest111";
const FIXED_NOW = Date.parse("2026-05-08T12:00:00.000Z");
const FIFTEEN_MIN_MS = 15 * 60 * 1000;

const nullLogger: WorkerLogger = {
  info: () => {},
  warn: () => {},
  error: (msg, details) => {
    console.error("LOGGER ERROR:", msg, JSON.stringify(details, null, 2));
  }
};

const clock = { nowUnixMs: () => FIXED_NOW };

let db: Db;
let pgClient: { end: () => Promise<void> };

if (process.env.DATABASE_URL) {
  const result = createDb(PG_CONNECTION_STRING);
  db = result.db;
  pgClient = result.client;
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
  delete process.env.EVIDENCE_INGEST_TOKEN;
  delete process.env.CANONICAL_SOL_USDC_POOL_ADDRESS;
  delete process.env.PG_SSL;

  if (db) {
    await db.execute(sql`DELETE FROM regime_engine.sr_theses_v2`);
    await db.execute(sql`DELETE FROM regime_engine.policy_insights`);
    await db.execute(sql`DELETE FROM regime_engine.policy_insight_synthesis_cursor`);
    await db.execute(sql`DELETE FROM regime_engine.evidence_bundles`);
    await db.execute(sql`DELETE FROM regime_engine.candle_revisions`);
  }
});

const setEnv = () => {
  process.env.LEDGER_DB_PATH = ":memory:";
  process.env.DATABASE_URL = PG_CONNECTION_STRING;
  process.env.PG_SSL = "false";
  process.env.EVIDENCE_INGEST_TOKEN = EVIDENCE_TOKEN;
  process.env.CANONICAL_SOL_USDC_POOL_ADDRESS = POOL_ADDRESS;
};

const seedCandles = async (ctx: ReturnType<typeof buildStoreContext>) => {
  const candles = Array.from({ length: 200 }, (_, i) => ({
    unixMs: FIXED_NOW - (200 - i) * FIFTEEN_MIN_MS,
    open: 150,
    high: 152,
    low: 148,
    close: 150,
    volume: 1000
  }));

  await ctx.candleStore!.writeCandles(
    {
      schemaVersion: "1.0",
      source: "geckoterminal",
      network: "solana",
      poolAddress: POOL_ADDRESS,
      symbol: "SOL/USDC",
      timeframe: "15m",
      sourceRecordedAtIso: new Date(FIXED_NOW).toISOString(),
      candles
    },
    FIXED_NOW
  );
};

const makePairEvidencePayload = (runId: string, sourceId: string = "src-001") => ({
  schemaVersion: "evidence-bundle.v1",
  pair: "SOL/USDC",
  scope: { kind: "pair" },
  source: {
    publisher: "sol-usdc-clmm-intelligence",
    sourceId,
    sourceVersion: "1.0.0"
  },
  runId,
  correlationId: `corr-${runId}`,
  createdAt: new Date(FIXED_NOW - 10000).toISOString(),
  asOf: new Date(FIXED_NOW - 10000).toISOString(),
  freshUntil: new Date(FIXED_NOW + 3600000).toISOString(),
  expiresAt: new Date(FIXED_NOW + 86400000).toISOString(),
  deterministicFeatures: [
    {
      featureId: "feat-price-001",
      family: "market_state",
      featureKind: "number",
      status: "available",
      value: 150.25,
      unit: "usd",
      observedAt: new Date(FIXED_NOW - 10000).toISOString(),
      freshUntil: new Date(FIXED_NOW + 3600000).toISOString(),
      confidenceBps: 9500,
      calculator: { name: "price-aggregator", version: "1.0.0" },
      inputLineage: ["ref-price-source"],
      warnings: []
    }
  ],
  contextualEvidence: {
    supportResistance: [],
    flows: [],
    derivatives: [],
    events: [],
    newsRegulatory: []
  },
  researchBrief: null,
  sourceReferences: [
    {
      referenceId: "ref-price-source",
      sourceType: "api",
      locator: "https://api.example.com/price",
      observedAt: new Date(FIXED_NOW - 10000).toISOString()
    }
  ],
  assessment: {
    overallConfidenceBps: 9500,
    quality: "degraded",
    coverage: {
      deterministic: "available",
      supportResistance: "unavailable",
      flows: "unavailable",
      derivatives: "unavailable",
      events: "unavailable",
      newsRegulatory: "unavailable",
      researchBrief: "unavailable"
    },
    warnings: [
      {
        code: "CONTEXTUAL_EVIDENCE_UNAVAILABLE",
        message: "All contextual evidence families are unavailable",
        affectedFamilies: ["supportResistance", "flows", "derivatives", "events", "newsRegulatory"]
      },
      {
        code: "RESEARCH_BRIEF_UNAVAILABLE",
        message: "Research brief is null",
        affectedFamilies: ["researchBrief"]
      }
    ]
  },
  provenance: {
    pipelineVersion: "1.0.0",
    gitCommit: "abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234",
    environment: "test",
    upstreamRunIds: []
  }
});

setupPg("Policy Insight Synthesis Worker SR Theses E2E (PG)", () => {
  it("persists Postgres SR theses and derived levels through the pair synthesis worker", async () => {
    setEnv();
    const app = buildApp();
    const ctx = buildStoreContext();
    await seedCandles(ctx);

    const ingestRes = await app.inject({
      method: "POST",
      url: "/v1/evidence/sol-usdc",
      headers: { "x-evidence-ingest-token": EVIDENCE_TOKEN },
      payload: makePairEvidencePayload("run-sr-worker-001")
    });
    expect(ingestRes.statusCode).toBe(201);

    await ctx.srThesesV2Store!.insertBrief({
      capturedAtUnixMs: FIXED_NOW - 5_000,
      request: {
        schemaVersion: "2.0",
        source: "mco",
        symbol: "SOL/USDC",
        brief: {
          briefId: "mco-sol-worker-e2e",
          sourceRecordedAtIso: new Date(FIXED_NOW - 10_000).toISOString(),
          summary: "Worker integration fixture"
        },
        theses: [
          {
            asset: "SOL",
            timeframe: "1d",
            bias: "bullish",
            setupType: null,
            supportLevels: ["90"],
            resistanceLevels: ["160"],
            entryZone: null,
            targets: [],
            invalidation: null,
            trigger: null,
            chartReference: null,
            sourceHandle: "morecryptoonline",
            sourceChannel: null,
            sourceKind: "youtube",
            sourceReliability: null,
            rawThesisText: null,
            collectedAt: null,
            publishedAt: null,
            sourceUrl: null,
            notes: null
          }
        ]
      }
    });

    const appDeps = buildApplication(ctx);
    const triggerPort = createPostgresPolicyInsightSynthesisTriggerAdapter(ctx.pg!);
    const config = parsePolicyInsightSynthesisWorkerConfig(process.env);

    const cycleResult = await runPolicyInsightSynthesisCycle({
      triggerPort,
      synthesizePolicyInsight: appDeps.synthesizePolicyInsight!,
      config,
      logger: nullLogger,
      leaseOwner: "test-lease-owner-001",
      clock
    });

    expect(cycleResult.outcome).toBe("succeeded");

    const [insightRow] = await db.select().from(policyInsights);
    expect(insightRow).toBeDefined();

    const inputJson = insightRow.synthesisInputJson as {
      srTheses?: Array<{ source: string; briefId: string }>;
    };
    expect(inputJson.srTheses).toBeDefined();
    expect(inputJson.srTheses).toHaveLength(1);
    expect(inputJson.srTheses![0].source).toBe("mco");
    expect(inputJson.srTheses![0].briefId).toBe("mco-sol-worker-e2e");

    const outputJson = insightRow.synthesisOutputJson as {
      levels: { supportsUsdcPerSol: string[]; resistancesUsdcPerSol: string[] };
    };
    expect(outputJson.levels).toBeDefined();
    expect(outputJson.levels.supportsUsdcPerSol).toContain("90");
    expect(outputJson.levels.resistancesUsdcPerSol).toContain("160");

    await app.close();
    await ctx.close();
  });

  it("uses Postgres SR data when the SQLite ledger contains no SR rows", async () => {
    setEnv();
    const app = buildApp();
    const ctx = buildStoreContext();
    await seedCandles(ctx);

    const ingestRes = await app.inject({
      method: "POST",
      url: "/v1/evidence/sol-usdc",
      headers: { "x-evidence-ingest-token": EVIDENCE_TOKEN },
      payload: makePairEvidencePayload("run-sr-sqlite-empty-001")
    });
    expect(ingestRes.statusCode).toBe(201);

    await ctx.srThesesV2Store!.insertBrief({
      capturedAtUnixMs: FIXED_NOW - 5_000,
      request: {
        schemaVersion: "2.0",
        source: "mco",
        symbol: "SOL/USDC",
        brief: {
          briefId: "mco-sol-sqlite-empty-e2e",
          sourceRecordedAtIso: new Date(FIXED_NOW - 10_000).toISOString(),
          summary: "SQLite empty integration fixture"
        },
        theses: [
          {
            asset: "SOL",
            timeframe: "1d",
            bias: "bullish",
            setupType: null,
            supportLevels: ["90"],
            resistanceLevels: ["160"],
            entryZone: null,
            targets: [],
            invalidation: null,
            trigger: null,
            chartReference: null,
            sourceHandle: "morecryptoonline",
            sourceChannel: null,
            sourceKind: "youtube",
            sourceReliability: null,
            rawThesisText: null,
            collectedAt: null,
            publishedAt: null,
            sourceUrl: null,
            notes: null
          }
        ]
      }
    });

    const appDeps = buildApplication(ctx);
    const triggerPort = createPostgresPolicyInsightSynthesisTriggerAdapter(ctx.pg!);
    const config = parsePolicyInsightSynthesisWorkerConfig(process.env);

    const cycleResult = await runPolicyInsightSynthesisCycle({
      triggerPort,
      synthesizePolicyInsight: appDeps.synthesizePolicyInsight!,
      config,
      logger: nullLogger,
      leaseOwner: "test-lease-owner-001",
      clock
    });

    expect(cycleResult.outcome).toBe("succeeded");

    const [insightRow] = await db.select().from(policyInsights);
    expect(insightRow).toBeDefined();

    const outputJson = insightRow.synthesisOutputJson as {
      levels: { supportsUsdcPerSol: string[]; resistancesUsdcPerSol: string[] };
    };
    expect(outputJson.levels.supportsUsdcPerSol).toContain("90");
    expect(outputJson.levels.resistancesUsdcPerSol).toContain("160");

    await app.close();
    await ctx.close();
  });
});
