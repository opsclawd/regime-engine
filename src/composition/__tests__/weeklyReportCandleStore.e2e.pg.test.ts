import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, beforeEach, vi } from "vitest";
import { sql } from "drizzle-orm/sql";
import { createLedgerStore } from "../../ledger/store.js";
import { writePlanLedgerEntry } from "../../ledger/writer.js";
import { buildPositionPlan, type PositionPlanInput } from "../../engine/plan/positionPlan.js";
import { createDb, type Db } from "../../ledger/pg/db.js";
import { PG_SCHEMA_NAME } from "../../ledger/pg/schema/candleRevisions.js";
import type { PlanRequest } from "../../contract/v1/types.js";
import type { RuntimeStoreContext } from "../buildStoreContext.js";
import { buildApplication } from "../buildApplication.js";

const createdDbPaths: string[] = [];
const cleanupFns: Array<() => Promise<void>> = [];

beforeEach(() => {
  vi.stubEnv("LEDGER_DB_PATH", "");
  vi.stubEnv("DATABASE_URL", process.env.DATABASE_URL ?? "");
});

afterEach(async () => {
  const fns = cleanupFns.splice(0, cleanupFns.length);
  for (const fn of fns.reverse()) {
    await fn();
  }
  for (const path of createdDbPaths.splice(0, createdDbPaths.length)) {
    rmSync(path, { force: true });
  }
  vi.unstubAllEnvs();
});

const describeIfPg = process.env.DATABASE_URL ? describe : describe.skip;

const POOL_ADDRESS = "PoolWeeklyCandlePgTest";

const buildFixture = (asOfUnixMs: number): { input: PositionPlanInput; request: PlanRequest } => {
  const input: PositionPlanInput = {
    asOfUnixMs,
    position: {
      positionId: `pos-weekly-candle-pg-${asOfUnixMs}`,
      observedAtUnixMs: asOfUnixMs,
      lowerBoundPrice: 100,
      upperBoundPrice: 120,
      currentPrice: 110,
      rangeState: "in-range",
      breachQualified: false
    },
    portfolio: { navUsd: 10_000, solUnits: 20, usdcUnits: 6_000 },
    autopilotState: {
      activeClmm: true,
      stopouts24h: 0,
      redeploys24h: 0,
      cooldownUntilUnixMs: 0,
      standDownUntilUnixMs: 0,
      strikeCount: 0
    },
    config: {
      regime: {
        confirmBars: 1,
        minHoldBars: 0,
        enterUpTrend: 0.6,
        exitUpTrend: 0.35,
        enterDownTrend: -0.6,
        exitDownTrend: -0.35,
        chopVolRatioMax: 1.4
      },
      allocation: {
        upSolBps: 7000,
        downSolBps: 1000,
        chopSolBps: 4000,
        maxDeltaExposureBpsPerDay: 2000,
        maxTurnoverPerDayBps: 5000
      },
      churn: {
        maxStopouts24h: 3,
        maxRedeploys24h: 3,
        cooldownMsAfterStopout: 0,
        standDownTriggerStrikes: 3
      },
      baselines: { dcaIntervalDays: 7, dcaAmountUsd: 100, usdcCarryApr: 0.04 }
    },
    nextRegimeState: { current: "CHOP", barsInRegime: 1, pending: null, pendingBars: 0 },
    market: {
      feed: {
        symbol: "SOL/USDC",
        source: "geckoterminal",
        network: "solana",
        poolAddress: POOL_ADDRESS,
        requestedTimeframe: "1h"
      },
      regime: "CHOP",
      telemetry: {
        realizedVolShort: 0.01,
        realizedVolLong: 0.01,
        volRatio: 1.0,
        trendStrength: 0.0,
        compression: 0.5
      },
      freshness: {
        generatedAtIso: "2026-05-08T12:00:00.000Z",
        lastCandleOpenUnixMs: asOfUnixMs - 60 * 60 * 1000,
        lastCandleOpenIso: "2026-05-08T11:00:00.000Z",
        lastCandleCloseUnixMs: asOfUnixMs - 60_000,
        lastCandleCloseIso: "2026-05-08T11:59:00.000Z",
        ageSeconds: 60,
        softStale: false,
        hardStale: false,
        softStaleSeconds: 1500,
        hardStaleSeconds: 2100
      },
      clmmSuitability: { status: "ALLOWED", reasons: [] },
      candleCount: 50,
      sourceCandleCount: 200,
      sourceTimeframe: "15m",
      derivedTimeframe: "1h",
      aggregationVersion: "ohlcv-agg-v1"
    }
  };

  const request: PlanRequest = {
    schemaVersion: "1.0",
    asOfUnixMs,
    market: {
      symbol: "SOL/USDC",
      source: "geckoterminal",
      network: "solana",
      poolAddress: POOL_ADDRESS,
      timeframe: "1h"
    },
    position: input.position,
    portfolio: input.portfolio,
    autopilotState: input.autopilotState,
    config: input.config
  };

  return { input, request };
};

