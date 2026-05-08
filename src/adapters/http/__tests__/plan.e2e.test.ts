import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../../app.js";
import { planHashFromPlan } from "../../../contract/v1/hash.js";
import { createLedgerStore, getLedgerCounts } from "../../../ledger/store.js";

const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const createdDbPaths: string[] = [];

const PLAN_POOL = "PoolPlanE2E1";

const buildRecentCandles = (count: number) => {
  const anchor = Math.floor(Date.now() / FIFTEEN_MIN_MS) * FIFTEEN_MIN_MS - FIFTEEN_MIN_MS;
  return Array.from({ length: count }, (_, i) => {
    const close = 100 + i * 0.65 + Math.sin(i / 5) * 0.6 + Math.sin(i / 4) * 0.5;
    return {
      unixMs: anchor - (count - 1 - i) * FIFTEEN_MIN_MS,
      open: close - 0.2,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1_000 + i * 7
    };
  });
};

const buildIngestPayload = (count: number) => ({
  schemaVersion: "1.0",
  source: "geckoterminal",
  network: "solana",
  poolAddress: PLAN_POOL,
  symbol: "SOL/USDC",
  timeframe: "15m",
  sourceRecordedAtIso: new Date().toISOString(),
  candles: buildRecentCandles(count)
});

const buildPlanPayload = (overrides: Record<string, unknown> = {}) => {
  const anchor = Math.floor(Date.now() / FIFTEEN_MIN_MS) * FIFTEEN_MIN_MS - FIFTEEN_MIN_MS;
  return {
    schemaVersion: "1.0",
    asOfUnixMs: anchor,
    market: {
      symbol: "SOL/USDC",
      source: "geckoterminal",
      network: "solana",
      poolAddress: PLAN_POOL,
      timeframe: "15m"
    },
    position: {
      positionId: "pos-e2e-1",
      observedAtUnixMs: anchor,
      lowerBoundPrice: 95,
      upperBoundPrice: 110,
      currentPrice: 100,
      rangeState: "in-range",
      breachQualified: false
    },
    portfolio: { navUsd: 12_000, solUnits: 25, usdcUnits: 7_000 },
    autopilotState: {
      activeClmm: false,
      stopouts24h: 0,
      redeploys24h: 0,
      cooldownUntilUnixMs: 0,
      standDownUntilUnixMs: 0,
      strikeCount: 0
    },
    config: {
      regime: {
        confirmBars: 2,
        minHoldBars: 3,
        enterUpTrend: 0.6,
        exitUpTrend: 0.35,
        enterDownTrend: -0.6,
        exitDownTrend: -0.35,
        chopVolRatioMax: 1.4
      },
      allocation: {
        upSolBps: 8_000,
        downSolBps: 1_500,
        chopSolBps: 5_000,
        maxDeltaExposureBpsPerDay: 1_000,
        maxTurnoverPerDayBps: 600
      },
      churn: {
        maxStopouts24h: 2,
        maxRedeploys24h: 2,
        cooldownMsAfterStopout: 86_400_000,
        standDownTriggerStrikes: 2
      },
      baselines: { dcaIntervalDays: 7, dcaAmountUsd: 250, usdcCarryApr: 0.06 }
    },
    ...overrides
  };
};

afterEach(() => {
  for (const path of createdDbPaths.splice(0, createdDbPaths.length)) {
    rmSync(path, { force: true });
  }
  delete process.env.LEDGER_DB_PATH;
  delete process.env.CANDLES_INGEST_TOKEN;
});

