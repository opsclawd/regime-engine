import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../../app.js";
import { createLedgerStore, getLedgerCounts } from "../../../ledger/store.js";
import { MARKET_REGIME_CONFIG } from "../../../engine/marketRegime/config.js";

const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const createdDbPaths: string[] = [];

const computeSourceCutoffUnixMs = () =>
  Math.floor(
    (Date.now() - MARKET_REGIME_CONFIG["15m"].freshness.closedCandleDelayMs) / FIFTEEN_MIN_MS
  ) *
    FIFTEEN_MIN_MS -
  FIFTEEN_MIN_MS;

const tempDb = (): string => {
  const path = join(
    tmpdir(),
    `regime-engine-regime-current-e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}.sqlite`
  );
  createdDbPaths.push(path);
  return path;
};

const buildRecentCandles = (count: number) => {
  const anchor = Math.floor(Date.now() / FIFTEEN_MIN_MS) * FIFTEEN_MIN_MS - 2 * FIFTEEN_MIN_MS;
  return Array.from({ length: count }, (_, i) => ({
    unixMs: anchor - (count - 1 - i) * FIFTEEN_MIN_MS,
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
  timeframe: "15m",
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
  "?symbol=SOL%2FUSDC&source=birdeye&network=solana-mainnet&poolAddress=Pool111&timeframe=15m";

const queryString1h =
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
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
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
      payload: ingestPayload(130, recordedIso)
    });

    const res = await app.inject({ method: "GET", url: `/v1/regime/current${queryString}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.schemaVersion).toBe("1.0");
    expect(body.symbol).toBe("SOL/USDC");
    expect(body.timeframe).toBe("15m");
    expect(["UP", "DOWN", "CHOP"]).toContain(body.regime);
    expect(body.metadata.candleCount).toBeGreaterThanOrEqual(
      MARKET_REGIME_CONFIG["15m"].suitability.minCandles
    );
    expect(body.metadata.sourceTimeframe).toBe("15m");
    expect(body.metadata.sourceCandleCount).toBe(body.metadata.candleCount);
    expect(body.metadata.derivedTimeframe).toBeUndefined();
    expect(body.metadata.aggregationVersion).toBeUndefined();
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
      payload: ingestPayload(130, new Date().toISOString())
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

  it("returns 200 with derived 1h regime classified from stored 15m candles", async () => {
    process.env.LEDGER_DB_PATH = tempDb();
    process.env.CANDLES_INGEST_TOKEN = "test-token";
    const app = buildApp();

    const recordedIso = new Date().toISOString();
    await app.inject({
      method: "POST",
      url: "/v1/candles",
      headers: { "X-Candles-Ingest-Token": "test-token" },
      payload: ingestPayload(200, recordedIso)
    });

    const res = await app.inject({ method: "GET", url: `/v1/regime/current${queryString1h}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.schemaVersion).toBe("1.0");
    expect(body.timeframe).toBe("1h");
    expect(["UP", "DOWN", "CHOP"]).toContain(body.regime);
    expect(body.metadata.sourceTimeframe).toBe("15m");
    expect(body.metadata.sourceCandleCount).toBeGreaterThanOrEqual(body.metadata.candleCount * 4);
    expect(body.metadata.derivedTimeframe).toBe("1h");
    expect(body.metadata.aggregationVersion).toBe("ohlcv-agg-v1");
    expect(body.metadata.candleCount).toBeGreaterThan(0);
    expect(Array.isArray(body.marketReasons)).toBe(true);
  });

  it("derived 1h does not classify the incomplete current-hour aggregate", async () => {
    process.env.LEDGER_DB_PATH = tempDb();
    process.env.CANDLES_INGEST_TOKEN = "test-token";
    const app = buildApp();

    await app.inject({
      method: "POST",
      url: "/v1/candles",
      headers: { "X-Candles-Ingest-Token": "test-token" },
      payload: ingestPayload(200, new Date().toISOString())
    });

    const res = await app.inject({ method: "GET", url: `/v1/regime/current${queryString1h}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.freshness.lastCandleUnixMs).toBeLessThan(Date.now());

    expect(body.freshness.lastCandleUnixMs % ONE_HOUR_MS).toBe(0);
  });

  it("returns 404 CANDLES_NOT_FOUND when no derived 1h bars survive the cutoff", async () => {
    process.env.LEDGER_DB_PATH = tempDb();
    process.env.CANDLES_INGEST_TOKEN = "test-token";
    const app = buildApp();

    const sourceCutoffUnixMs = computeSourceCutoffUnixMs();
    const hourOpen =
      Math.floor((sourceCutoffUnixMs - 4 * FIFTEEN_MIN_MS) / ONE_HOUR_MS) * ONE_HOUR_MS;
    const partialCandles = [0, 1, 2].map((i) => ({
      unixMs: hourOpen + i * FIFTEEN_MIN_MS,
      open: 100,
      high: 100.5,
      low: 99.5,
      close: 100,
      volume: 1
    }));

    await app.inject({
      method: "POST",
      url: "/v1/candles",
      headers: { "X-Candles-Ingest-Token": "test-token" },
      payload: {
        schemaVersion: "1.0",
        source: "birdeye",
        network: "solana-mainnet",
        poolAddress: "Pool111",
        symbol: "SOL/USDC",
        timeframe: "15m",
        sourceRecordedAtIso: new Date().toISOString(),
        candles: partialCandles
      }
    });

    const res = await app.inject({ method: "GET", url: `/v1/regime/current${queryString1h}` });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("CANDLES_NOT_FOUND");
  });

  it("derived 1h with non-zero but insufficient derived bars returns DATA_INSUFFICIENT_SAMPLES", async () => {
    process.env.LEDGER_DB_PATH = tempDb();
    process.env.CANDLES_INGEST_TOKEN = "test-token";
    const app = buildApp();

    const sourceCutoffUnixMs = computeSourceCutoffUnixMs();
    const lastHourOpen = Math.floor(sourceCutoffUnixMs / ONE_HOUR_MS) * ONE_HOUR_MS - ONE_HOUR_MS;
    const startHourOpen = lastHourOpen - 4 * ONE_HOUR_MS;
    const candles: Array<{
      unixMs: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }> = [];
    for (let h = 0; h < 5; h += 1) {
      for (let q = 0; q < 4; q += 1) {
        candles.push({
          unixMs: startHourOpen + h * ONE_HOUR_MS + q * FIFTEEN_MIN_MS,
          open: 100,
          high: 100.5,
          low: 99.5,
          close: 100,
          volume: 1
        });
      }
    }

    await app.inject({
      method: "POST",
      url: "/v1/candles",
      headers: { "X-Candles-Ingest-Token": "test-token" },
      payload: {
        schemaVersion: "1.0",
        source: "birdeye",
        network: "solana-mainnet",
        poolAddress: "Pool111",
        symbol: "SOL/USDC",
        timeframe: "15m",
        sourceRecordedAtIso: new Date().toISOString(),
        candles
      }
    });

    const res = await app.inject({ method: "GET", url: `/v1/regime/current${queryString1h}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.metadata.candleCount).toBeLessThan(
      MARKET_REGIME_CONFIG["1h"].suitability.minCandles
    );
    expect(body.marketReasons.map((r: { code: string }) => r.code)).toContain(
      "DATA_INSUFFICIENT_SAMPLES"
    );
    expect(body.clmmSuitability.status).toBe("UNKNOWN");
  });

  it("returns 404 CANDLES_NOT_FOUND for derived 1h when no 15m source candles exist at all", async () => {
    process.env.LEDGER_DB_PATH = tempDb();
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/regime/current${queryString1h}` });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("CANDLES_NOT_FOUND");
  });
});
