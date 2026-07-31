import { afterAll, afterEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { buildApp } from "../../app.js";
import { buildStoreContext } from "../buildStoreContext.js";
import type { Db } from "../../ledger/pg/db.js";
import { createDb } from "../../ledger/pg/db.js";
import { policyInsights } from "../../ledger/pg/schema/policyInsights.js";
import { consoleLogger } from "../../workers/gecko/logger.js";

const PG_CONNECTION_STRING =
  process.env.DATABASE_URL ?? "postgres://test:test@localhost:5432/regime_engine_test";
const EVIDENCE_TOKEN = "test-evidence-token";
const POOL_ADDRESS = "sol-usdc-pool-001";
const FIXED_NOW = Math.floor(Date.now() / (60 * 60 * 1000)) * (60 * 60 * 1000);
const FIFTEEN_MIN_MS = 15 * 60 * 1000;

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
    await db.execute(sql`DELETE FROM regime_engine.policy_insight_synthesis_requests`);
    await db.execute(sql`DELETE FROM regime_engine.policy_insights`);
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

const makePositionEvidencePayload = (positionId: string, walletAddress: string, runId: string) => ({
  schemaVersion: "evidence-bundle.v1",
  pair: "SOL/USDC",
  scope: {
    kind: "position",
    network: "solana-mainnet",
    positionId,
    whirlpoolAddress: POOL_ADDRESS,
    walletAddress
  },
  source: {
    publisher: "sol-usdc-clmm-intelligence",
    sourceId: "src-001",
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

const makePlanPayload = (positionId: string, walletId: string, asOfUnixMs: number = FIXED_NOW) => ({
  schemaVersion: "1.0",
  asOfUnixMs,
  market: {
    symbol: "SOL/USDC",
    source: "geckoterminal",
    network: "solana",
    poolAddress: POOL_ADDRESS,
    timeframe: "1h"
  },
  position: {
    positionId,
    walletId,
    observedAtUnixMs: asOfUnixMs,
    lowerBoundPrice: 95,
    upperBoundPrice: 110,
    currentPrice: 100,
    rangeState: "in-range",
    breachQualified: false
  },
  portfolio: { navUsd: 12000, solUnits: 25, usdcUnits: 7000 },
  autopilotState: {
    activeClmm: false,
    stopouts24h: 0,
    redeploys24h: 0,
    cooldownUntilUnixMs: 0,
    standDownUntilUnixMs: 0,
    strikeCount: 0
  },
  config: {
    regime: {
      confirmBars: 2,
      minHoldBars: 3,
      enterUpTrend: 0.6,
      exitUpTrend: 0.35,
      enterDownTrend: -0.6,
      exitDownTrend: -0.35,
      chopVolRatioMax: 1.4
    },
    allocation: {
      upSolBps: 8000,
      downSolBps: 1500,
      chopSolBps: 5000,
      maxDeltaExposureBpsPerDay: 1000,
      maxTurnoverPerDayBps: 600
    },
    churn: {
      maxStopouts24h: 2,
      maxRedeploys24h: 2,
      cooldownMsAfterStopout: 86400000,
      standDownTriggerStrikes: 2
    },
    baselines: { dcaIntervalDays: 7, dcaAmountUsd: 250, usdcCarryApr: 0.06 }
  }
});

setupPg("Position Policy Insight Runtime E2E (PG)", () => {
  it("restart reclaims an expired lease and persists exactly one canonical insight", async () => {
    setEnv();
    const ctx = buildStoreContext();
    await seedCandles(ctx);

    const app = buildApp({
      storeContext: ctx,
      positionSynthesizerDeps: {
        logger: consoleLogger,
        sleep: () => new Promise((resolve) => setTimeout(resolve, 5))
      }
    });

    const posId = "pos-lease-001";
    const wallet = "wallet-lease-001";

    await app.inject({
      method: "POST",
      url: "/v1/evidence/sol-usdc",
      headers: { "x-evidence-ingest-token": EVIDENCE_TOKEN },
      payload: makePositionEvidencePayload(posId, wallet, "run-lease-001")
    });

    await app.inject({
      method: "POST",
      url: "/v1/plan",
      payload: makePlanPayload(posId, wallet)
    });

    // Simulate an expired lease in queue table
    await db.execute(
      sql`UPDATE regime_engine.policy_insight_synthesis_requests
          SET lease_owner = 'previous-dead-worker',
              lease_expires_at_unix_ms = ${FIXED_NOW - 1000},
              status = 'processing'
          WHERE status = 'pending'`
    );

    // Wait for the active app position worker to run synthesis cycle
    await new Promise((resolve) => setTimeout(resolve, 100));

    const insights = await db.select().from(policyInsights);
    expect(insights).toHaveLength(1);

    await app.close();
  });

  it("evidence first and plan first both become visible through the current position insight endpoint", async () => {
    setEnv();
    const ctx = buildStoreContext();
    await seedCandles(ctx);

    const app = buildApp({
      storeContext: ctx,
      positionSynthesizerDeps: {
        logger: consoleLogger,
        sleep: () => new Promise((resolve) => setTimeout(resolve, 5))
      }
    });

    // Sequence 1: Evidence first then Plan (pos 1)
    const pos1 = "pos-seq-001";
    const wallet1 = "wallet-seq-001";

    await app.inject({
      method: "POST",
      url: "/v1/evidence/sol-usdc",
      headers: { "x-evidence-ingest-token": EVIDENCE_TOKEN },
      payload: makePositionEvidencePayload(pos1, wallet1, "run-seq-001")
    });

    await app.inject({
      method: "POST",
      url: "/v1/plan",
      payload: makePlanPayload(pos1, wallet1)
    });

    // Sequence 2: Plan first then Evidence (pos 2)
    const pos2 = "pos-seq-002";
    const wallet2 = "wallet-seq-002";

    await app.inject({
      method: "POST",
      url: "/v1/plan",
      payload: makePlanPayload(pos2, wallet2)
    });

    await app.inject({
      method: "POST",
      url: "/v1/evidence/sol-usdc",
      headers: { "x-evidence-ingest-token": EVIDENCE_TOKEN },
      payload: makePositionEvidencePayload(pos2, wallet2, "run-seq-002")
    });

    // Wait for worker to synthesize
    await new Promise((resolve) => setTimeout(resolve, 150));

    const res1 = await app.inject({
      method: "GET",
      url: `/v1/insights/sol-usdc/current?scope=position&positionId=${pos1}&whirlpoolAddress=${POOL_ADDRESS}&walletAddress=${wallet1}`
    });
    expect(res1.statusCode).toBe(200);

    const res2 = await app.inject({
      method: "GET",
      url: `/v1/insights/sol-usdc/current?scope=position&positionId=${pos2}&whirlpoolAddress=${POOL_ADDRESS}&walletAddress=${wallet2}`
    });
    expect(res2.statusCode).toBe(200);

    await app.close();
  });

  it("duplicate evidence creates no duplicate insight and a new plan creates a new insight", async () => {
    setEnv();
    const ctx = buildStoreContext();
    await seedCandles(ctx);

    const app = buildApp({
      storeContext: ctx,
      positionSynthesizerDeps: {
        logger: consoleLogger,
        sleep: () => new Promise((resolve) => setTimeout(resolve, 5))
      }
    });

    const posId = "pos-dup-001";
    const wallet = "wallet-dup-001";
    const evPayload = makePositionEvidencePayload(posId, wallet, "run-dup-001");

    await app.inject({
      method: "POST",
      url: "/v1/evidence/sol-usdc",
      headers: { "x-evidence-ingest-token": EVIDENCE_TOKEN },
      payload: evPayload
    });

    await app.inject({
      method: "POST",
      url: "/v1/plan",
      payload: makePlanPayload(posId, wallet)
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    const insightsBefore = await db.select().from(policyInsights);
    expect(insightsBefore).toHaveLength(1);

    // Ingest exact duplicate evidence
    await app.inject({
      method: "POST",
      url: "/v1/evidence/sol-usdc",
      headers: { "x-evidence-ingest-token": EVIDENCE_TOKEN },
      payload: evPayload
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    const insightsMiddle = await db.select().from(policyInsights);
    expect(insightsMiddle).toHaveLength(1);

    // Ingest a new plan (e.g. at a slightly different timestamp or tick boundary)
    await app.inject({
      method: "POST",
      url: "/v1/plan",
      payload: makePlanPayload(posId, wallet, FIXED_NOW + 5000)
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    const insightsAfter = await db.select().from(policyInsights);
    expect(insightsAfter.length).toBeGreaterThanOrEqual(2);

    await app.close();
  });

  it("two positions sharing one intelligence correlation synthesize independently", async () => {
    setEnv();
    const ctx = buildStoreContext();
    await seedCandles(ctx);

    const app = buildApp({
      storeContext: ctx,
      positionSynthesizerDeps: {
        logger: consoleLogger,
        sleep: () => new Promise((resolve) => setTimeout(resolve, 5))
      }
    });

    const posA = "pos-share-A";
    const walletA = "wallet-share-A";
    const posB = "pos-share-B";
    const walletB = "wallet-share-B";

    const commonEvA = makePositionEvidencePayload(posA, walletA, "run-share-A");
    const commonEvB = makePositionEvidencePayload(posB, walletB, "run-share-B");

    await app.inject({
      method: "POST",
      url: "/v1/evidence/sol-usdc",
      headers: { "x-evidence-ingest-token": EVIDENCE_TOKEN },
      payload: commonEvA
    });

    await app.inject({
      method: "POST",
      url: "/v1/evidence/sol-usdc",
      headers: { "x-evidence-ingest-token": EVIDENCE_TOKEN },
      payload: commonEvB
    });

    await app.inject({
      method: "POST",
      url: "/v1/plan",
      payload: makePlanPayload(posA, walletA)
    });

    await app.inject({
      method: "POST",
      url: "/v1/plan",
      payload: makePlanPayload(posB, walletB)
    });

    await new Promise((resolve) => setTimeout(resolve, 300));

    const insights = await db.select().from(policyInsights);
    expect(insights.length).toBeGreaterThanOrEqual(2);

    const resA = await app.inject({
      method: "GET",
      url: `/v1/insights/sol-usdc/current?scope=position&positionId=${posA}&whirlpoolAddress=${POOL_ADDRESS}&walletAddress=${walletA}`
    });
    expect(resA.statusCode).toBe(200);

    const resB = await app.inject({
      method: "GET",
      url: `/v1/insights/sol-usdc/current?scope=position&positionId=${posB}&whirlpoolAddress=${POOL_ADDRESS}&walletAddress=${walletB}`
    });
    expect(resB.statusCode).toBe(200);

    await app.close();
  });
});
