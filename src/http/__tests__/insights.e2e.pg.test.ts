import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import type { Db } from "../../ledger/pg/db.js";
import { createDb, verifyPgConnection } from "../../ledger/pg/db.js";
import { clmmInsights } from "../../ledger/pg/schema/index.js";

const PG_CONNECTION_STRING =
  process.env.DATABASE_URL ?? "postgres://test:test@localhost:5432/regime_engine_test";

const makePayload = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: "1.0",
  pair: "SOL/USDC",
  asOf: "2026-04-29T12:00:00Z",
  source: "openclaw",
  runId: "run-001",
  marketRegime: "ranging",
  fundamentalRegime: "neutral",
  recommendedAction: "hold",
  confidence: "medium",
  riskLevel: "normal",
  dataQuality: "complete",
  clmmPolicy: {
    posture: "neutral",
    rangeBias: "medium",
    rebalanceSensitivity: "normal",
    maxCapitalDeploymentPercent: 80
  },
  levels: { support: [140.5, 135.0], resistance: [180.25, 190.0] },
  reasoning: ["Market ranging between support and resistance"],
  sourceRefs: ["https://example.com/data"],
  expiresAt: "2026-04-30T12:00:00Z",
  ...overrides
});

let db: Db;
let pgClient: { end: () => Promise<void> };
let pgAvailable = false;

try {
  const result = createDb(PG_CONNECTION_STRING);
  db = result.db;
  pgClient = result.client;
  pgAvailable = true;
} catch {
  pgAvailable = false;
}

const setupPg = describe.skipIf(!pgAvailable);

beforeAll(async () => {
  if (!pgAvailable) return;
  try {
    await verifyPgConnection(db);
  } catch {
    pgAvailable = false;
  }
});

afterAll(async () => {
  if (pgClient) {
    await pgClient.end();
  }
});

afterEach(async () => {
  delete process.env.LEDGER_DB_PATH;
  delete process.env.DATABASE_URL;
  delete process.env.INSIGHT_INGEST_TOKEN;
  if (db && pgAvailable) {
    await db.delete(clmmInsights);
  }
});

setupPg("POST /v1/insights/sol-usdc (PG)", () => {
  it("returns 201 with created status on first ingest", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.DATABASE_URL = PG_CONNECTION_STRING;
    process.env.PG_SSL = "false";
    process.env.INSIGHT_INGEST_TOKEN = "test-token";
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/insights/sol-usdc",
      headers: { "X-Insight-Ingest-Token": "test-token" },
      payload: makePayload()
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      schemaVersion: string;
      status: string;
      runId: string;
      payloadHash: string;
      receivedAtIso: string;
    };
    expect(body.status).toBe("created");
    expect(body.runId).toBe("run-001");
    expect(typeof body.payloadHash).toBe("string");
    expect(body.payloadHash).toHaveLength(64);
    expect(typeof body.receivedAtIso).toBe("string");

    await app.close();
  });

  it("returns 200 with already_ingested on duplicate runId", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.DATABASE_URL = PG_CONNECTION_STRING;
    process.env.PG_SSL = "false";
    process.env.INSIGHT_INGEST_TOKEN = "test-token";
    const app = buildApp();
    const payload = makePayload();

    await app.inject({
      method: "POST",
      url: "/v1/insights/sol-usdc",
      headers: { "X-Insight-Ingest-Token": "test-token" },
      payload
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/insights/sol-usdc",
      headers: { "X-Insight-Ingest-Token": "test-token" },
      payload
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; runId: string };
    expect(body.status).toBe("already_ingested");
    expect(body.runId).toBe("run-001");

    await app.close();
  });

  it("returns 409 on conflict (same source+runId, different payload)", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.DATABASE_URL = PG_CONNECTION_STRING;
    process.env.PG_SSL = "false";
    process.env.INSIGHT_INGEST_TOKEN = "test-token";
    const app = buildApp();

    await app.inject({
      method: "POST",
      url: "/v1/insights/sol-usdc",
      headers: { "X-Insight-Ingest-Token": "test-token" },
      payload: makePayload()
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/insights/sol-usdc",
      headers: { "X-Insight-Ingest-Token": "test-token" },
      payload: makePayload({ recommendedAction: "watch" })
    });
    expect(res.statusCode).toBe(409);

    await app.close();
  });

  it("returns 401 when X-Insight-Ingest-Token header is missing", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.DATABASE_URL = PG_CONNECTION_STRING;
    process.env.PG_SSL = "false";
    process.env.INSIGHT_INGEST_TOKEN = "test-token";
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/insights/sol-usdc",
      payload: makePayload()
    });
    expect(res.statusCode).toBe(401);

    await app.close();
  });

  it("returns 401 when X-Insight-Ingest-Token is wrong", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.DATABASE_URL = PG_CONNECTION_STRING;
    process.env.PG_SSL = "false";
    process.env.INSIGHT_INGEST_TOKEN = "test-token";
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/insights/sol-usdc",
      headers: { "X-Insight-Ingest-Token": "wrong-token" },
      payload: makePayload()
    });
    expect(res.statusCode).toBe(401);

    await app.close();
  });

  it("returns 500 when INSIGHT_INGEST_TOKEN env is not set", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.DATABASE_URL = PG_CONNECTION_STRING;
    process.env.PG_SSL = "false";
    delete process.env.INSIGHT_INGEST_TOKEN;
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/insights/sol-usdc",
      headers: { "X-Insight-Ingest-Token": "any-token" },
      payload: makePayload()
    });
    expect(res.statusCode).toBe(500);

    await app.close();
  });

  it("returns 400 for malformed payload", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.DATABASE_URL = PG_CONNECTION_STRING;
    process.env.PG_SSL = "false";
    process.env.INSIGHT_INGEST_TOKEN = "test-token";
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/insights/sol-usdc",
      headers: { "X-Insight-Ingest-Token": "test-token" },
      payload: { garbage: true }
    });
    expect(res.statusCode).toBe(400);

    await app.close();
  });
});

