import { describe, expect, it } from "vitest";
import { createGeneratePlanUseCase } from "../generatePlanUseCase.js";
import { FakePlanLedgerWritePort } from "./fakes/fakePlanLedgerWritePort.js";
import { buildPlan } from "../../../engine/plan/buildPlan.js";
import type { PlanRequest } from "../../../contract/v1/types.js";

const ONE_HOUR_MS = 60 * 60 * 1000;
const AS_OF = 1_762_591_200_000;

const makePlanRequest = (): PlanRequest => ({
  schemaVersion: "1.0",
  asOfUnixMs: AS_OF,
  market: {
    symbol: "SOLUSDC",
    timeframe: "1h",
    candles: Array.from({ length: 36 }, (_, index) => {
      const base = 100 + index * 0.65 + Math.sin(index / 5) * 0.6;
      const close = base + Math.sin(index / 4) * 0.5;
      return {
        unixMs: AS_OF - (35 - index) * ONE_HOUR_MS,
        open: base,
        high: close + 1,
        low: close - 1,
        close,
        volume: 1_000 + index * 7
      };
    })
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
  }
});

describe("GeneratePlanUseCase", () => {
  it("returns the same response that buildPlan(body, body.regimeState) returns", async () => {
    const port = new FakePlanLedgerWritePort();
    const useCase = createGeneratePlanUseCase({ planLedgerWritePort: port });
    const body = makePlanRequest();

    const response = await useCase(body);
    const direct = buildPlan(body, body.regimeState);

    expect(response).toEqual(direct);
  });

  it("writes exactly { planRequest: body, planResponse: plan } through the port once", async () => {
    const port = new FakePlanLedgerWritePort();
    const useCase = createGeneratePlanUseCase({ planLedgerWritePort: port });
    const body = makePlanRequest();

    const response = await useCase(body);

    expect(port.calls).toHaveLength(1);
    expect(port.calls[0].planRequest).toBe(body);
    expect(port.calls[0].planResponse).toBe(response);
  });

  it("returns the same instance that was written through the port", async () => {
    const port = new FakePlanLedgerWritePort();
    const useCase = createGeneratePlanUseCase({ planLedgerWritePort: port });
    const body = makePlanRequest();

    const response = await useCase(body);

    expect(response).toBe(port.calls[0].planResponse);
  });
});
