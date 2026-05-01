import { afterAll, afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { createDb, type Db } from "../../ledger/pg/db.js";
import { srThesesV2 } from "../../ledger/pg/schema/index.js";

const PG = process.env.DATABASE_URL ?? "postgres://test:test@localhost:5432/regime_engine_test";

const validThesis = (overrides: Record<string, unknown> = {}) => ({
  asset: "SOL",
  timeframe: "1d",
  bias: "bullish",
  setupType: "breakout",
  supportLevels: ["140.50"],
  resistanceLevels: ["160.00"],
  entryZone: "145-148",
  targets: ["170"],
  invalidation: "<135",
  trigger: "close above 160",
  chartReference: null,
  sourceHandle: "@trader",
  sourceChannel: "twitter",
  sourceKind: "post",
  sourceReliability: "medium",
  rawThesisText: null,
  collectedAt: "2026-04-29T13:00:00Z",
  publishedAt: "2026-04-29T12:00:00Z",
  sourceUrl: null,
  notes: null,
  ...overrides
});

const validPayload = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: "2.0",
  source: "macro-charts",
  symbol: "SOL",
  brief: {
    briefId: "mco-sol-2026-04-29",
    sourceRecordedAtIso: "2026-04-29T11:00:00Z",
    summary: "summary"
  },
  theses: [validThesis()],
  ...overrides
});

let db: Db;
let pgClient: { end: () => Promise<void> };

if (process.env.DATABASE_URL) {
  const r = createDb(PG);
  db = r.db;
  pgClient = r.client;
}

const setupPg = describe.skipIf(!process.env.DATABASE_URL);

afterAll(async () => {
  if (pgClient) await pgClient.end();
});

afterEach(async () => {
  delete process.env.LEDGER_DB_PATH;
  delete process.env.DATABASE_URL;
  delete process.env.OPENCLAW_INGEST_TOKEN;
  if (db) await db.delete(srThesesV2).execute();
});

const baseEnv = () => {
  process.env.LEDGER_DB_PATH = ":memory:";
  process.env.DATABASE_URL = PG;
  process.env.PG_SSL = "false";
  process.env.OPENCLAW_INGEST_TOKEN = "test-token";
};

