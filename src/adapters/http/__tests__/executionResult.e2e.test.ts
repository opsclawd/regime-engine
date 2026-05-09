import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../../app.js";
import { createLedgerStore, getLedgerCounts } from "../../../ledger/store.js";

const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const createdDbPaths: string[] = [];

const EXEC_POOL = "PoolExecE2E1";

const buildRecentCandles = (count: number) => {
  const anchor = Math.floor(Date.now() / FIFTEEN_MIN_MS) * FIFTEEN_MIN_MS - FIFTEEN_MIN_MS;
  return Array.from({ length: count }, (_, i) => {
    const close = 100 + i * 0.75 + Math.sin(i / 3) * 0.5;
    return {
      unixMs: anchor - (count - 1 - i) * FIFTEEN_MIN_MS,
      open: close - 0.2,
      high: close + 0.8,
      low: close - 0.9,
      close,
      volume: 1_000 + i * 11
    };
  });
};

const buildIngestPayload = (count: number) => ({
  schemaVersion: "1.0",
  source: "geckoterminal",
  network: "solana",
  poolAddress: EXEC_POOL,
  symbol: "SOL/USDC",
  timeframe: "15m",
  sourceRecordedAtIso: new Date().toISOString(),
  candles: buildRecentCandles(count)
});

const buildPlanPayload = () => {
  const anchor = Math.floor(Date.now() / FIFTEEN_MIN_MS) * FIFTEEN_MIN_MS - FIFTEEN_MIN_MS;
  return {
    schemaVersion: "1.0",
    asOfUnixMs: anchor,
    market: {
      symbol: "SOL/USDC",
      source: "geckoterminal",
      network: "solana",
      poolAddress: EXEC_POOL,
      timeframe: "15m"
    },
    position: {
      positionId: "pos-exec-e2e-1",
      observedAtUnixMs: anchor,
      lowerBoundPrice: 95,
      upperBoundPrice: 110,
      currentPrice: 100,
      rangeState: "in-range",
      breachQualified: false
    },
    portfolio: { navUsd: 10_000, solUnits: 20, usdcUnits: 6_000 },
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
    }
  };
};

afterEach(() => {
  for (const path of createdDbPaths.splice(0, createdDbPaths.length)) {
    rmSync(path, { force: true });
  }
  delete process.env.LEDGER_DB_PATH;
  delete process.env.CANDLES_INGEST_TOKEN;
});

describe("/v1/execution-result e2e", () => {
  it("validates linkage, writes once, and supports idempotent replay", async () => {
    const dbPath = join(
      tmpdir(),
      `regime-engine-exec-e2e-${Date.now()}-${Math.floor(Math.random() * 10_000)}.sqlite`
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

    const planPayload = buildPlanPayload();
    const planResponse = await app.inject({
      method: "POST",
      url: "/v1/plan",
      payload: planPayload
    });
    expect(planResponse.statusCode).toBe(200);
    const plan = planResponse.json() as { planId: string; planHash: string };

    const executionPayload = {
      schemaVersion: "1.0",
      planId: plan.planId,
      planHash: plan.planHash,
      asOfUnixMs: planPayload.asOfUnixMs + 100_000,
      actionResults: [
        {
          actionType: "REQUEST_REBALANCE",
          status: "SUCCESS"
        }
      ],
      costs: {
        txFeesUsd: 0.05,
        priorityFeesUsd: 0.02,
        slippageUsd: 0.15
      },
      portfolioAfter: {
        navUsd: 10_120,
        solUnits: 20.5,
        usdcUnits: 5_920
      }
    };

    const firstExecution = await app.inject({
      method: "POST",
      url: "/v1/execution-result",
      payload: executionPayload
    });
    expect(firstExecution.statusCode).toBe(200);
    expect(firstExecution.json()).toEqual({
      schemaVersion: "1.0",
      ok: true,
      linkedPlanId: plan.planId,
      linkedPlanHash: plan.planHash
    });

    const replayExecution = await app.inject({
      method: "POST",
      url: "/v1/execution-result",
      payload: executionPayload
    });
    expect(replayExecution.statusCode).toBe(200);
    expect(replayExecution.json()).toEqual({
      schemaVersion: "1.0",
      ok: true,
      linkedPlanId: plan.planId,
      linkedPlanHash: plan.planHash,
      idempotent: true
    });

    const mismatchHash = await app.inject({
      method: "POST",
      url: "/v1/execution-result",
      payload: {
        ...executionPayload,
        planHash: "mismatch-hash"
      }
    });
    expect(mismatchHash.statusCode).toBe(409);
    expect(mismatchHash.json()).toEqual({
      schemaVersion: "1.0",
      error: {
        code: "PLAN_HASH_MISMATCH",
        message: `planHash mismatch for planId "${plan.planId}".`,
        details: []
      }
    });

    const missingPlan = await app.inject({
      method: "POST",
      url: "/v1/execution-result",
      payload: {
        ...executionPayload,
        planId: "missing-plan-id"
      }
    });
    expect(missingPlan.statusCode).toBe(404);
    expect(missingPlan.json()).toEqual({
      schemaVersion: "1.0",
      error: {
        code: "PLAN_NOT_FOUND",
        message: 'No plan found for planId "missing-plan-id".',
        details: []
      }
    });

    const conflictingReplay = await app.inject({
      method: "POST",
      url: "/v1/execution-result",
      payload: {
        ...executionPayload,
        portfolioAfter: {
          navUsd: 10_300,
          solUnits: 20.7,
          usdcUnits: 5_900
        }
      }
    });
    expect(conflictingReplay.statusCode).toBe(409);
    expect(conflictingReplay.json()).toEqual({
      schemaVersion: "1.0",
      error: {
        code: "EXECUTION_RESULT_CONFLICT",
        message: `Execution result conflict for planId "${plan.planId}".`,
        details: []
      }
    });

    await app.close();

    const verificationStore = createLedgerStore(dbPath);
    expect(getLedgerCounts(verificationStore)).toEqual({
      planRequests: 1,
      plans: 1,
      executionResults: 1,
      srLevelBriefs: 0,
      srLevels: 0,
      clmmExecutionEvents: 0,
      candleRevisions: 200
    });
    verificationStore.close();
  });
});
