import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { createLedgerStore, getLedgerCounts } from "../../ledger/store.js";

const createdDbPaths: string[] = [];

afterEach(() => {
  for (const path of createdDbPaths.splice(0, createdDbPaths.length)) {
    rmSync(path, { force: true });
  }
  delete process.env.LEDGER_DB_PATH;
});

describe("/v1/execution-result e2e", () => {
  it("validates linkage, writes once, and supports idempotent replay", async () => {
    const dbPath = join(
      tmpdir(),
      `regime-engine-exec-e2e-${Date.now()}-${Math.floor(Math.random() * 10_000)}.sqlite`
    );
    createdDbPaths.push(dbPath);
    process.env.LEDGER_DB_PATH = dbPath;

    const app = buildApp();
    const planResponse = await app.inject({
      method: "POST",
      url: "/v1/plan",
      payload: {
        schemaVersion: "1.0",
        asOfUnixMs: 1_762_591_200_000,
        market: {
          symbol: "SOLUSDC",
          timeframe: "1h",
          candles: Array.from({ length: 24 }, (_, index) => {
            const close = 100 + index * 0.75 + Math.sin(index / 3) * 0.5;
            return {
              unixMs: 1_762_591_200_000 - (23 - index) * 3_600_000,
              open: close - 0.2,
              high: close + 0.8,
              low: close - 0.9,
              close,
              volume: 1_000 + index * 11
            };
          })
        },
        portfolio: {
          navUsd: 10_000,
          solUnits: 20,
          usdcUnits: 6_000
        },
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
          baselines: {
            dcaIntervalDays: 7,
            dcaAmountUsd: 250,
            usdcCarryApr: 0.06
          }
        }
      }
    });
    expect(planResponse.statusCode).toBe(200);
    const plan = planResponse.json() as { planId: string; planHash: string };

    const executionPayload = {
      schemaVersion: "1.0",
      planId: plan.planId,
      planHash: plan.planHash,
      asOfUnixMs: 1_762_591_300_000,
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
      executionResults: 1
    });
    verificationStore.close();
  });
});
