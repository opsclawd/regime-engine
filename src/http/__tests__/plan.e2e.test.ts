import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { planHashFromPlan } from "../../contract/v1/hash.js";
import { createLedgerStore, getLedgerCounts } from "../../ledger/store.js";

const createdDbPaths: string[] = [];

afterEach(() => {
  for (const path of createdDbPaths.splice(0, createdDbPaths.length)) {
    rmSync(path, { force: true });
  }
  delete process.env.LEDGER_DB_PATH;
});

describe("/v1/plan e2e", () => {
  it("builds a deterministic plan and writes plan ledger rows", async () => {
    const dbPath = join(
      tmpdir(),
      `regime-engine-plan-e2e-${Date.now()}-${Math.floor(Math.random() * 10_000)}.sqlite`
    );
    createdDbPaths.push(dbPath);
    process.env.LEDGER_DB_PATH = dbPath;

    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/plan",
      payload: {
        schemaVersion: "1.0",
        asOfUnixMs: 1_762_591_200_000,
        market: {
          symbol: "SOLUSDC",
          timeframe: "1h",
          candles: Array.from({ length: 36 }, (_, index) => {
            const base = 100 + index * 0.65 + Math.sin(index / 5) * 0.6;
            const close = base + Math.sin(index / 4) * 0.5;
            return {
              unixMs: 1_762_591_200_000 - (35 - index) * 3_600_000,
              open: base,
              high: close + 1,
              low: close - 1,
              close,
              volume: 1_000 + index * 7
            };
          })
        },
        portfolio: {
          navUsd: 12_000,
          solUnits: 25,
          usdcUnits: 7_000
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
      candleRevisions: 0
    });
    verificationStore.close();
  });

  it("applies hysteresis across requests when regimeState is threaded", async () => {
    const app = buildApp();
    const basePayload = {
      schemaVersion: "1.0",
      asOfUnixMs: 1_762_591_200_000,
      market: {
        symbol: "SOLUSDC",
        timeframe: "1h",
        candles: Array.from({ length: 36 }, (_, index) => {
          const close = 100 + index * 1.1 + Math.sin(index / 5) * 0.1;
          return {
            unixMs: 1_762_591_200_000 - (35 - index) * 3_600_000,
            open: close - 0.2,
            high: close + 0.6,
            low: close - 0.6,
            close,
            volume: 1_000 + index * 4
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
          enterUpTrend: -1,
          exitUpTrend: -1.2,
          enterDownTrend: -2,
          exitDownTrend: -2.2,
          chopVolRatioMax: 10
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
    } as const;

    let regimeState:
      | {
          current: "UP" | "DOWN" | "CHOP";
          barsInRegime: number;
          pending: "UP" | "DOWN" | "CHOP" | null;
          pendingBars: number;
        }
      | undefined;
    let latestRegime: "UP" | "DOWN" | "CHOP" = "CHOP";

    for (let index = 0; index < 5; index += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/plan",
        payload: {
          ...basePayload,
          asOfUnixMs: basePayload.asOfUnixMs + index * 3_600_000,
          regimeState
        }
      });

      expect(response.statusCode).toBe(200);
      const plan = response.json() as {
        regime: "UP" | "DOWN" | "CHOP";
        nextRegimeState: {
          current: "UP" | "DOWN" | "CHOP";
          barsInRegime: number;
          pending: "UP" | "DOWN" | "CHOP" | null;
          pendingBars: number;
        };
      };
      latestRegime = plan.regime;
      regimeState = plan.nextRegimeState;
    }

    expect(latestRegime).toBe("UP");
    await app.close();
  });
});
