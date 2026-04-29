import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";

const ONE_HOUR_MS = 60 * 60 * 1000;
const createdDbPaths: string[] = [];

const makePayload = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: "1.0",
  source: "birdeye",
  network: "solana-mainnet",
  poolAddress: "Pool111",
  symbol: "SOL/USDC",
  timeframe: "1h",
  sourceRecordedAtIso: "2026-04-26T12:00:00.000Z",
  candles: [{ unixMs: ONE_HOUR_MS, open: 100, high: 110, low: 95, close: 105, volume: 1 }],
  ...overrides
});

const tempDb = (): string => {
  const path = join(
    tmpdir(),
    `regime-engine-candles-e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}.sqlite`
  );
  createdDbPaths.push(path);
  return path;
};

afterEach(() => {
  for (const p of createdDbPaths.splice(0)) {
    rmSync(p, { force: true });
  }
  delete process.env.LEDGER_DB_PATH;
  delete process.env.CANDLES_INGEST_TOKEN;
});

describe("POST /v1/candles", () => {
  it("returns 401 when token header is missing", async () => {
    process.env.LEDGER_DB_PATH = tempDb();
    process.env.CANDLES_INGEST_TOKEN = "test-token";
    const app = buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/candles", payload: makePayload() });
    expect(res.statusCode).toBe(401);
  });

  it("returns 500 when CANDLES_INGEST_TOKEN env is missing", async () => {
    process.env.LEDGER_DB_PATH = tempDb();
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/candles",
      headers: { "X-Candles-Ingest-Token": "anything" },
      payload: makePayload()
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe("SERVER_MISCONFIGURATION");
  });

  it("returns 200 with counts and rejections on happy path", async () => {
    process.env.LEDGER_DB_PATH = tempDb();
    process.env.CANDLES_INGEST_TOKEN = "test-token";
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/candles",
      headers: { "X-Candles-Ingest-Token": "test-token" },
      payload: makePayload()
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.insertedCount).toBe(1);
    expect(body.rejections).toEqual([]);
  });

  it("returns 200 with rejectedCount > 0 when sending stale revisions", async () => {
    process.env.LEDGER_DB_PATH = tempDb();
    process.env.CANDLES_INGEST_TOKEN = "test-token";
    const app = buildApp();

    await app.inject({
      method: "POST",
      url: "/v1/candles",
      headers: { "X-Candles-Ingest-Token": "test-token" },
      payload: makePayload({ sourceRecordedAtIso: "2026-04-26T13:00:00.000Z" })
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/candles",
      headers: { "X-Candles-Ingest-Token": "test-token" },
      payload: makePayload({
        sourceRecordedAtIso: "2026-04-26T12:00:00.000Z",
        candles: [{ unixMs: ONE_HOUR_MS, open: 200, high: 210, low: 190, close: 205, volume: 1 }]
      })
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.rejectedCount).toBeGreaterThan(0);
    expect(body.rejections.length).toBe(body.rejectedCount);
  });

  it("returns 400 BATCH_TOO_LARGE for >1000 candles", async () => {
    process.env.LEDGER_DB_PATH = tempDb();
    process.env.CANDLES_INGEST_TOKEN = "test-token";
    const app = buildApp();

    const oversized = Array.from({ length: 1001 }, (_, i) => ({
      unixMs: (i + 1) * ONE_HOUR_MS,
      open: 100,
      high: 110,
      low: 90,
      close: 105,
      volume: 1
    }));

    const res = await app.inject({
      method: "POST",
      url: "/v1/candles",
      headers: { "X-Candles-Ingest-Token": "test-token" },
      payload: makePayload({ candles: oversized })
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("BATCH_TOO_LARGE");
  });
});
