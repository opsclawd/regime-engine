import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { buildPlan } from "../../engine/plan/buildPlan.js";
import { createLedgerStore } from "../../ledger/store.js";
import {
  writeExecutionResultLedgerEntry,
  writePlanLedgerEntry
} from "../../ledger/writer.js";
import { generateWeeklyReport } from "../weekly.js";
import type { PlanRequest } from "../../contract/v1/types.js";

const createdDbPaths: string[] = [];

afterEach(() => {
  for (const path of createdDbPaths.splice(0, createdDbPaths.length)) {
    rmSync(path, { force: true });
  }
  delete process.env.LEDGER_DB_PATH;
});

const buildRequestFixture = (
  asOfUnixMs: number,
  driftPerBar: number
): PlanRequest => {
  return {
    schemaVersion: "1.0",
    asOfUnixMs,
    market: {
      symbol: "SOLUSDC",
      timeframe: "1h",
      candles: Array.from({ length: 28 }, (_, index) => {
        const close = 100 + driftPerBar * index + Math.sin(index / 3) * 0.4;
        return {
          unixMs: asOfUnixMs - (27 - index) * 3_600_000,
          open: close - 0.2,
          high: close + 0.8,
          low: close - 0.9,
          close,
          volume: 1_000 + index * 9
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
  };
};

describe("weekly report", () => {
  it("generates deterministic ledger-only markdown + JSON snapshots", () => {
    const store = createLedgerStore(":memory:");
    const firstRequest = buildRequestFixture(
      Date.parse("2026-01-05T00:00:00.000Z"),
      0.5
    );
    const secondRequest = buildRequestFixture(
      Date.parse("2026-01-12T00:00:00.000Z"),
      -0.4
    );

    const firstPlan = buildPlan(firstRequest);
    const secondPlan = buildPlan(secondRequest);

    writePlanLedgerEntry(store, {
      planRequest: firstRequest,
      planResponse: firstPlan,
      receivedAtUnixMs: firstRequest.asOfUnixMs
    });
    writePlanLedgerEntry(store, {
      planRequest: secondRequest,
      planResponse: secondPlan,
      receivedAtUnixMs: secondRequest.asOfUnixMs
    });

    writeExecutionResultLedgerEntry(store, {
      executionResult: {
        schemaVersion: "1.0",
        planId: firstPlan.planId,
        planHash: firstPlan.planHash,
        asOfUnixMs: firstRequest.asOfUnixMs,
        actionResults: [
          {
            actionType: firstPlan.actions[0]?.type ?? "HOLD",
            status: "SUCCESS"
          }
        ],
        costs: {
          txFeesUsd: 0.05,
          priorityFeesUsd: 0.01,
          slippageUsd: 0.1
        },
        portfolioAfter: {
          navUsd: 10_050,
          solUnits: 20.2,
          usdcUnits: 5_960
        }
      }
    });

    writeExecutionResultLedgerEntry(store, {
      executionResult: {
        schemaVersion: "1.0",
        planId: secondPlan.planId,
        planHash: secondPlan.planHash,
        asOfUnixMs: secondRequest.asOfUnixMs,
        actionResults: [
          {
            actionType: secondPlan.actions[0]?.type ?? "HOLD",
            status: "FAILED"
          }
        ],
        costs: {
          txFeesUsd: 0.07,
          priorityFeesUsd: 0.02,
          slippageUsd: 0.12
        },
        portfolioAfter: {
          navUsd: 9_920,
          solUnits: 19.7,
          usdcUnits: 6_050
        }
      }
    });

    const report = generateWeeklyReport({
      store,
      from: "2026-01-01",
      to: "2026-01-31"
    });

    expect(report.markdown).toMatchSnapshot();
    expect(report.summary).toMatchSnapshot();
    store.close();
  });

  it("serves weekly report endpoint", async () => {
    const dbPath = join(
      tmpdir(),
      `regime-engine-weekly-${Date.now()}-${Math.floor(Math.random() * 10_000)}.sqlite`
    );
    createdDbPaths.push(dbPath);
    process.env.LEDGER_DB_PATH = dbPath;

    const app = buildApp();

    const request = buildRequestFixture(Date.parse("2026-01-08T00:00:00.000Z"), 0.3);
    const planResponse = await app.inject({
      method: "POST",
      url: "/v1/plan",
      payload: request
    });
    expect(planResponse.statusCode).toBe(200);
    const plan = planResponse.json() as { planId: string; planHash: string };

    const executionResponse = await app.inject({
      method: "POST",
      url: "/v1/execution-result",
      payload: {
        schemaVersion: "1.0",
        planId: plan.planId,
        planHash: plan.planHash,
        asOfUnixMs: request.asOfUnixMs,
        actionResults: [
          {
            actionType: "REQUEST_REBALANCE",
            status: "SUCCESS"
          }
        ],
        costs: {
          txFeesUsd: 0.04,
          priorityFeesUsd: 0.01,
          slippageUsd: 0.09
        },
        portfolioAfter: {
          navUsd: 10_030,
          solUnits: 20.1,
          usdcUnits: 5_980
        }
      }
    });
    expect(executionResponse.statusCode).toBe(200);

    const reportResponse = await app.inject({
      method: "GET",
      url: "/v1/report/weekly?from=2026-01-01&to=2026-01-31"
    });
    expect(reportResponse.statusCode).toBe(200);
    expect(reportResponse.json()).toEqual(
      expect.objectContaining({
        schemaVersion: "1.0",
        markdown: expect.any(String),
        summary: expect.any(Object)
      })
    );

    await app.close();
  });
});
