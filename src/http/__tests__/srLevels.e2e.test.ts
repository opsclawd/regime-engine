import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { createLedgerStore, getLedgerCounts } from "../../ledger/store.js";

const createdDbPaths: string[] = [];

const makePayload = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: "1.0",
  source: "clmm-analyzer",
  symbol: "SOLUSDC",
  brief: {
    briefId: "brief-001",
    sourceRecordedAtIso: "2025-04-17T12:00:00Z",
    summary: "Test S/R levels"
  },
  levels: [
    { levelType: "support", price: 140.5 },
    { levelType: "resistance", price: 180.25, rank: "strong", timeframe: "1h" }
  ],
  ...overrides
});

afterEach(() => {
  for (const path of createdDbPaths.splice(0, createdDbPaths.length)) {
    rmSync(path, { force: true });
  }
  delete process.env.LEDGER_DB_PATH;
  delete process.env.OPENCLAW_INGEST_TOKEN;
});

describe("/v1/sr-levels e2e", () => {
  it("POST valid brief returns 201 and GET current returns latest levels grouped by type sorted by price", async () => {
    const dbPath = join(
      tmpdir(),
      `regime-engine-sr-e2e-${Date.now()}-${Math.floor(Math.random() * 10_000)}.sqlite`
    );
    createdDbPaths.push(dbPath);
    process.env.LEDGER_DB_PATH = dbPath;
    process.env.OPENCLAW_INGEST_TOKEN = "test-token";

    const app = buildApp();

    const ingestResponse = await app.inject({
      method: "POST",
      url: "/v1/sr-levels",
      headers: { "X-Ingest-Token": "test-token" },
      payload: makePayload()
    });

    expect(ingestResponse.statusCode).toBe(201);
    const ingestBody = ingestResponse.json() as { briefId: string; insertedCount: number };
    expect(ingestBody.briefId).toBe("brief-001");
    expect(ingestBody.insertedCount).toBe(2);

    const currentResponse = await app.inject({
      method: "GET",
      url: "/v1/sr-levels/current?symbol=SOLUSDC&source=clmm-analyzer"
    });

    expect(currentResponse.statusCode).toBe(200);
    const current = currentResponse.json() as {
      schemaVersion: string;
      source: string;
      symbol: string;
      briefId: string;
      sourceRecordedAtIso: string | null;
      summary: string | null;
      capturedAtIso: string;
      supports: Array<{ price: number; rank?: string; timeframe?: string; invalidation?: number; notes?: string }>;
      resistances: Array<{ price: number; rank?: string; timeframe?: string; invalidation?: number; notes?: string }>;
    };
    expect(current.schemaVersion).toBe("1.0");
    expect(current.symbol).toBe("SOLUSDC");
    expect(current.source).toBe("clmm-analyzer");
    expect(current.briefId).toBe("brief-001");
    expect(current.sourceRecordedAtIso).toBe("2025-04-17T12:00:00Z");
    expect(current.summary).toBe("Test S/R levels");
    expect(typeof current.capturedAtIso).toBe("string");
    expect(current.supports).toEqual([{ price: 140.5 }]);
    expect(current.resistances).toEqual([{ price: 180.25, rank: "strong", timeframe: "1h" }]);

    await app.close();
  });

  it("re-POST byte-identical brief returns 200 already_ingested without duplicating rows", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.OPENCLAW_INGEST_TOKEN = "test-token";

    const app = buildApp();
    const payload = makePayload();

    const first = await app.inject({
      method: "POST",
      url: "/v1/sr-levels",
      headers: { "X-Ingest-Token": "test-token" },
      payload
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: "/v1/sr-levels",
      headers: { "X-Ingest-Token": "test-token" },
      payload
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(
      expect.objectContaining({
        briefId: "brief-001",
        insertedCount: 0,
        status: "already_ingested"
      })
    );

    await app.close();
  });

  it("re-POST same source+briefId with different levels returns 409", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.OPENCLAW_INGEST_TOKEN = "test-token";

    const app = buildApp();

    await app.inject({
      method: "POST",
      url: "/v1/sr-levels",
      headers: { "X-Ingest-Token": "test-token" },
      payload: makePayload()
    });

    const conflict = await app.inject({
      method: "POST",
      url: "/v1/sr-levels",
      headers: { "X-Ingest-Token": "test-token" },
      payload: makePayload({
        levels: [{ levelType: "support", price: 999 }]
      })
    });
    expect(conflict.statusCode).toBe(409);

    await app.close();
  });

  it("missing X-Ingest-Token returns 401 without writing", async () => {
    const dbPath = join(
      tmpdir(),
      `regime-engine-sr-auth1-${Date.now()}-${Math.floor(Math.random() * 10_000)}.sqlite`
    );
    createdDbPaths.push(dbPath);
    process.env.LEDGER_DB_PATH = dbPath;
    process.env.OPENCLAW_INGEST_TOKEN = "test-token";

    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/sr-levels",
      payload: makePayload()
    });
    expect(response.statusCode).toBe(401);

    await app.close();

    const verifyStore = createLedgerStore(dbPath);
    expect(getLedgerCounts(verifyStore).srLevelBriefs).toBe(0);
    verifyStore.close();
  });

  it("wrong X-Ingest-Token returns 401", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.OPENCLAW_INGEST_TOKEN = "test-token";

    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/sr-levels",
      headers: { "X-Ingest-Token": "wrong-token" },
      payload: makePayload()
    });
    expect(response.statusCode).toBe(401);

    await app.close();
  });

  it("missing OPENCLAW_INGEST_TOKEN env var returns 500", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    delete process.env.OPENCLAW_INGEST_TOKEN;

    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/sr-levels",
      headers: { "X-Ingest-Token": "any-token" },
      payload: makePayload()
    });
    expect(response.statusCode).toBe(500);

    await app.close();
  });

  it("empty levels array returns 400", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.OPENCLAW_INGEST_TOKEN = "test-token";

    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/sr-levels",
      headers: { "X-Ingest-Token": "test-token" },
      payload: makePayload({ levels: [] })
    });
    expect(response.statusCode).toBe(400);

    await app.close();
  });

  it("malformed payload returns 400", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.OPENCLAW_INGEST_TOKEN = "test-token";

    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/sr-levels",
      headers: { "X-Ingest-Token": "test-token" },
      payload: { garbage: true }
    });
    expect(response.statusCode).toBe(400);

    await app.close();
  });

  it("GET current returns only latest brief after two briefs for same symbol+source", async () => {
    const dbPath = join(
      tmpdir(),
      `regime-engine-sr-history-${Date.now()}-${Math.floor(Math.random() * 10_000)}.sqlite`
    );
    createdDbPaths.push(dbPath);
    process.env.LEDGER_DB_PATH = dbPath;
    process.env.OPENCLAW_INGEST_TOKEN = "test-token";

    const app = buildApp();

    await app.inject({
      method: "POST",
      url: "/v1/sr-levels",
      headers: { "X-Ingest-Token": "test-token" },
      payload: makePayload({
        brief: { briefId: "brief-001", sourceRecordedAtIso: "2025-04-17T12:00:00Z" },
        levels: [{ levelType: "support", price: 140 }]
      })
    });

    await app.inject({
      method: "POST",
      url: "/v1/sr-levels",
      headers: { "X-Ingest-Token": "test-token" },
      payload: makePayload({
        brief: { briefId: "brief-002", sourceRecordedAtIso: "2025-04-18T12:00:00Z" },
        levels: [{ levelType: "support", price: 150 }, { levelType: "resistance", price: 200 }]
      })
    });

    const currentResponse = await app.inject({
      method: "GET",
      url: "/v1/sr-levels/current?symbol=SOLUSDC&source=clmm-analyzer"
    });
    expect(currentResponse.statusCode).toBe(200);
    const current = currentResponse.json() as {
      schemaVersion: string;
      briefId: string;
      sourceRecordedAtIso: string | null;
      summary: string | null;
      capturedAtIso: string;
      supports: Array<{ price: number }>;
      resistances: Array<{ price: number }>;
    };
    expect(current.schemaVersion).toBe("1.0");
    expect(current.briefId).toBe("brief-002");
    expect(current.sourceRecordedAtIso).toBe("2025-04-18T12:00:00Z");
    expect(current.summary).toBeNull();
    expect(current.supports).toEqual([{ price: 150 }]);
    expect(current.resistances).toEqual([{ price: 200 }]);

    await app.close();

    const verifyStore = createLedgerStore(dbPath);
    expect(getLedgerCounts(verifyStore).srLevelBriefs).toBe(2);
    verifyStore.close();
  });

  it("GET current returns 404 for nonexistent symbol+source", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";

    const app = buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/v1/sr-levels/current?symbol=ETHUSDC&source=nonexistent"
    });
    expect(response.statusCode).toBe(404);

    await app.close();
  });
});