describe("/v1/plan e2e", () => {
  it("builds a deterministic plan and writes plan ledger rows", async () => {
    const dbPath = join(
      tmpdir(),
      `regime-engine-plan-e2e-${Date.now()}-${Math.floor(Math.random() * 10_000)}.sqlite`
    );
    createdDbPaths.push(dbPath);
    process.env.LEDGER_DB_PATH = dbPath;
    process.env.CANDLES_INGEST_TOKEN = "test-token";

    const app = buildApp();

    const ingest = await app.inject({
      method: "POST",
      url: "/v1/candles",
      headers: { "X-Candles-Ingest-Token": "test-token" },
      payload: buildIngestPayload(200)
    });
    expect(ingest.statusCode).toBe(200);

    const response = await app.inject({
      method: "POST",
      url: "/v1/plan",
      payload: buildPlanPayload()
    });

    expect(response.statusCode).toBe(200);
    const plan = response.json() as Record<string, unknown>;
    expect(plan).toEqual(
      expect.objectContaining({
        planId: expect.any(String),
        planHash: expect.any(String),
        targets: expect.any(Object),
        actions: expect.any(Array)
      })
    );

    const { planHash, ...withoutHash } = plan;
    expect(planHash).toBe(planHashFromPlan(withoutHash));

    await app.close();

    const verificationStore = createLedgerStore(dbPath);
    expect(getLedgerCounts(verificationStore)).toEqual({
      planRequests: 1,
      plans: 1,
      executionResults: 0,
      srLevelBriefs: 0,
      srLevels: 0,
      clmmExecutionEvents: 0,
      candleRevisions: 200
    });
    verificationStore.close();
  });

  it("threads regimeState across requests for hysteresis continuity", async () => {
    process.env.CANDLES_INGEST_TOKEN = "test-token";
    const app = buildApp();

    const anchor = Math.floor(Date.now() / FIFTEEN_MIN_MS) * FIFTEEN_MIN_MS - FIFTEEN_MIN_MS;
    const uptrendIngest = {
      schemaVersion: "1.0",
      source: "geckoterminal",
      network: "solana",
      poolAddress: PLAN_POOL,
      symbol: "SOL/USDC",
      timeframe: "15m",
      sourceRecordedAtIso: new Date().toISOString(),
      candles: Array.from({ length: 140 }, (_, i) => {
        const close = 100 + Math.sin(i / 4) * 0.5;
        return {
          unixMs: anchor - (139 - i) * FIFTEEN_MIN_MS,
          open: close - 0.1,
          high: close + 0.5,
          low: close - 0.5,
          close,
          volume: 1_000 + i
        };
      })
    };

    const ingest = await app.inject({
      method: "POST",
      url: "/v1/candles",
      headers: { "X-Candles-Ingest-Token": "test-token" },
      payload: uptrendIngest
    });
    expect(ingest.statusCode).toBe(200);

    const basePayload = buildPlanPayload({
      config: {
        regime: {
          confirmBars: 2,
          minHoldBars: 3,
          enterUpTrend: 0.6,
          exitUpTrend: 0.4,
          enterDownTrend: -0.6,
          exitDownTrend: -0.4,
          chopVolRatioMax: 1.25
        },
        allocation: {
          upSolBps: 8_000,
          downSolBps: 1_500,
          chopSolBps: 5_000,
          maxDeltaExposureBpsPerDay: 1_000,
          maxTurnoverPerDayBps: 600
        },
        churn: {
          maxStopouts24h: 2,
          maxRedeploys24h: 2,
          cooldownMsAfterStopout: 86_400_000,
          standDownTriggerStrikes: 2
        },
        baselines: { dcaIntervalDays: 7, dcaAmountUsd: 250, usdcCarryApr: 0.06 }
      }
    });

    let regimeState:
      | {
          current: "UP" | "DOWN" | "CHOP";
          barsInRegime: number;
          pending: "UP" | "DOWN" | "CHOP" | null;
          pendingBars: number;
        }
      | undefined;
    let lastPlanId: string | undefined;

    for (let index = 0; index < 3; index += 1) {
      const shiftedAsOf = basePayload.asOfUnixMs + index * FIFTEEN_MIN_MS;
      const response = await app.inject({
        method: "POST",
        url: "/v1/plan",
        payload: {
          ...basePayload,
          asOfUnixMs: shiftedAsOf,
          position: {
            ...basePayload.position,
            observedAtUnixMs: shiftedAsOf
          },
          regimeState
        }
      });

      expect(response.statusCode).toBe(200);
      const plan = response.json() as {
        planId: string;
        regime: "UP" | "DOWN" | "CHOP";
        nextRegimeState: {
          current: "UP" | "DOWN" | "CHOP";
          barsInRegime: number;
          pending: "UP" | "DOWN" | "CHOP" | null;
          pendingBars: number;
        };
      };
      expect(plan.nextRegimeState.current).toBeTruthy();
      expect(plan.nextRegimeState.barsInRegime).toBeGreaterThanOrEqual(1);
      lastPlanId = plan.planId;
      regimeState = plan.nextRegimeState;
    }

    expect(lastPlanId).toBeDefined();
    expect(regimeState!.barsInRegime).toBeGreaterThanOrEqual(3);
    await app.close();
  });
});
