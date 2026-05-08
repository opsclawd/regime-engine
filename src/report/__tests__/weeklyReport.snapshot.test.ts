import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { buildPositionPlan, type PositionPlanInput } from "../../engine/plan/positionPlan.js";
import { createLedgerStore } from "../../ledger/store.js";
import { writeExecutionResultLedgerEntry, writePlanLedgerEntry } from "../../ledger/writer.js";
import { generateWeeklyReport } from "../weekly.js";
import type { PlanRequest } from "../../contract/v1/types.js";

const createdDbPaths: string[] = [];

afterEach(() => {
  for (const path of createdDbPaths.splice(0, createdDbPaths.length)) {
    rmSync(path, { force: true });
  }
  delete process.env.LEDGER_DB_PATH;
});

const POOL_ADDRESS = "PoolWeekly1";

const buildFixture = (asOfUnixMs: number): { input: PositionPlanInput; request: PlanRequest } => {
  const input: PositionPlanInput = {
    asOfUnixMs,
    position: {
      positionId: `pos-weekly-${asOfUnixMs}`,
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
        lastCandleUnixMs: asOfUnixMs - 60_000,
        lastCandleIso: "2026-05-08T11:59:00.000Z",
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

describe("weekly report", () => {
  it("generates deterministic ledger-only markdown + JSON snapshots", () => {
    const store = createLedgerStore(":memory:");
    const first = buildFixture(Date.parse("2026-01-05T00:00:00.000Z"));
    const second = buildFixture(Date.parse("2026-01-12T00:00:00.000Z"));

    const firstPlan = buildPositionPlan(first.input);
    const secondPlan = buildPositionPlan(second.input);

    writePlanLedgerEntry(store, {
      planRequest: first.request,
      planResponse: firstPlan,
      receivedAtUnixMs: first.request.asOfUnixMs
    });
    writePlanLedgerEntry(store, {
      planRequest: second.request,
      planResponse: secondPlan,
      receivedAtUnixMs: second.request.asOfUnixMs
    });

    writeExecutionResultLedgerEntry(store, {
      executionResult: {
        schemaVersion: "1.0",
        planId: firstPlan.planId,
        planHash: firstPlan.planHash,
        asOfUnixMs: first.request.asOfUnixMs,
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
        asOfUnixMs: second.request.asOfUnixMs,
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

    const store = createLedgerStore(dbPath);
    const fixture = buildFixture(Date.parse("2026-01-08T00:00:00.000Z"));
    const plan = buildPositionPlan(fixture.input);

    writePlanLedgerEntry(store, {
      planRequest: fixture.request,
      planResponse: plan,
      receivedAtUnixMs: fixture.request.asOfUnixMs
    });

    writeExecutionResultLedgerEntry(store, {
      executionResult: {
        schemaVersion: "1.0",
        planId: plan.planId,
        planHash: plan.planHash,
        asOfUnixMs: fixture.request.asOfUnixMs,
        actionResults: [
          {
            actionType: "HOLD",
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
    store.close();

    const app = buildApp();

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

  it("returns 400 for invalid weekly report date ranges", async () => {
    const app = buildApp();

    const reportResponse = await app.inject({
      method: "GET",
      url: "/v1/report/weekly?from=2026-01-31&to=2026-01-01"
    });

    expect(reportResponse.statusCode).toBe(400);
    expect(reportResponse.json()).toEqual({
      schemaVersion: "1.0",
      error: {
        code: "INVALID_REPORT_RANGE",
        message: "Invalid weekly report date range: from > to.",
        details: []
      }
    });

    await app.close();
  });

  it("returns 400 for malformed weekly report date values", async () => {
    const app = buildApp();

    const overflowDateResponse = await app.inject({
      method: "GET",
      url: "/v1/report/weekly?from=2026-02-30&to=2026-03-01"
    });
    expect(overflowDateResponse.statusCode).toBe(400);
    expect(overflowDateResponse.json()).toEqual({
      schemaVersion: "1.0",
      error: {
        code: "INVALID_REPORT_RANGE",
        message: "Invalid weekly report date range.",
        details: []
      }
    });

    const nonLeapYearResponse = await app.inject({
      method: "GET",
      url: "/v1/report/weekly?from=2026-02-28&to=2026-02-29"
    });
    expect(nonLeapYearResponse.statusCode).toBe(400);
    expect(nonLeapYearResponse.json()).toEqual({
      schemaVersion: "1.0",
      error: {
        code: "INVALID_REPORT_RANGE",
        message: "Invalid weekly report date range.",
        details: []
      }
    });

    await app.close();
  });

  it("returns 500 for malformed persisted report rows", async () => {
    const dbPath = join(
      tmpdir(),
      `regime-engine-weekly-invalid-${Date.now()}-${Math.floor(Math.random() * 10_000)}.sqlite`
    );
    createdDbPaths.push(dbPath);

    const store = createLedgerStore(dbPath);
    store.db
      .prepare(
        `
          INSERT INTO plans
            (plan_id, plan_hash, as_of_unix_ms, plan_json, created_at_unix_ms)
          VALUES
            (?, ?, ?, ?, ?)
        `
      )
      .run(
        "plan-invalid-json",
        "hash-invalid-json",
        Date.parse("2026-01-08T00:00:00.000Z"),
        "{not-json",
        Date.parse("2026-01-08T00:00:00.000Z")
      );
    store.close();

    process.env.LEDGER_DB_PATH = dbPath;
    const app = buildApp();

    const reportResponse = await app.inject({
      method: "GET",
      url: "/v1/report/weekly?from=2026-01-01&to=2026-01-31"
    });

    expect(reportResponse.statusCode).toBe(500);

    await app.close();
  });
});