setupPg("GET /v1/insights/sol-usdc/current (PG)", () => {
  it("returns 404 when no insights exist", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.DATABASE_URL = PG_CONNECTION_STRING;
    process.env.PG_SSL = "false";
    const app = buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/v1/insights/sol-usdc/current"
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it("returns fresh insight after ingest", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.DATABASE_URL = PG_CONNECTION_STRING;
    process.env.PG_SSL = "false";
    process.env.INSIGHT_INGEST_TOKEN = "test-token";
    const app = buildApp();

    const futureExpiry = new Date(Date.now() + 86400000).toISOString();
    await app.inject({
      method: "POST",
      url: "/v1/insights/sol-usdc",
      headers: { "X-Insight-Ingest-Token": "test-token" },
      payload: makePayload({ expiresAt: futureExpiry })
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/insights/sol-usdc/current"
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      status: string;
      payloadHash: string;
      freshness: { stale: boolean };
    };
    expect(body.status).toBe("FRESH");
    expect(body.freshness.stale).toBe(false);
    expect(typeof body.payloadHash).toBe("string");

    await app.close();
  });

  it("returns STALE when insight is past expiry", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.DATABASE_URL = PG_CONNECTION_STRING;
    process.env.PG_SSL = "false";
    process.env.INSIGHT_INGEST_TOKEN = "test-token";
    const app = buildApp();

    await app.inject({
      method: "POST",
      url: "/v1/insights/sol-usdc",
      headers: { "X-Insight-Ingest-Token": "test-token" },
      payload: makePayload({
        asOf: "2026-01-01T00:00:00Z",
        expiresAt: "2026-01-02T00:00:00Z"
      })
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/insights/sol-usdc/current"
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; freshness: { stale: boolean } };
    expect(body.status).toBe("STALE");
    expect(body.freshness.stale).toBe(true);

    await app.close();
  });
});

setupPg("GET /v1/insights/sol-usdc/history (PG)", () => {
  it("returns empty items when no insights exist", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.DATABASE_URL = PG_CONNECTION_STRING;
    process.env.PG_SSL = "false";
    const app = buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/v1/insights/sol-usdc/history"
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: unknown[]; limit: number };
    expect(body.items).toEqual([]);
    expect(body.limit).toBe(50);

    await app.close();
  });

  it("returns ingested insights ordered by receivedAt desc", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.DATABASE_URL = PG_CONNECTION_STRING;
    process.env.PG_SSL = "false";
    process.env.INSIGHT_INGEST_TOKEN = "test-token";
    const app = buildApp();

    const futureExpiry = new Date(Date.now() + 86400000).toISOString();
    await app.inject({
      method: "POST",
      url: "/v1/insights/sol-usdc",
      headers: { "X-Insight-Ingest-Token": "test-token" },
      payload: makePayload({ runId: "run-001", expiresAt: futureExpiry })
    });

    await app.inject({
      method: "POST",
      url: "/v1/insights/sol-usdc",
      headers: { "X-Insight-Ingest-Token": "test-token" },
      payload: makePayload({ runId: "run-002", expiresAt: futureExpiry })
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/insights/sol-usdc/history"
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: { runId: string }[]; limit: number; pair: string };
    expect(body.items).toHaveLength(2);
    expect(body.items[0].runId).toBe("run-002");
    expect(body.items[1].runId).toBe("run-001");
    expect(body.pair).toBe("SOL/USDC");

    await app.close();
  });

  it("respects limit query parameter", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.DATABASE_URL = PG_CONNECTION_STRING;
    process.env.PG_SSL = "false";
    process.env.INSIGHT_INGEST_TOKEN = "test-token";
    const app = buildApp();

    const futureExpiry = new Date(Date.now() + 86400000).toISOString();
    await app.inject({
      method: "POST",
      url: "/v1/insights/sol-usdc",
      headers: { "X-Insight-Ingest-Token": "test-token" },
      payload: makePayload({ runId: "run-a", expiresAt: futureExpiry })
    });
    await app.inject({
      method: "POST",
      url: "/v1/insights/sol-usdc",
      headers: { "X-Insight-Ingest-Token": "test-token" },
      payload: makePayload({ runId: "run-b", expiresAt: futureExpiry })
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/insights/sol-usdc/history?limit=1"
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
      url: "/v1/insights/sol-usdc/history?limit=0"
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
      url: "/v1/insights/sol-usdc/history?limit=201"
    });
    expect(res.statusCode).toBe(400);

    await app.close();
  });
});
