import { afterAll, afterEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { buildApp } from "../../../app.js";
import type { Db } from "../../../ledger/pg/db.js";
import { createDb } from "../../../ledger/pg/db.js";

const PG_CONNECTION_STRING =
  process.env.DATABASE_URL ?? "postgres://test:test@localhost:5432/regime_engine_test";

const EVIDENCE_TOKEN = "test-evidence-token";

const makePayload = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: "evidence-bundle.v1",
  pair: "SOL/USDC",
  scope: { kind: "pair" },
  source: {
    publisher: "sol-usdc-clmm-intelligence",
    sourceId: `src-evidence-${Date.now()}`,
    sourceVersion: "1.0.0"
  },
  runId: `run-evidence-${Date.now()}`,
  correlationId: `corr-evidence-${Date.now()}`,
  createdAt: "2026-04-29T12:00:00.000Z",
  asOf: "2026-04-29T12:00:00.000Z",
  freshUntil: "2026-04-29T18:00:00.000Z",
  expiresAt: "2026-04-30T12:00:00.000Z",
  deterministicFeatures: [
    {
      featureId: "feat-price-001",
      family: "market_state",
      featureKind: "number",
      status: "available",
      value: 150.25,
      unit: "usd",
      observedAt: "2026-04-29T12:00:00.000Z",
      freshUntil: "2026-04-29T18:00:00.000Z",
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
      observedAt: "2026-04-29T11:59:00.000Z"
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
  },
  ...overrides
});

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
  if (db) {
    await db.execute(sql`DELETE FROM regime_engine.evidence_bundles`);
  }
});

setupPg("POST /v1/evidence/sol-usdc (PG)", () => {
  it("returns 201 with created status on first ingest", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.DATABASE_URL = PG_CONNECTION_STRING;
    process.env.PG_SSL = "false";
    process.env.EVIDENCE_INGEST_TOKEN = EVIDENCE_TOKEN;
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/evidence/sol-usdc",
      headers: { "x-evidence-ingest-token": EVIDENCE_TOKEN },
      payload: makePayload()
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      schemaVersion: string;
      status: string;
      runId: string;
      evidenceHash: string;
      receivedAt: string;
      receiptId: number;
    };
    expect(body.status).toBe("created");
    expect(typeof body.runId).toBe("string");
    expect(typeof body.evidenceHash).toBe("string");
    expect(body.evidenceHash).toHaveLength(64);
    expect(typeof body.receivedAt).toBe("string");
    expect(typeof body.receiptId).toBe("number");

    await app.close();
  });

  it("returns 200 with already_ingested on duplicate runId", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.DATABASE_URL = PG_CONNECTION_STRING;
    process.env.PG_SSL = "false";
    process.env.EVIDENCE_INGEST_TOKEN = EVIDENCE_TOKEN;
    const app = buildApp();
    const payload = makePayload();

    await app.inject({
      method: "POST",
      url: "/v1/evidence/sol-usdc",
      headers: { "x-evidence-ingest-token": EVIDENCE_TOKEN },
      payload
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/evidence/sol-usdc",
      headers: { "x-evidence-ingest-token": EVIDENCE_TOKEN },
      payload
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; runId: string };
    expect(body.status).toBe("already_ingested");

    await app.close();
  });

  it("returns 409 on conflict (same source+runId, different payload)", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.DATABASE_URL = PG_CONNECTION_STRING;
    process.env.PG_SSL = "false";
    process.env.EVIDENCE_INGEST_TOKEN = EVIDENCE_TOKEN;
    const app = buildApp();
    const runId = `run-conflict-${Date.now()}`;

    await app.inject({
      method: "POST",
      url: "/v1/evidence/sol-usdc",
      headers: { "x-evidence-ingest-token": EVIDENCE_TOKEN },
      payload: makePayload({ runId })
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/evidence/sol-usdc",
      headers: { "x-evidence-ingest-token": EVIDENCE_TOKEN },
      payload: makePayload({ runId, deterministicFeatures: [] })
    });
    expect(res.statusCode).toBe(409);
    const body = res.json() as { error?: { code?: string } };
    expect(body.error?.code).toBe("EVIDENCE_RUN_CONFLICT");

    await app.close();
  });

  it("returns 401 when x-evidence-ingest-token header is missing", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.DATABASE_URL = PG_CONNECTION_STRING;
    process.env.PG_SSL = "false";
    process.env.EVIDENCE_INGEST_TOKEN = EVIDENCE_TOKEN;
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/evidence/sol-usdc",
      payload: makePayload()
    });
    expect(res.statusCode).toBe(401);
    const body = res.json() as { error?: { code?: string } };
    expect(body.error?.code).toBe("UNAUTHORIZED");

    await app.close();
  });

  it("returns 401 when x-evidence-ingest-token is wrong", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.DATABASE_URL = PG_CONNECTION_STRING;
    process.env.PG_SSL = "false";
    process.env.EVIDENCE_INGEST_TOKEN = EVIDENCE_TOKEN;
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/evidence/sol-usdc",
      headers: { "x-evidence-ingest-token": "wrong-token" },
      payload: makePayload()
    });
    expect(res.statusCode).toBe(401);
    const body = res.json() as { error?: { code?: string } };
    expect(body.error?.code).toBe("UNAUTHORIZED");

    await app.close();
  });

  it("returns 400 for malformed payload", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.DATABASE_URL = PG_CONNECTION_STRING;
    process.env.PG_SSL = "false";
    process.env.EVIDENCE_INGEST_TOKEN = EVIDENCE_TOKEN;
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/evidence/sol-usdc",
      headers: { "x-evidence-ingest-token": EVIDENCE_TOKEN },
      payload: { garbage: true }
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error?: { code?: string } };
    expect(body.error?.code).toBe("VALIDATION_ERROR");

    await app.close();
  });
});

