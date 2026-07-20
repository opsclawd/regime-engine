import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLedgerStore } from "../../ledger/store.js";
import { writePlanLedgerEntry } from "../../ledger/writer.js";
import { buildPositionPlan, type PositionPlanInput } from "../../engine/plan/positionPlan.js";
import { toCanonicalJson } from "../../contract/v1/canonical.js";
import { sha256Hex } from "../../contract/v1/hash.js";
import type { PlanRequest } from "../../contract/v1/types.js";
import type { RuntimeStoreContext } from "../buildStoreContext.js";
import { buildApplication } from "../buildApplication.js";

const createdDbPaths: string[] = [];

beforeEach(() => {
  vi.stubEnv("LEDGER_DB_PATH", "");
  vi.stubEnv("DATABASE_URL", "");
});

afterEach(() => {
  for (const path of createdDbPaths.splice(0, createdDbPaths.length)) {
    rmSync(path, { force: true });
  }
  vi.unstubAllEnvs();
});

const POOL_ADDRESS = "PoolWeeklyCandleTest";

const buildFixture = (asOfUnixMs: number): { input: PositionPlanInput; request: PlanRequest } => {
  const input: PositionPlanInput = {
    asOfUnixMs,
    position: {
      positionId: `pos-weekly-candle-${asOfUnixMs}`,
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

const insertCandles = (
  store: ReturnType<typeof createLedgerStore>,
  candles: Array<{
    unixMs: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>
) => {
  for (const candle of candles) {
    const ohlcvCanonical = toCanonicalJson({
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume
    });
    const ohlcvHash = sha256Hex(ohlcvCanonical);
    store.db
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
        candle.unixMs,
        new Date(candle.unixMs).toISOString(),
        candle.unixMs,
        candle.open,
        candle.high,
        candle.low,
        candle.close,
        candle.volume,
        ohlcvCanonical,
        ohlcvHash,
        candle.unixMs
      );
  }
};

const buildStoreContext = (dbPath: string): RuntimeStoreContext => {
  const ledger = createLedgerStore(dbPath);
  return {
    ledger,
    pg: null,
    candleStore: null,
    srThesesV2Store: null,
    close: async () => {
      ledger.close();
    }
  };
};

describe("weekly report candle store (SQLite)", () => {
  it("uses SQLite canonical candles when DATABASE_URL is absent", async () => {
    const dbPath = join(
      tmpdir(),
      `regime-engine-weekly-candle-test-${Date.now()}-${Math.floor(Math.random() * 10_000)}.sqlite`
    );
    createdDbPaths.push(dbPath);

    const ctx = buildStoreContext(dbPath);
    const fixture = buildFixture(Date.parse("2026-01-08T00:00:00.000Z"));
    const plan = buildPositionPlan(fixture.input);

    writePlanLedgerEntry(ctx.ledger, {
      planRequest: fixture.request,
      planResponse: plan,
      receivedAtUnixMs: fixture.request.asOfUnixMs
    });

    const windowFrom = Date.parse("2026-01-01T00:00:00.000Z");
    const windowTo = Date.parse("2026-01-31T23:59:59.999Z");
    const priceRise = 150;
    const priceDrop = 90;

    insertCandles(ctx.ledger, [
      {
        unixMs: windowFrom + 60 * 60 * 1000,
        open: 100,
        high: 105,
        low: 99,
        close: priceRise,
        volume: 1000
      },
      {
        unixMs: windowFrom + 2 * 60 * 60 * 1000,
        open: priceRise,
        high: priceRise + 5,
        low: priceRise - 5,
        close: priceRise + 3,
        volume: 1100
      },
      {
        unixMs: windowFrom + 3 * 60 * 60 * 1000,
        open: priceRise + 3,
        high: priceRise + 8,
        low: priceRise,
        close: priceDrop,
        volume: 1200
      },
      {
        unixMs: windowFrom + 4 * 60 * 60 * 1000,
        open: priceDrop,
        high: priceDrop + 2,
        low: priceDrop - 2,
        close: priceDrop + 1,
        volume: 1300
      },
      {
        unixMs: windowTo - 60 * 60 * 1000,
        open: priceDrop + 1,
        high: priceDrop + 4,
        low: priceDrop,
        close: priceDrop + 3,
        volume: 1400
      }
    ]);

    const app = buildApplication(ctx);
    const report = await app.getWeeklyReport({ from: "2026-01-01", to: "2026-01-31" });

    expect(report.summary.baselines.solHodlFinalNavUsd).toBeGreaterThan(0);
    expect(report.summary.baselines.solDcaFinalNavUsd).toBeGreaterThan(0);
    expect(report.summary.baselines.usdcCarryFinalNavUsd).toBeGreaterThan(0);

    expect(report.summary.baselines.solHodlFinalNavUsd).not.toEqual(
      report.summary.baselines.solDcaFinalNavUsd
    );

    expect(report.summary.totals.plans).toBe(1);

    await ctx.close();
  });
});
