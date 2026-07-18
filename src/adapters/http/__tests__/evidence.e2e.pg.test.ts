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
    await db.execute(
      sql`DELETE FROM regime_engine.evidence_bundles WHERE source->>'publisher' IN ('sol-usdc-clmm-intelligence', 'alpha-publisher', 'zulu-publisher')`
    );
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

setupPg("preserves durable replay and cursor semantics through HTTP", () => {
  it("preserves receipt ID/time on exact replay", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.DATABASE_URL = PG_CONNECTION_STRING;
    process.env.PG_SSL = "false";
    process.env.EVIDENCE_INGEST_TOKEN = EVIDENCE_TOKEN;
    const app = buildApp();
    const runId = `run-replay-${Date.now()}`;
    const payload = makePayload({ runId });

    const first = await app.inject({
      method: "POST",
      url: "/v1/evidence/sol-usdc",
      headers: { "x-evidence-ingest-token": EVIDENCE_TOKEN },
      payload
    });
    expect(first.statusCode).toBe(201);
    const firstBody = first.json() as {
      receiptId: number;
      receivedAt: string;
      evidenceHash: string;
    };
    const originalReceiptId = firstBody.receiptId;
    const originalReceivedAt = firstBody.receivedAt;
    const originalHash = firstBody.evidenceHash;

    const second = await app.inject({
      method: "POST",
      url: "/v1/evidence/sol-usdc",
      headers: { "x-evidence-ingest-token": EVIDENCE_TOKEN },
      payload
    });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json() as {
      receiptId: number;
      receivedAt: string;
      evidenceHash: string;
    };
    expect(secondBody.receiptId).toBe(originalReceiptId);
    expect(secondBody.receivedAt).toBe(originalReceivedAt);
    expect(secondBody.evidenceHash).toBe(originalHash);

    await app.close();
  });

  it("isolates whirlpool scope from pair scope", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.DATABASE_URL = PG_CONNECTION_STRING;
    process.env.PG_SSL = "false";
    process.env.EVIDENCE_INGEST_TOKEN = EVIDENCE_TOKEN;
    const app = buildApp();
    const pairRunId = `run-pair-${Date.now()}`;
    const whirlpoolRunId = `run-whirlpool-${Date.now()}`;
    const whirlpoolAddress = "Whirlpool123456789ABCDEFGHJKLMNPQRSTUVWXYZ";

    await app.inject({
      method: "POST",
      url: "/v1/evidence/sol-usdc",
      headers: { "x-evidence-ingest-token": EVIDENCE_TOKEN },
      payload: makePayload({ runId: pairRunId })
    });

    await app.inject({
      method: "POST",
      url: "/v1/evidence/sol-usdc",
      headers: { "x-evidence-ingest-token": EVIDENCE_TOKEN },
      payload: makePayload({
        runId: whirlpoolRunId,
        scope: { kind: "whirlpool", network: "solana-mainnet", whirlpoolAddress }
      })
    });

    const pairRes = await app.inject({
      method: "GET",
      url: "/v1/evidence/sol-usdc/current"
    });
    expect(pairRes.statusCode).toBe(200);
    const pairBody = pairRes.json() as { items: { runId: string }[] };
    expect(pairBody.items).toHaveLength(1);
    expect(pairBody.items[0].runId).toBe(pairRunId);

    const whirlpoolRes = await app.inject({
      method: "GET",
      url: `/v1/evidence/sol-usdc/current?scope=whirlpool&whirlpoolAddress=${whirlpoolAddress}`
    });
    expect(whirlpoolRes.statusCode).toBe(200);
    const whirlpoolBody = whirlpoolRes.json() as { items: { runId: string }[] };
    expect(whirlpoolBody.items).toHaveLength(1);
    expect(whirlpoolBody.items[0].runId).toBe(whirlpoolRunId);

    await app.close();
  });

  it("isolates wallet scope from pair scope", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.DATABASE_URL = PG_CONNECTION_STRING;
    process.env.PG_SSL = "false";
    process.env.EVIDENCE_INGEST_TOKEN = EVIDENCE_TOKEN;
    const app = buildApp();
    const pairRunId = `run-pair-wallet-${Date.now()}`;
    const walletRunId = `run-wallet-${Date.now()}`;
    const walletAddress = "Wallet123456789ABCDEFGHJKLMNPQRSTUVWXYZ12345678";

    await app.inject({
      method: "POST",
      url: "/v1/evidence/sol-usdc",
      headers: { "x-evidence-ingest-token": EVIDENCE_TOKEN },
      payload: makePayload({ runId: pairRunId })
    });

    await app.inject({
      method: "POST",
      url: "/v1/evidence/sol-usdc",
      headers: { "x-evidence-ingest-token": EVIDENCE_TOKEN },
      payload: makePayload({
        runId: walletRunId,
        scope: { kind: "wallet", network: "solana-mainnet", walletAddress }
      })
    });

    const pairRes = await app.inject({
      method: "GET",
      url: "/v1/evidence/sol-usdc/current"
    });
    expect(pairRes.statusCode).toBe(200);
    const pairBody = pairRes.json() as { items: { runId: string }[] };
    expect(pairBody.items.some((i: { runId: string }) => i.runId === pairRunId)).toBe(true);
    expect(pairBody.items.some((i: { runId: string }) => i.runId === walletRunId)).toBe(false);

    const walletRes = await app.inject({
      method: "GET",
      url: `/v1/evidence/sol-usdc/current?scope=wallet&walletAddress=${walletAddress}`
    });
    expect(walletRes.statusCode).toBe(200);
    const walletBody = walletRes.json() as { items: { runId: string }[] };
    expect(walletBody.items).toHaveLength(1);
    expect(walletBody.items[0].runId).toBe(walletRunId);

    await app.close();
  });

  it("isolates position scope from pair scope", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.DATABASE_URL = PG_CONNECTION_STRING;
    process.env.PG_SSL = "false";
    process.env.EVIDENCE_INGEST_TOKEN = EVIDENCE_TOKEN;
    const app = buildApp();
    const pairRunId = `run-pair-pos-${Date.now()}`;
    const positionRunId = `run-position-${Date.now()}`;
    const walletAddress = "WalletPos123456789ABCDEFGHJKLMNPQRSTUVWXYZ123";
    const whirlpoolAddress = "WhirlpoolPos123456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    const positionId = "PositionID123456789";

    await app.inject({
      method: "POST",
      url: "/v1/evidence/sol-usdc",
      headers: { "x-evidence-ingest-token": EVIDENCE_TOKEN },
      payload: makePayload({ runId: pairRunId })
    });

    await app.inject({
      method: "POST",
      url: "/v1/evidence/sol-usdc",
      headers: { "x-evidence-ingest-token": EVIDENCE_TOKEN },
      payload: makePayload({
        runId: positionRunId,
        scope: {
          kind: "position",
          network: "solana-mainnet",
          walletAddress,
          whirlpoolAddress,
          positionId
        }
      })
    });

    const pairRes = await app.inject({
      method: "GET",
      url: "/v1/evidence/sol-usdc/current"
    });
    expect(pairRes.statusCode).toBe(200);
    const pairBody = pairRes.json() as { items: { runId: string }[] };
    expect(pairBody.items.some((i: { runId: string }) => i.runId === pairRunId)).toBe(true);
    expect(pairBody.items.some((i: { runId: string }) => i.runId === positionRunId)).toBe(false);

    const positionRes = await app.inject({
      method: "GET",
      url: `/v1/evidence/sol-usdc/current?scope=position&walletAddress=${walletAddress}&whirlpoolAddress=${whirlpoolAddress}&positionId=${positionId}`
    });
    expect(positionRes.statusCode).toBe(200);
    const positionBody = positionRes.json() as { items: { runId: string }[] };
    expect(positionBody.items).toHaveLength(1);
    expect(positionBody.items[0].runId).toBe(positionRunId);

    await app.close();
  });

  it("orders multiple sources by publisher then sourceId in current", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.DATABASE_URL = PG_CONNECTION_STRING;
    process.env.PG_SSL = "false";
    process.env.EVIDENCE_INGEST_TOKEN = EVIDENCE_TOKEN;
    const app = buildApp();
    const runId1 = `run-alpha-${Date.now()}`;
    const runId2 = `run-beta-${Date.now()}`;
    const runId3 = `run-gamma-${Date.now()}`;

    await app.inject({
      method: "POST",
      url: "/v1/evidence/sol-usdc",
      headers: { "x-evidence-ingest-token": EVIDENCE_TOKEN },
      payload: makePayload({
        runId: runId1,
        source: { publisher: "zulu-publisher", sourceId: "src-z", sourceVersion: "1.0.0" }
      })
    });

    await app.inject({
      method: "POST",
      url: "/v1/evidence/sol-usdc",
      headers: { "x-evidence-ingest-token": EVIDENCE_TOKEN },
      payload: makePayload({
        runId: runId2,
        source: { publisher: "alpha-publisher", sourceId: "src-a", sourceVersion: "1.0.0" }
      })
    });

    await app.inject({
      method: "POST",
      url: "/v1/evidence/sol-usdc",
      headers: { "x-evidence-ingest-token": EVIDENCE_TOKEN },
      payload: makePayload({
        runId: runId3,
        source: { publisher: "alpha-publisher", sourceId: "src-b", sourceVersion: "1.0.0" }
      })
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/evidence/sol-usdc/current"
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      items: { bundle: { source: { publisher: string; sourceId: string }; runId: string } }[];
    };
    expect(body.items).toHaveLength(3);
    expect(body.items[0].bundle.source.publisher).toBe("alpha-publisher");
    expect(body.items[0].bundle.source.sourceId).toBe("src-a");
    expect(body.items[1].bundle.source.publisher).toBe("alpha-publisher");
    expect(body.items[1].bundle.source.sourceId).toBe("src-b");
    expect(body.items[2].bundle.source.publisher).toBe("zulu-publisher");

    await app.close();
  });

  it("shows stale freshness when past freshUntil but before expiresAt", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.DATABASE_URL = PG_CONNECTION_STRING;
    process.env.PG_SSL = "false";
    process.env.EVIDENCE_INGEST_TOKEN = EVIDENCE_TOKEN;
    const app = buildApp();
    const now = new Date();
    const freshUntil = new Date(now.getTime() - 60 * 60 * 1000);
    const expiresAt = new Date(now.getTime() + 60 * 60 * 1000);
    const runId = `run-stale-${Date.now()}`;

    await app.inject({
      method: "POST",
      url: "/v1/evidence/sol-usdc",
      headers: { "x-evidence-ingest-token": EVIDENCE_TOKEN },
      payload: makePayload({
        runId,
        freshUntil: freshUntil.toISOString(),
        expiresAt: expiresAt.toISOString(),
        asOf: new Date(now.getTime() - 120 * 60 * 1000).toISOString()
      })
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/evidence/sol-usdc/current"
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: { freshness: { status: string } }[] };
    expect(body.items[0].freshness.status).toBe("STALE");

    await app.close();
  });

  it("shows expired freshness when past expiresAt", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.DATABASE_URL = PG_CONNECTION_STRING;
    process.env.PG_SSL = "false";
    process.env.EVIDENCE_INGEST_TOKEN = EVIDENCE_TOKEN;
    const app = buildApp();
    const now = new Date();
    const freshUntil = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const expiresAt = new Date(now.getTime() - 60 * 60 * 1000);
    const runId = `run-expired-${Date.now()}`;

    await app.inject({
      method: "POST",
      url: "/v1/evidence/sol-usdc",
      headers: { "x-evidence-ingest-token": EVIDENCE_TOKEN },
      payload: makePayload({
        runId,
        freshUntil: freshUntil.toISOString(),
        expiresAt: expiresAt.toISOString(),
        asOf: new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString()
      })
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/evidence/sol-usdc/current"
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: { freshness: { status: string } }[] };
    expect(body.items[0].freshness.status).toBe("EXPIRED");

    await app.close();
  });

  it("traverses cursor pages without duplicates after intervening newer insert", async () => {
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.DATABASE_URL = PG_CONNECTION_STRING;
    process.env.PG_SSL = "false";
    process.env.EVIDENCE_INGEST_TOKEN = EVIDENCE_TOKEN;
    const app = buildApp();
    const runId1 = `run-page1-${Date.now()}`;
    const runId2 = `run-page2-${Date.now()}`;
    const runId3 = `run-page3-${Date.now()}`;

    await app.inject({
      method: "POST",
      url: "/v1/evidence/sol-usdc",
      headers: { "x-evidence-ingest-token": EVIDENCE_TOKEN },
      payload: makePayload({ runId: runId1 })
    });
    await delay(15);

    await app.inject({
      method: "POST",
      url: "/v1/evidence/sol-usdc",
      headers: { "x-evidence-ingest-token": EVIDENCE_TOKEN },
      payload: makePayload({ runId: runId2 })
    });
    await delay(15);

    const page1Res = await app.inject({
      method: "GET",
      url: "/v1/evidence/sol-usdc/history?limit=1"
    });
    expect(page1Res.statusCode).toBe(200);
    const page1Body = page1Res.json() as { items: { runId: string }[]; nextCursor: string | null };
    expect(page1Body.items).toHaveLength(1);
    expect(page1Body.items[0].runId).toBe(runId2);
    const cursor = page1Body.nextCursor;
    expect(cursor).not.toBeNull();

    await delay(15);

    await app.inject({
      method: "POST",
      url: "/v1/evidence/sol-usdc",
      headers: { "x-evidence-ingest-token": EVIDENCE_TOKEN },
      payload: makePayload({ runId: runId3 })
    });

    const page2Res = await app.inject({
      method: "GET",
      url: `/v1/evidence/sol-usdc/history?limit=1&cursor=${cursor}`
    });
    expect(page2Res.statusCode).toBe(200);
    const page2Body = page2Res.json() as { items: { runId: string }[]; nextCursor: string | null };
    expect(page2Body.items).toHaveLength(1);
    expect(page2Body.items[0].runId).toBe(runId1);

    const allRes = await app.inject({
      method: "GET",
      url: "/v1/evidence/sol-usdc/history?limit=10"
    });
    expect(allRes.statusCode).toBe(200);
    const allBody = allRes.json() as { items: { runId: string }[] };
    expect(allBody.items.map((i: { runId: string }) => i.runId)).toEqual([runId3, runId2, runId1]);

    await app.close();
  });

  it("returns 503 when PostgreSQL is unavailable", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.DATABASE_URL = "postgres://invalid:invalid@localhost:9999/nonexistent";
    process.env.PG_SSL = "false";
    process.env.EVIDENCE_INGEST_TOKEN = EVIDENCE_TOKEN;
    const app = buildApp();

    const ingestRes = await app.inject({
      method: "POST",
      url: "/v1/evidence/sol-usdc",
      headers: { "x-evidence-ingest-token": EVIDENCE_TOKEN },
      payload: makePayload()
    });
    expect(ingestRes.statusCode).toBe(503);
    const ingestBody = ingestRes.json() as { error?: { code?: string } };
    expect(ingestBody.error?.code).toBe("EVIDENCE_STORE_UNAVAILABLE");

    const currentRes = await app.inject({
      method: "GET",
      url: "/v1/evidence/sol-usdc/current"
    });
    expect(currentRes.statusCode).toBe(503);
    const currentBody = currentRes.json() as { error?: { code?: string } };
    expect(currentBody.error?.code).toBe("EVIDENCE_STORE_UNAVAILABLE");

    const historyRes = await app.inject({
      method: "GET",
      url: "/v1/evidence/sol-usdc/history"
    });
    expect(historyRes.statusCode).toBe(503);
    const historyBody = historyRes.json() as { error?: { code?: string } };
    expect(historyBody.error?.code).toBe("EVIDENCE_STORE_UNAVAILABLE");

    await app.close();
  });

  it("does not affect clmm_insights when evidence is ingested", async () => {
    if (!db) return;

    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.DATABASE_URL = PG_CONNECTION_STRING;
    process.env.PG_SSL = "false";
    process.env.EVIDENCE_INGEST_TOKEN = EVIDENCE_TOKEN;
    const app = buildApp();
    const runId = `run-clmm-${Date.now()}`;

    const beforeCount = await db.execute(
      sql`SELECT COUNT(*) as cnt FROM regime_engine.clmm_insights`
    );

    await app.inject({
      method: "POST",
      url: "/v1/evidence/sol-usdc",
      headers: { "x-evidence-ingest-token": EVIDENCE_TOKEN },
      payload: makePayload({ runId })
    });

    const afterCount = await db.execute(
      sql`SELECT COUNT(*) as cnt FROM regime_engine.clmm_insights`
    );
    expect(afterCount).toEqual(beforeCount);

    await app.close();
  });
});
