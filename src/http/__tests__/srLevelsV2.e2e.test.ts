import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";

const validRequest = () => ({
  schemaVersion: "2.0",
  source: "macro-charts",
  symbol: "SOL",
  brief: {
    briefId: "mco-sol-2026-04-29",
    sourceRecordedAtIso: "2026-04-29T11:00:00Z",
    summary: "summary"
  },
  theses: [
    {
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
      notes: null
    }
  ]
});

describe("v2 sr-levels endpoints without DATABASE_URL", () => {
  afterEach(() => {
    delete process.env.LEDGER_DB_PATH;
    delete process.env.DATABASE_URL;
    delete process.env.OPENCLAW_INGEST_TOKEN;
  });

  it("POST returns 503 SERVICE_UNAVAILABLE with schemaVersion 2.0 when auth succeeds and DATABASE_URL is missing", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    delete process.env.DATABASE_URL;
    process.env.OPENCLAW_INGEST_TOKEN = "test-token";
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v2/sr-levels",
      headers: { "X-Ingest-Token": "test-token" },
      payload: validRequest()
    });
    expect(res.statusCode).toBe(503);
    const body = res.json() as { schemaVersion: string; error: { code: string } };
    expect(body.schemaVersion).toBe("2.0");
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");

    await app.close();
  });

  it("POST returns 500 SERVER_MISCONFIGURATION with schemaVersion 2.0 when OPENCLAW_INGEST_TOKEN is missing (even without DATABASE_URL)", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    delete process.env.DATABASE_URL;
    delete process.env.OPENCLAW_INGEST_TOKEN;
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v2/sr-levels",
      headers: { "X-Ingest-Token": "anything" },
      payload: validRequest()
    });
    expect(res.statusCode).toBe(500);
    const body = res.json() as { schemaVersion: string; error: { code: string } };
    expect(body.schemaVersion).toBe("2.0");
    expect(body.error.code).toBe("SERVER_MISCONFIGURATION");

    await app.close();
  });

  it("POST returns 401 UNAUTHORIZED with schemaVersion 2.0 when token is missing", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    delete process.env.DATABASE_URL;
    process.env.OPENCLAW_INGEST_TOKEN = "test-token";
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v2/sr-levels",
      payload: validRequest()
    });
    expect(res.statusCode).toBe(401);
    const body = res.json() as { schemaVersion: string; error: { code: string } };
    expect(body.schemaVersion).toBe("2.0");
    expect(body.error.code).toBe("UNAUTHORIZED");

    await app.close();
  });

  it("GET /v2/sr-levels/current returns 503 SERVICE_UNAVAILABLE with schemaVersion 2.0 when DATABASE_URL is missing", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    delete process.env.DATABASE_URL;
    const app = buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/v2/sr-levels/current?symbol=SOL&source=macro-charts"
    });
    expect(res.statusCode).toBe(503);
    const body = res.json() as { schemaVersion: string; error: { code: string } };
    expect(body.schemaVersion).toBe("2.0");
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");

    await app.close();
  });
});