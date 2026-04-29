import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { createLedgerStore, getLedgerCounts } from "../../ledger/store.js";

const ONE_HOUR_MS = 60 * 60 * 1000;
const createdDbPaths: string[] = [];

const tempDb = (): string => {
  const path = join(
    tmpdir(),
    `regime-engine-regime-current-e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}.sqlite`
  );
  createdDbPaths.push(path);
  return path;
};

const buildRecentCandles = (count: number) => {
  const anchor = Math.floor(Date.now() / ONE_HOUR_MS) * ONE_HOUR_MS - 2 * ONE_HOUR_MS;
  return Array.from({ length: count }, (_, i) => ({
    unixMs: anchor - (count - 1 - i) * ONE_HOUR_MS,
    open: 100,
    high: 100.5,
    low: 99.5,
    close: 100,
    volume: 1
  }));
};

const ingestPayload = (count: number, recordedIso: string) => ({
  schemaVersion: "1.0",
  source: "birdeye",
  network: "solana-mainnet",
  poolAddress: "Pool111",
  symbol: "SOL/USDC",
  timeframe: "1h",
  sourceRecordedAtIso: recordedIso,
  candles: buildRecentCandles(count)
});

afterEach(() => {
  for (const p of createdDbPaths.splice(0)) {
    rmSync(p, { force: true });
  }
  delete process.env.LEDGER_DB_PATH;
  delete process.env.CANDLES_INGEST_TOKEN;
});

const queryString =
  "?symbol=SOL%2FUSDC&source=birdeye&network=solana-mainnet&poolAddress=Pool111&timeframe=1h";

describe("GET /v1/regime/current", () => {
  it("returns 400 when a required selector is missing", async () => {
    process.env.LEDGER_DB_PATH = tempDb();
    const app = buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/regime/current?symbol=SOL%2FUSDC&source=birdeye"
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when timeframe is outside the allowlist", async () => {
    process.env.LEDGER_DB_PATH = tempDb();
    const app = buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/regime/current?symbol=SOL%2FUSDC&source=birdeye&network=solana-mainnet&poolAddress=Pool111&timeframe=4h"
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 CANDLES_NOT_FOUND when no candles exist for the slot", async () => {
    process.env.LEDGER_DB_PATH = tempDb();
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/regime/current${queryString}` });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("CANDLES_NOT_FOUND");
  });

  it("returns 200 with regime and suitability fields for sufficient CHOP candles", async () => {
    process.env.LEDGER_DB_PATH = tempDb();
    process.env.CANDLES_INGEST_TOKEN = "test-token";
    const app = buildApp();

    const recordedIso = new Date().toISOString();
    await app.inject({
      method: "POST",
      url: "/v1/candles",
      headers: { "X-Candles-Ingest-Token": "test-token" },
      payload: ingestPayload(40, recordedIso)
    });

    const res = await app.inject({ method: "GET", url: `/v1/regime/current${queryString}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.schemaVersion).toBe("1.0");
    expect(body.symbol).toBe("SOL/USDC");
    expect(body.timeframe).toBe("1h");
    expect(["UP", "DOWN", "CHOP"]).toContain(body.regime);
    expect(body.metadata.candleCount).toBeGreaterThan(0);
    expect(["ALLOWED", "CAUTION", "BLOCKED", "UNKNOWN"]).toContain(body.clmmSuitability.status);
    expect(Array.isArray(body.clmmSuitability.reasons)).toBe(true);
    expect(Array.isArray(body.marketReasons)).toBe(true);
    expect(body.freshness).toBeDefined();
    expect(body.telemetry).toBeDefined();
  });

  it("does not write to the plan ledger when called repeatedly", async () => {
    process.env.LEDGER_DB_PATH = tempDb();
    process.env.CANDLES_INGEST_TOKEN = "test-token";
    const app = buildApp();

    await app.inject({
      method: "POST",
      url: "/v1/candles",
      headers: { "X-Candles-Ingest-Token": "test-token" },
      payload: ingestPayload(40, new Date().toISOString())
    });

    const dbPath = process.env.LEDGER_DB_PATH!;
    const readStore = createLedgerStore(dbPath);
    const baseCounts = getLedgerCounts(readStore);
    readStore.close();

    for (let i = 0; i < 5; i += 1) {
      const res = await app.inject({ method: "GET", url: `/v1/regime/current${queryString}` });
      expect(res.statusCode).toBe(200);
    }

    const readStoreAfter = createLedgerStore(dbPath);
    const afterCounts = getLedgerCounts(readStoreAfter);
    readStoreAfter.close();

    expect(afterCounts.plans).toBe(baseCounts.plans);
    expect(afterCounts.planRequests).toBe(baseCounts.planRequests);
    expect(afterCounts.executionResults).toBe(baseCounts.executionResults);
  });
});
