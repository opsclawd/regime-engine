import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { planHashFromPlan } from "../../contract/v1/hash.js";
import { SCHEMA_VERSION, type PlanRequest, type PlanResponse } from "../../contract/v1/types.js";
import { createLedgerStore, getLedgerCounts } from "../store.js";
import {
  LEDGER_ERROR_CODES,
  LedgerWriteError,
  writeExecutionResultLedgerEntry,
  writePlanLedgerEntry
} from "../writer.js";

const makePlanRequestFixture = (): PlanRequest => {
  return {
    schemaVersion: SCHEMA_VERSION,
    asOfUnixMs: 1_762_591_200_000,
    market: {
      symbol: "SOLUSDC",
      timeframe: "1h",
      candles: [
        {
          unixMs: 1_762_591_200_000,
          open: 200,
          high: 210,
          low: 195,
          close: 205,
          volume: 1_200
        }
      ]
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
        exitUpTrend: 0.4,
        enterDownTrend: -0.6,
        exitDownTrend: -0.4,
        chopVolRatioMax: 1.25
      },
      allocation: {
        upSolBps: 7_500,
        downSolBps: 2_000,
        chopSolBps: 5_000,
        maxDeltaExposureBpsPerDay: 1_500,
        maxTurnoverPerDayBps: 2_000
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
  };
};

const makePlanResponseFixture = (asOfUnixMs: number): PlanResponse => {
  const basePlan: Omit<PlanResponse, "planHash"> = {
    schemaVersion: SCHEMA_VERSION,
    planId: `plan-${asOfUnixMs}`,
    asOfUnixMs,
    regime: "CHOP",
    targets: {
      solBps: 5_000,
      usdcBps: 5_000,
      allowClmm: true
    },
    actions: [
      {
        type: "HOLD",
        reasonCode: "STUB_PLAN"
      }
    ],
    constraints: {
      cooldownUntilUnixMs: 0,
      standDownUntilUnixMs: 0,
      notes: ["test"]
    },
    nextRegimeState: {
      current: "CHOP",
      barsInRegime: 1,
      pending: null,
      pendingBars: 0
    },
    reasons: [
      {
        code: "STUB_PLAN",
        severity: "INFO",
        message: "test"
      }
    ],
    telemetry: {
      validationPassed: true
    }
  };

  return {
    ...basePlan,
    planHash: planHashFromPlan(basePlan)
  };
};

const temporaryDbPaths: string[] = [];

afterEach(() => {
  for (const path of temporaryDbPaths.splice(0, temporaryDbPaths.length)) {
    rmSync(path, { force: true });
  }
});

describe("ledger writer", () => {
  it("writes plan requests and plans append-only", () => {
    const store = createLedgerStore(":memory:");
    const request = makePlanRequestFixture();
    const response = makePlanResponseFixture(request.asOfUnixMs);

    writePlanLedgerEntry(store, {
      planRequest: request,
      planResponse: response,
      receivedAtUnixMs: 1_762_591_300_000
    });

    expect(getLedgerCounts(store)).toEqual({
      planRequests: 1,
      plans: 1,
      executionResults: 0,
      srLevelBriefs: 0,
      srLevels: 0,
      clmmExecutionEvents: 0,
      candleRevisions: 0
    });
    store.close();
  });

  it("writes linked execution results", () => {
    const store = createLedgerStore(":memory:");
    const request = makePlanRequestFixture();
    const response = makePlanResponseFixture(request.asOfUnixMs);

    writePlanLedgerEntry(store, {
      planRequest: request,
      planResponse: response
    });

    writeExecutionResultLedgerEntry(store, {
      executionResult: {
        schemaVersion: SCHEMA_VERSION,
        planId: response.planId,
        planHash: response.planHash,
        asOfUnixMs: request.asOfUnixMs,
        actionResults: [
          {
            actionType: "HOLD",
            status: "SUCCESS"
          }
        ],
        costs: {
          txFeesUsd: 0.02,
          priorityFeesUsd: 0.01,
          slippageUsd: 0.12
        },
        portfolioAfter: {
          navUsd: 10_020,
          solUnits: 20,
          usdcUnits: 6_020
        }
      },
      receivedAtUnixMs: 1_762_591_400_000
    });

    expect(getLedgerCounts(store)).toEqual({
      planRequests: 1,
      plans: 1,
      executionResults: 1,
      srLevelBriefs: 0,
      srLevels: 0,
      clmmExecutionEvents: 0,
      candleRevisions: 0
    });
    store.close();
  });

  it("rejects execution results when no linked plan exists", () => {
    const store = createLedgerStore(":memory:");

    expect(() =>
      writeExecutionResultLedgerEntry(store, {
        executionResult: {
          schemaVersion: SCHEMA_VERSION,
          planId: "missing-plan",
          planHash: "hash",
          asOfUnixMs: 1_762_591_500_000,
          actionResults: [
            {
              actionType: "HOLD",
              status: "FAILED"
            }
          ],
          costs: {
            txFeesUsd: 0.02,
            priorityFeesUsd: 0.01,
            slippageUsd: 0.12
          },
          portfolioAfter: {
            navUsd: 10_000,
            solUnits: 20,
            usdcUnits: 6_000
          }
        }
      })
    ).toThrowError(LedgerWriteError);

    try {
      writeExecutionResultLedgerEntry(store, {
        executionResult: {
          schemaVersion: SCHEMA_VERSION,
          planId: "missing-plan",
          planHash: "hash",
          asOfUnixMs: 1_762_591_500_000,
          actionResults: [
            {
              actionType: "HOLD",
              status: "FAILED"
            }
          ],
          costs: {
            txFeesUsd: 0.02,
            priorityFeesUsd: 0.01,
            slippageUsd: 0.12
          },
          portfolioAfter: {
            navUsd: 10_000,
            solUnits: 20,
            usdcUnits: 6_000
          }
        }
      });
    } catch (error) {
      expect(error).toBeInstanceOf(LedgerWriteError);
      expect((error as LedgerWriteError).code).toBe(LEDGER_ERROR_CODES.PLAN_NOT_FOUND);
    }

    store.close();
  });
});

describe.sequential("ledger wiring via HTTP stubs", () => {
  it("persists plan and linked execution rows from API handlers", async () => {
    const dbPath = join(
      tmpdir(),
      `regime-engine-ledger-${Date.now()}-${Math.floor(Math.random() * 10_000)}.sqlite`
    );
    temporaryDbPaths.push(dbPath);
    process.env.LEDGER_DB_PATH = dbPath;

    const app = buildApp();
    const planResponse = await app.inject({
      method: "POST",
      url: "/v1/plan",
      payload: makePlanRequestFixture()
    });

    expect(planResponse.statusCode).toBe(200);
    const planBody = planResponse.json() as { planId: string; planHash: string };

    const executionResponse = await app.inject({
      method: "POST",
      url: "/v1/execution-result",
      payload: {
        schemaVersion: SCHEMA_VERSION,
        planId: planBody.planId,
        planHash: planBody.planHash,
        asOfUnixMs: 1_762_591_200_000,
        actionResults: [
          {
            actionType: "HOLD",
            status: "SUCCESS"
          }
        ],
        costs: {
          txFeesUsd: 0.02,
          priorityFeesUsd: 0.01,
          slippageUsd: 0.12
        },
        portfolioAfter: {
          navUsd: 10_050,
          solUnits: 20.5,
          usdcUnits: 5_950
        }
      }
    });

    expect(executionResponse.statusCode).toBe(200);
    await app.close();
    delete process.env.LEDGER_DB_PATH;

    const verificationStore = createLedgerStore(dbPath);
    expect(getLedgerCounts(verificationStore)).toEqual({
      planRequests: 1,
      plans: 1,
      executionResults: 1,
      srLevelBriefs: 0,
      srLevels: 0,
      clmmExecutionEvents: 0,
      candleRevisions: 0
    });
    verificationStore.close();
  });
});
