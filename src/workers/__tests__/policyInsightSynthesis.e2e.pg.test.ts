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
import { policyInsightSynthesisCursor } from "../../ledger/pg/schema/policyInsightSynthesisCursor.js";
import { policyInsights } from "../../ledger/pg/schema/policyInsights.js";
import type { SynthesizePolicyInsightUseCase } from "../../application/use-cases/synthesizePolicyInsightUseCase.js";

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

setupPg("Policy Insight Synthesis Worker E2E (PG)", () => {
  it("evidence-only synthesis remains independently triggerable", async () => {
    setEnv();
    const app = buildApp();
    const ctx = buildStoreContext();
    await seedCandles(ctx);

    const ingestRes = await app.inject({
      method: "POST",
      url: "/v1/evidence/sol-usdc",
      headers: { "x-evidence-ingest-token": EVIDENCE_TOKEN },
      payload: makePairEvidencePayload("run-backfill-001")
    });
    expect(ingestRes.statusCode).toBe(201);
    const { receiptId } = ingestRes.json();

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
    if (cycleResult.outcome === "succeeded") {
      expect(cycleResult.receiptId).toBe(receiptId);
    }

    const currentRes = await app.inject({
      method: "GET",
      url: "/v1/insights/sol-usdc/current"
    });
    expect(currentRes.statusCode).toBe(200);
    const currentBody = currentRes.json();
    expect(currentBody.pair).toBe("SOL/USDC");

    const [cursorRow] = await db
      .select()
      .from(policyInsightSynthesisCursor)
      .where(sql`cursor_key = 'pair'`);
    expect(cursorRow.lastProcessedReceiptId).toBe(receiptId);
    expect(cursorRow.lastProcessedSrThesesMaxId).toBe(0);
    expect(cursorRow.targetReceiptId).toBeNull();
    expect(cursorRow.targetSrThesesMaxId).toBeNull();

    const secondCycle = await runPolicyInsightSynthesisCycle({
      triggerPort,
      synthesizePolicyInsight: appDeps.synthesizePolicyInsight!,
      config,
      logger: nullLogger,
      leaseOwner: "test-lease-owner-001",
      clock
    });
    expect(secondCycle.outcome).toBe("idle");

    const allInsights = await db.select().from(policyInsights);
    expect(allInsights).toHaveLength(1);

    await app.close();
    await ctx.close();
  });

  it("current pair insight includes selected lineage from pair evidence", async () => {
    setEnv();
    const app = buildApp();
    const ctx = buildStoreContext();
    await seedCandles(ctx);

    const ingestRes = await app.inject({
      method: "POST",
      url: "/v1/evidence/sol-usdc",
      headers: { "x-evidence-ingest-token": EVIDENCE_TOKEN },
      payload: makePairEvidencePayload("run-lineage-001", "src-lineage-001")
    });
    expect(ingestRes.statusCode).toBe(201);

    const appDeps = buildApplication(ctx);
    const triggerPort = createPostgresPolicyInsightSynthesisTriggerAdapter(ctx.pg!);
    const config = parsePolicyInsightSynthesisWorkerConfig(process.env);

    await runPolicyInsightSynthesisCycle({
      triggerPort,
      synthesizePolicyInsight: appDeps.synthesizePolicyInsight!,
      config,
      logger: nullLogger,
      leaseOwner: "test-lease-owner-001",
      clock
    });

    const currentRes = await app.inject({
      method: "GET",
      url: "/v1/insights/sol-usdc/current"
    });
    expect(currentRes.statusCode).toBe(200);
    const currentBody = currentRes.json();
    expect(currentBody.evidence).toBeDefined();

    const [insightRow] = await db.select().from(policyInsights);
    expect(insightRow).toBeDefined();
    expect(insightRow.selectedLineageJson).toBeDefined();
    expect(Array.isArray(insightRow.selectedLineageJson)).toBe(true);

    await app.close();
    await ctx.close();
  });

  it("coalesces two created receipts into one latest-input synthesis", async () => {
    setEnv();
    const app = buildApp();
    const ctx = buildStoreContext();
    await seedCandles(ctx);

    const res1 = await app.inject({
      method: "POST",
      url: "/v1/evidence/sol-usdc",
      headers: { "x-evidence-ingest-token": EVIDENCE_TOKEN },
      payload: makePairEvidencePayload("run-coalesce-001", "src-001")
    });
    expect(res1.statusCode).toBe(201);
    const receipt1 = res1.json().receiptId;

    const res2 = await app.inject({
      method: "POST",
      url: "/v1/evidence/sol-usdc",
      headers: { "x-evidence-ingest-token": EVIDENCE_TOKEN },
      payload: makePairEvidencePayload("run-coalesce-002", "src-002")
    });
    expect(res2.statusCode).toBe(201);
    const receipt2 = res2.json().receiptId;
    expect(receipt2).toBeGreaterThan(receipt1);

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
    if (cycleResult.outcome === "succeeded") {
      expect(cycleResult.receiptId).toBe(receipt2);
    }

    const allInsights = await db.select().from(policyInsights);
    expect(allInsights).toHaveLength(1);

    const [cursorRow] = await db
      .select()
      .from(policyInsightSynthesisCursor)
      .where(sql`cursor_key = 'pair'`);
    expect(cursorRow.lastProcessedReceiptId).toBe(receipt2);

    await app.close();
    await ctx.close();
  });

  it("duplicate evidence replay creates neither a new claim nor a duplicate insight", async () => {
    setEnv();
    const app = buildApp();
    const ctx = buildStoreContext();
    await seedCandles(ctx);

    const payload = makePairEvidencePayload("run-replay-001", "src-001");
    const firstIngest = await app.inject({
      method: "POST",
      url: "/v1/evidence/sol-usdc",
      headers: { "x-evidence-ingest-token": EVIDENCE_TOKEN },
      payload
    });
    expect(firstIngest.statusCode).toBe(201);
    const originalReceiptId = firstIngest.json().receiptId;

    const appDeps = buildApplication(ctx);
    const triggerPort = createPostgresPolicyInsightSynthesisTriggerAdapter(ctx.pg!);
    const config = parsePolicyInsightSynthesisWorkerConfig(process.env);

    const firstCycle = await runPolicyInsightSynthesisCycle({
      triggerPort,
      synthesizePolicyInsight: appDeps.synthesizePolicyInsight!,
      config,
      logger: nullLogger,
      leaseOwner: "test-lease-owner-001",
      clock
    });
    expect(firstCycle.outcome).toBe("succeeded");

    const replayIngest = await app.inject({
      method: "POST",
      url: "/v1/evidence/sol-usdc",
      headers: { "x-evidence-ingest-token": EVIDENCE_TOKEN },
      payload
    });
    expect(replayIngest.statusCode).toBe(200);
    expect(replayIngest.json().status).toBe("already_ingested");
    expect(replayIngest.json().receiptId).toBe(originalReceiptId);

    const secondCycle = await runPolicyInsightSynthesisCycle({
      triggerPort,
      synthesizePolicyInsight: appDeps.synthesizePolicyInsight!,
      config,
      logger: nullLogger,
      leaseOwner: "test-lease-owner-001",
      clock
    });
    expect(secondCycle.outcome).toBe("idle");

    const insightsCount = await db.select().from(policyInsights);
    expect(insightsCount).toHaveLength(1);

    const [cursorRow] = await db
      .select()
      .from(policyInsightSynthesisCursor)
      .where(sql`cursor_key = 'pair'`);
    expect(cursorRow.lastProcessedReceiptId).toBe(originalReceiptId);

    await app.close();
    await ctx.close();
  });

  it("overlapping synthesis attempts converge on one synthesis input hash", async () => {
    setEnv();
    const app = buildApp();
    const ctx = buildStoreContext();
    await seedCandles(ctx);

    await app.inject({
      method: "POST",
      url: "/v1/evidence/sol-usdc",
      headers: { "x-evidence-ingest-token": EVIDENCE_TOKEN },
      payload: makePairEvidencePayload("run-overlap-001")
    });

    const appDeps = buildApplication(ctx);
    const synthesizePolicyInsight = appDeps.synthesizePolicyInsight!;

    const input = {
      scope: { kind: "pair" as const },
      marketSelector: {
        source: "geckoterminal",
        network: "solana",
        poolAddress: POOL_ADDRESS,
        timeframe: "1h" as const
      },
      positionPlan: null
    };

    const [insight1, insight2] = await Promise.all([
      synthesizePolicyInsight(input),
      synthesizePolicyInsight(input)
    ]);

    expect(insight1.insightId).toBe(insight2.insightId);

    const allInsights = await db.select().from(policyInsights);
    expect(allInsights).toHaveLength(1);
    expect(allInsights[0].insightId).toBe(insight1.insightId);

    await app.close();
    await ctx.close();
  });

  it("created evidence still returns 201 while the worker later records a transient synthesis failure", async () => {
    setEnv();
    const app = buildApp();
    const ctx = buildStoreContext();
    await seedCandles(ctx);

    const ingestRes = await app.inject({
      method: "POST",
      url: "/v1/evidence/sol-usdc",
      headers: { "x-evidence-ingest-token": EVIDENCE_TOKEN },
      payload: makePairEvidencePayload("run-isolation-001")
    });
    expect(ingestRes.statusCode).toBe(201);
    const receiptId = ingestRes.json().receiptId;

    const failingSynthesize = async () => {
      throw new Error("Temporary DB connection loss");
    };

    const triggerPort = createPostgresPolicyInsightSynthesisTriggerAdapter(ctx.pg!);
    const config = parsePolicyInsightSynthesisWorkerConfig(process.env);

    const cycleResult = await runPolicyInsightSynthesisCycle({
      triggerPort,
      synthesizePolicyInsight: failingSynthesize as unknown as SynthesizePolicyInsightUseCase,
      config,
      logger: nullLogger,
      leaseOwner: "test-lease-owner-001",
      clock
    });

    expect(cycleResult.outcome).toBe("transient_failure");
    if (cycleResult.outcome === "transient_failure") {
      expect(cycleResult.receiptId).toBe(receiptId);
    }

    const [cursorRow] = await db
      .select()
      .from(policyInsightSynthesisCursor)
      .where(sql`cursor_key = 'pair'`);
    expect(cursorRow.lastProcessedReceiptId).toBe(0);
    expect(cursorRow.lastOutcome).toBe("transient_failure");
    expect(cursorRow.attemptCount).toBe(1);

    await app.close();
    await ctx.close();
  });
});