setupPg("POST /v2/sr-levels (PG)", () => {
  it("returns 201 created on first ingest", async () => {
    baseEnv();
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v2/sr-levels",
      headers: { "X-Ingest-Token": "test-token" },
      payload: validPayload()
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      schemaVersion: string;
      status: string;
      briefId: string;
      insertedCount: number;
      idempotentCount: number;
    };
    expect(body.schemaVersion).toBe("2.0");
    expect(body.status).toBe("created");
    expect(body.briefId).toBe("mco-sol-2026-04-29");
    expect(body.insertedCount).toBe(1);
    expect(body.idempotentCount).toBe(0);
    await app.close();
  });

  it("returns 200 already_ingested on byte-identical replay", async () => {
    baseEnv();
    const app = buildApp();
    const payload = validPayload();
    await app.inject({
      method: "POST",
      url: "/v2/sr-levels",
      headers: { "X-Ingest-Token": "test-token" },
      payload
    });
    const res = await app.inject({
      method: "POST",
      url: "/v2/sr-levels",
      headers: { "X-Ingest-Token": "test-token" },
      payload
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { schemaVersion: string; status: string; idempotentCount: number };
    expect(body.schemaVersion).toBe("2.0");
    expect(body.status).toBe("already_ingested");
    expect(body.idempotentCount).toBe(1);
    await app.close();
  });

  it("returns 409 SR_THESIS_V2_CONFLICT and does not partially insert the batch", async () => {
    baseEnv();
    const app = buildApp();

    await app.inject({
      method: "POST",
      url: "/v2/sr-levels",
      headers: { "X-Ingest-Token": "test-token" },
      payload: validPayload({
        theses: [validThesis({ asset: "BTC", sourceHandle: "@b", bias: "bullish" })]
      })
    });

    const res = await app.inject({
      method: "POST",
      url: "/v2/sr-levels",
      headers: { "X-Ingest-Token": "test-token" },
      payload: validPayload({
        theses: [
          validThesis({ asset: "SOL", sourceHandle: "@new" }),
          validThesis({ asset: "BTC", sourceHandle: "@b", bias: "bearish" })
        ]
      })
    });
    expect(res.statusCode).toBe(409);
    const body = res.json() as { schemaVersion: string; error: { code: string } };
    expect(body.schemaVersion).toBe("2.0");
    expect(body.error.code).toBe("SR_THESIS_V2_CONFLICT");

    const all = await db.select().from(srThesesV2).execute();
    expect(all).toHaveLength(1);
    expect(all[0].sourceHandle).toBe("@b");
    await app.close();
  });

  it("returns 401 with schemaVersion 2.0 on missing/wrong auth", async () => {
    baseEnv();
    const app = buildApp();
    const missing = await app.inject({
      method: "POST",
      url: "/v2/sr-levels",
      payload: validPayload()
    });
    expect(missing.statusCode).toBe(401);
    expect((missing.json() as { schemaVersion: string }).schemaVersion).toBe("2.0");

    const wrong = await app.inject({
      method: "POST",
      url: "/v2/sr-levels",
      headers: { "X-Ingest-Token": "wrong" },
      payload: validPayload()
    });
    expect(wrong.statusCode).toBe(401);
    expect((wrong.json() as { schemaVersion: string }).schemaVersion).toBe("2.0");
    await app.close();
  });

  it("returns 500 SERVER_MISCONFIGURATION when OPENCLAW_INGEST_TOKEN is missing (with DATABASE_URL set)", async () => {
    baseEnv();
    delete process.env.OPENCLAW_INGEST_TOKEN;
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v2/sr-levels",
      headers: { "X-Ingest-Token": "any" },
      payload: validPayload()
    });
    expect(res.statusCode).toBe(500);
    const body = res.json() as { schemaVersion: string; error: { code: string } };
    expect(body.schemaVersion).toBe("2.0");
    expect(body.error.code).toBe("SERVER_MISCONFIGURATION");
    await app.close();
  });

  it("returns 400 VALIDATION_ERROR for malformed payload", async () => {
    baseEnv();
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v2/sr-levels",
      headers: { "X-Ingest-Token": "test-token" },
      payload: { garbage: true }
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { schemaVersion: string; error: { code: string } };
    expect(body.schemaVersion).toBe("2.0");
    expect(body.error.code).toBe("VALIDATION_ERROR");
    await app.close();
  });

  it("returns 400 VALIDATION_ERROR for duplicate thesis identities, before any writes", async () => {
    baseEnv();
    const app = buildApp();
    const dup = validThesis({ asset: "SOL", sourceHandle: "@trader" });
    const res = await app.inject({
      method: "POST",
      url: "/v2/sr-levels",
      headers: { "X-Ingest-Token": "test-token" },
      payload: validPayload({ theses: [validThesis(), dup] })
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { schemaVersion: string; error: { code: string } };
    expect(body.schemaVersion).toBe("2.0");
    expect(body.error.code).toBe("VALIDATION_ERROR");

    const all = await db.select().from(srThesesV2).execute();
    expect(all).toHaveLength(0);
    await app.close();
  });
});

setupPg("GET /v2/sr-levels/current (PG)", () => {
  it("returns 400 VALIDATION_ERROR with schemaVersion 2.0 when symbol/source missing", async () => {
    baseEnv();
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/v2/sr-levels/current" });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { schemaVersion: string; error: { code: string } };
    expect(body.schemaVersion).toBe("2.0");
    expect(body.error.code).toBe("VALIDATION_ERROR");
    await app.close();
  });

  it("returns 404 SR_THESIS_V2_NOT_FOUND when no rows match", async () => {
    baseEnv();
    const app = buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v2/sr-levels/current?symbol=SOL&source=macro-charts"
    });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { schemaVersion: string; error: { code: string } };
    expect(body.schemaVersion).toBe("2.0");
    expect(body.error.code).toBe("SR_THESIS_V2_NOT_FOUND");
    await app.close();
  });

  it("returns latest brief with exact-roundtrip thesis fields, including non-null and null timestamp strings", async () => {
    baseEnv();
    const app = buildApp();

    const olderTimestamp = "2026-04-28T11:00:00.000Z";
    await app.inject({
      method: "POST",
      url: "/v2/sr-levels",
      headers: { "X-Ingest-Token": "test-token" },
      payload: validPayload({
        brief: { briefId: "old", sourceRecordedAtIso: olderTimestamp, summary: null }
      })
    });

    const newerTimestamp = "2026-04-29T11:00:00+00:00";
    await app.inject({
      method: "POST",
      url: "/v2/sr-levels",
      headers: { "X-Ingest-Token": "test-token" },
      payload: validPayload({
        brief: { briefId: "new", sourceRecordedAtIso: newerTimestamp, summary: "freshest" },
        theses: [
          validThesis({ collectedAt: null, publishedAt: "2026-04-29T12:00:00.500Z" }),
          validThesis({ asset: "BTC", sourceHandle: "@b" })
        ]
      })
    });

    const res = await app.inject({
      method: "GET",
      url: "/v2/sr-levels/current?symbol=SOL&source=macro-charts"
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      schemaVersion: string;
      brief: { briefId: string; sourceRecordedAtIso: string };
      theses: Array<{ asset: string; collectedAt: string | null; publishedAt: string | null }>;
    };
    expect(body.schemaVersion).toBe("2.0");
    expect(body.brief.briefId).toBe("new");
    expect(body.brief.sourceRecordedAtIso).toBe(newerTimestamp);
    expect(body.theses.map((t) => t.asset)).toEqual(["SOL", "BTC"]);
    expect(body.theses[0].collectedAt).toBeNull();
    expect(body.theses[0].publishedAt).toBe("2026-04-29T12:00:00.500Z");
    await app.close();
  });
});

setupPg("v1 /v1/sr-levels behavior is unchanged when v2 is wired (PG present)", () => {
  it("v1 GET responds without using the v2 PG store (no rows in sr_theses_v2 are written or read)", async () => {
    baseEnv();
    const app = buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/sr-levels/current?symbol=SOL&source=macro-charts"
    });
    expect([200, 404]).toContain(res.statusCode);
    const all = await db.select().from(srThesesV2).execute();
    expect(all).toHaveLength(0);
    await app.close();
  });
});