const insertPgCandles = async (
  db: Db,
  candles: Array<{
    unixMs: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>
) => {
  const qualifiedTable = `${PG_SCHEMA_NAME}.candle_revisions`;
  for (const candle of candles) {
    await db.execute(sql`
      INSERT INTO ${sql.raw(qualifiedTable)} (
        symbol, source, network, pool_address, timeframe, unix_ms,
        source_recorded_at_iso, source_recorded_at_unix_ms,
        open, high, low, close, volume,
        ohlcv_canonical, ohlcv_hash, received_at_unix_ms
      ) VALUES (
        ${"SOL/USDC"},
        ${"geckoterminal"},
        ${"solana"},
        ${POOL_ADDRESS},
        ${"15m"},
        ${candle.unixMs},
        ${new Date(candle.unixMs).toISOString()},
        ${candle.unixMs},
        ${candle.open},
        ${candle.high},
        ${candle.low},
        ${candle.close},
        ${candle.volume},
        ${JSON.stringify({ open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume })},
        ${"hash_" + candle.unixMs},
        ${candle.unixMs}
      )
    `);
  }
};

const deletePgCandles = async (db: Db) => {
  const qualifiedTable = `${PG_SCHEMA_NAME}.candle_revisions`;
  await db.execute(sql`
    DELETE FROM ${sql.raw(qualifiedTable)}
    WHERE symbol = ${"SOL/USDC"}
      AND source = ${"geckoterminal"}
      AND network = ${"solana"}
      AND pool_address = ${POOL_ADDRESS}
      AND timeframe = ${"15m"}
  `);
};

const buildStoreContext = (dbPath: string, pg: Db | null): RuntimeStoreContext => {
  const ledger = createLedgerStore(dbPath);
  return {
    ledger,
    pg,
    candleStore: null,
    insightsStore: null,
    srThesesV2Store: null,
    close: async () => {
      ledger.close();
    }
  };
};

describeIfPg("weekly report candle store (PostgreSQL)", () => {
  it("uses PostgreSQL canonical candles when DATABASE_URL is configured", async () => {
    const dbPath = join(
      tmpdir(),
      `regime-engine-weekly-candle-pg-test-${Date.now()}-${Math.floor(Math.random() * 10_000)}.sqlite`
    );
    createdDbPaths.push(dbPath);

    const { db: pg, client: pgClient } = createDb(process.env.DATABASE_URL!);
    cleanupFns.push(() => pgClient.end());
    const ctx = buildStoreContext(dbPath, pg);
    cleanupFns.push(() => ctx.close());

    const fixture = buildFixture(Date.parse("2026-01-08T00:00:00.000Z"));
    const plan = buildPositionPlan(fixture.input);

    writePlanLedgerEntry(ctx.ledger, {
      planRequest: fixture.request,
      planResponse: plan,
      receivedAtUnixMs: fixture.request.asOfUnixMs
    });

    const windowFrom = Date.parse("2026-01-01T00:00:00.000Z");
    const windowTo = Date.parse("2026-01-31T23:59:59.999Z");
    const pgPrice = 200;

    await insertPgCandles(pg, [
      {
        unixMs: windowFrom + 60 * 60 * 1000,
        open: 100,
        high: 105,
        low: 99,
        close: pgPrice,
        volume: 1000
      },
      {
        unixMs: windowFrom + 2 * 60 * 60 * 1000,
        open: pgPrice,
        high: pgPrice + 5,
        low: pgPrice - 5,
        close: pgPrice + 3,
        volume: 1100
      },
      {
        unixMs: windowFrom + 3 * 60 * 60 * 1000,
        open: pgPrice + 3,
        high: pgPrice + 8,
        low: pgPrice,
        close: pgPrice + 5,
        volume: 1200
      },
      {
        unixMs: windowFrom + 4 * 60 * 60 * 1000,
        open: pgPrice + 5,
        high: pgPrice + 10,
        low: pgPrice + 3,
        close: pgPrice + 8,
        volume: 1300
      },
      {
        unixMs: windowTo - 60 * 60 * 1000,
        open: pgPrice + 8,
        high: pgPrice + 12,
        low: pgPrice + 6,
        close: pgPrice + 10,
        volume: 1400
      }
    ]);
    cleanupFns.push(() => deletePgCandles(pg));

    const app = buildApplication(ctx);
    const report = await app.getWeeklyReport({ from: "2026-01-01", to: "2026-01-31" });

    expect(report.summary.baselines.solHodlFinalNavUsd).toBeGreaterThan(0);
    expect(report.summary.baselines.solDcaFinalNavUsd).toBeGreaterThan(0);
    expect(report.summary.totals.plans).toBe(1);

    const initialNav = 10_000;
    const solUnits = initialNav / 200;
    const expectedHodlFinalNav = solUnits * 210;
    expect(report.summary.baselines.solHodlFinalNavUsd).toBeCloseTo(expectedHodlFinalNav, 0);
  });

  it("ignores conflicting SQLite candles when PostgreSQL is the active candle store", async () => {
    const dbPath = join(
      tmpdir(),
      `regime-engine-weekly-candle-conflict-test-${Date.now()}-${Math.floor(Math.random() * 10_000)}.sqlite`
    );
    createdDbPaths.push(dbPath);

    const { db: pg, client: pgClient } = createDb(process.env.DATABASE_URL!);
    cleanupFns.push(() => pgClient.end());
    const ctx = buildStoreContext(dbPath, pg);
    cleanupFns.push(() => ctx.close());

    const fixture = buildFixture(Date.parse("2026-01-08T00:00:00.000Z"));
    const plan = buildPositionPlan(fixture.input);

    writePlanLedgerEntry(ctx.ledger, {
      planRequest: fixture.request,
      planResponse: plan,
      receivedAtUnixMs: fixture.request.asOfUnixMs
    });

    const windowFrom = Date.parse("2026-01-01T00:00:00.000Z");
    const windowTo = Date.parse("2026-01-31T23:59:59.999Z");
    const sqlitePrice = 50;
    const pgPrice = 200;

    ctx.ledger.db
      .prepare(
        `INSERT INTO candle_revisions (
          symbol, source, network, pool_address, timeframe, unix_ms,
          source_recorded_at_iso, source_recorded_at_unix_ms,
          open, high, low, close, volume,
          ohlcv_canonical, ohlcv_hash, received_at_unix_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "SOL/USDC",
        "geckoterminal",
        "solana",
        POOL_ADDRESS,
        "15m",
        windowFrom + 60 * 60 * 1000,
        new Date(windowFrom + 60 * 60 * 1000).toISOString(),
        windowFrom + 60 * 60 * 1000,
        100,
        105,
        99,
        sqlitePrice,
        1000,
        '{"open":100,"high":105,"low":99,"close":50,"volume":1000}',
        "sqlite_hash",
        windowFrom + 60 * 60 * 1000
      );

    await insertPgCandles(pg, [
      {
        unixMs: windowFrom + 60 * 60 * 1000,
        open: 100,
        high: 105,
        low: 99,
        close: pgPrice,
        volume: 1000
      },
      {
        unixMs: windowFrom + 2 * 60 * 60 * 1000,
        open: pgPrice,
        high: pgPrice + 5,
        low: pgPrice - 5,
        close: pgPrice + 3,
        volume: 1100
      },
      {
        unixMs: windowFrom + 3 * 60 * 60 * 1000,
        open: pgPrice + 3,
        high: pgPrice + 8,
        low: pgPrice,
        close: pgPrice + 5,
        volume: 1200
      },
      {
        unixMs: windowFrom + 4 * 60 * 60 * 1000,
        open: pgPrice + 5,
        high: pgPrice + 10,
        low: pgPrice + 3,
        close: pgPrice + 8,
        volume: 1300
      },
      {
        unixMs: windowTo - 60 * 60 * 1000,
        open: pgPrice + 8,
        high: pgPrice + 12,
        low: pgPrice + 6,
        close: pgPrice + 10,
        volume: 1400
      }
    ]);
    cleanupFns.push(() => deletePgCandles(pg));

    const app = buildApplication(ctx);
    const report = await app.getWeeklyReport({ from: "2026-01-01", to: "2026-01-31" });

    const initialNav = 10_000;
    const solUnits = initialNav / 200;
    const expectedHodlFinalNav = solUnits * 210;
    expect(report.summary.baselines.solHodlFinalNavUsd).toBeCloseTo(expectedHodlFinalNav, 0);

    expect(report.summary.baselines.solHodlFinalNavUsd).not.toBeCloseTo((initialNav / 50) * 60, 0);
  });

  it("does not fall back to SQLite when the active PostgreSQL feed is empty", async () => {
    const dbPath = join(
      tmpdir(),
      `regime-engine-weekly-candle-empty-pg-test-${Date.now()}-${Math.floor(Math.random() * 10_000)}.sqlite`
    );
    createdDbPaths.push(dbPath);

    const { db: pg, client: pgClient } = createDb(process.env.DATABASE_URL!);
    cleanupFns.push(() => pgClient.end());
    const ctx = buildStoreContext(dbPath, pg);
    cleanupFns.push(() => ctx.close());
    cleanupFns.push(() => deletePgCandles(pg));

    const fixture = buildFixture(Date.parse("2026-01-08T00:00:00.000Z"));
    const plan = buildPositionPlan(fixture.input);

    writePlanLedgerEntry(ctx.ledger, {
      planRequest: fixture.request,
      planResponse: plan,
      receivedAtUnixMs: fixture.request.asOfUnixMs
    });

    const windowFrom = Date.parse("2026-01-01T00:00:00.000Z");
    const sqlitePrice = 50;

    ctx.ledger.db
      .prepare(
        `INSERT INTO candle_revisions (
          symbol, source, network, pool_address, timeframe, unix_ms,
          source_recorded_at_iso, source_recorded_at_unix_ms,
          open, high, low, close, volume,
          ohlcv_canonical, ohlcv_hash, received_at_unix_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "SOL/USDC",
        "geckoterminal",
        "solana",
        POOL_ADDRESS,
        "15m",
        windowFrom + 60 * 60 * 1000,
        new Date(windowFrom + 60 * 60 * 1000).toISOString(),
        windowFrom + 60 * 60 * 1000,
        100,
        105,
        99,
        sqlitePrice,
        1000,
        '{"open":100,"high":105,"low":99,"close":50,"volume":1000}',
        "sqlite_hash",
        windowFrom + 60 * 60 * 1000
      );

    const app = buildApplication(ctx);
    const report = await app.getWeeklyReport({ from: "2026-01-01", to: "2026-01-31" });

    expect(report.summary.baselines.solHodlFinalNavUsd).toEqual(10_000);
    expect(report.summary.baselines.solDcaFinalNavUsd).toEqual(10_000);
  });
});
