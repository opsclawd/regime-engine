import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";

const ONE_HOUR_MS = 60 * 60 * 1000;
const createdDbPaths: string[] = [];

const tempDb = (): string => {
  const path = join(
    tmpdir(),
    `regime-engine-fallback-e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}.sqlite`
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

describe("Candle handler fallback (SQLite-only, no DATABASE_URL)", () => {
  it("POST /v1/candles works with SQLite when candleStore is not provided", async () => {
    process.env.LEDGER_DB_PATH = tempDb();
    process.env.CANDLES_INGEST_TOKEN = "test-token";
    delete process.env.DATABASE_URL;

    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/candles",
      headers: { "X-Candles-Ingest-Token": "test-token" },
      payload: makePayload()
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().insertedCount).toBe(1);
    await app.close();
  });

  it("GET /v1/regime/current returns 404 when no candles data exists (SQLite)", async () => {
    process.env.LEDGER_DB_PATH = tempDb();
    delete process.env.DATABASE_URL;

    const app = buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/regime/current?symbol=SOL%2FUSDC&source=birdeye&network=solana-mainnet&poolAddress=Pool111&timeframe=1h"
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("CANDLES_NOT_FOUND");
    await app.close();
  });
});