setupPg("GET /v1/evidence/sol-usdc/current (PG)", () => {
  it("returns 404 when no evidence exists", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.DATABASE_URL = PG_CONNECTION_STRING;
    process.env.PG_SSL = "false";
    const app = buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/v1/evidence/sol-usdc/current"
    });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error?: { code?: string } };
    expect(body.error?.code).toBe("EVIDENCE_NOT_FOUND");

    await app.close();
  });

  it("returns fresh evidence after ingest", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.DATABASE_URL = PG_CONNECTION_STRING;
    process.env.PG_SSL = "false";
    process.env.EVIDENCE_INGEST_TOKEN = EVIDENCE_TOKEN;
    const app = buildApp();
    const runId = `run-current-${Date.now()}`;

    await app.inject({
      method: "POST",
      url: "/v1/evidence/sol-usdc",
      headers: { "x-evidence-ingest-token": EVIDENCE_TOKEN },
      payload: makePayload({ runId })
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/evidence/sol-usdc/current"
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      schemaVersion: string;
      pair: string;
      scope: { kind: string };
      items: unknown[];
    };
    expect(body.schemaVersion).toBe("evidence-bundle.v1");
    expect(body.pair).toBe("SOL/USDC");
    expect(body.scope.kind).toBe("pair");
    expect(body.items).toHaveLength(1);
    expect((body.items[0] as { runId: string }).runId).toBe(runId);

    await app.close();
  });

  it("accepts source.publisher filter", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.DATABASE_URL = PG_CONNECTION_STRING;
    process.env.PG_SSL = "false";
    process.env.EVIDENCE_INGEST_TOKEN = EVIDENCE_TOKEN;
    const app = buildApp();

    await app.inject({
      method: "POST",
      url: "/v1/evidence/sol-usdc",
      headers: { "x-evidence-ingest-token": EVIDENCE_TOKEN },
      payload: makePayload()
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/evidence/sol-usdc/current?source.publisher=sol-usdc-clmm-intelligence"
    });
    expect(res.statusCode).toBe(200);

    await app.close();
  });

  it("rejects unknown query parameters", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.DATABASE_URL = PG_CONNECTION_STRING;
    process.env.PG_SSL = "false";
    const app = buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/v1/evidence/sol-usdc/current?unknownParam=value"
    });
    expect(res.statusCode).toBe(400);

    await app.close();
  });
});

setupPg("GET /v1/evidence/sol-usdc/history (PG)", () => {
  it("returns empty items when no evidence exists", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.DATABASE_URL = PG_CONNECTION_STRING;
    process.env.PG_SSL = "false";
    const app = buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/v1/evidence/sol-usdc/history"
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: unknown[]; limit: number };
    expect(body.items).toEqual([]);
    expect(body.limit).toBe(30);

    await app.close();
  });

  it("returns ingested evidence ordered by receivedAt desc", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.DATABASE_URL = PG_CONNECTION_STRING;
    process.env.PG_SSL = "false";
    process.env.EVIDENCE_INGEST_TOKEN = EVIDENCE_TOKEN;
    const app = buildApp();
    const runId1 = `run-hist-1-${Date.now()}`;
    const runId2 = `run-hist-2-${Date.now()}`;

    await app.inject({
      method: "POST",
      url: "/v1/evidence/sol-usdc",
      headers: { "x-evidence-ingest-token": EVIDENCE_TOKEN },
      payload: makePayload({ runId: runId1 })
    });

    await app.inject({
      method: "POST",
      url: "/v1/evidence/sol-usdc",
      headers: { "x-evidence-ingest-token": EVIDENCE_TOKEN },
      payload: makePayload({ runId: runId2 })
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/evidence/sol-usdc/history"
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      items: { runId: string }[];
      limit: number;
      pair: string;
    };
    expect(body.items).toHaveLength(2);
    expect(body.items[0].runId).toBe(runId2);
    expect(body.items[1].runId).toBe(runId1);
    expect(body.pair).toBe("SOL/USDC");

    await app.close();
  });

  it("respects limit query parameter", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.DATABASE_URL = PG_CONNECTION_STRING;
    process.env.PG_SSL = "false";
    process.env.EVIDENCE_INGEST_TOKEN = EVIDENCE_TOKEN;
    const app = buildApp();

    await app.inject({
      method: "POST",
      url: "/v1/evidence/sol-usdc",
      headers: { "x-evidence-ingest-token": EVIDENCE_TOKEN },
      payload: makePayload({ runId: `run-a-${Date.now()}` })
    });
    await app.inject({
      method: "POST",
      url: "/v1/evidence/sol-usdc",
      headers: { "x-evidence-ingest-token": EVIDENCE_TOKEN },
      payload: makePayload({ runId: `run-b-${Date.now()}` })
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/evidence/sol-usdc/history?limit=1"
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: unknown[]; limit: number };
    expect(body.items).toHaveLength(1);
    expect(body.limit).toBe(1);

    await app.close();
  });

  it("returns 400 for invalid limit parameter", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.DATABASE_URL = PG_CONNECTION_STRING;
    process.env.PG_SSL = "false";
    const app = buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/v1/evidence/sol-usdc/history?limit=0"
    });
    expect(res.statusCode).toBe(400);

    await app.close();
  });

  it("returns 400 for limit exceeding max", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.DATABASE_URL = PG_CONNECTION_STRING;
    process.env.PG_SSL = "false";
    const app = buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/v1/evidence/sol-usdc/history?limit=101"
    });
    expect(res.statusCode).toBe(400);

    await app.close();
  });
});
