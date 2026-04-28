import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";

const planRequestFixture = {
  schemaVersion: "1.0",
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
} as const;

describe("HTTP route contract stubs", () => {
  let app: FastifyInstance;

  beforeAll(() => {
    app = buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("serves /health", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it("serves /version", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/version"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(
      expect.objectContaining({
        name: "regime-engine",
        version: expect.any(String)
      })
    );
  });

  it("serves /v1/openapi.json", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/openapi.json"
    });

    expect(response.statusCode).toBe(200);
    const document = response.json();
    expect(document).toEqual(
      expect.objectContaining({
        openapi: "3.1.0",
        paths: expect.objectContaining({
          "/v1/plan": expect.any(Object),
          "/v1/execution-result": expect.any(Object),
          "/v1/clmm-execution-result": expect.any(Object),
          "/v1/sr-levels": expect.any(Object),
          "/v1/sr-levels/current": expect.any(Object)
        })
      })
    );
    expect(document.paths["/v1/execution-result"].post.responses).toEqual(
      expect.objectContaining({
        "200": expect.any(Object),
        "400": expect.any(Object),
        "404": expect.any(Object),
        "409": expect.any(Object)
      })
    );
    expect(document.paths["/v1/clmm-execution-result"].post.responses).toEqual(
      expect.objectContaining({
        "200": expect.any(Object),
        "400": expect.any(Object),
        "401": expect.any(Object),
        "409": expect.any(Object)
      })
    );
  });

  it("OpenAPI document advertises POST /v1/candles", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/openapi.json" });
    expect(res.statusCode).toBe(200);
    const doc = res.json();
    expect(doc.paths["/v1/candles"]).toBeDefined();
    expect(doc.paths["/v1/candles"].post).toBeDefined();
  });

  it("OpenAPI document advertises GET /v1/regime/current", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/openapi.json" });
    expect(res.statusCode).toBe(200);
    const doc = res.json();
    expect(doc.paths["/v1/regime/current"]).toBeDefined();
    expect(doc.paths["/v1/regime/current"].get.parameters.length).toBe(5);
  });

  it("returns plan response for /v1/plan", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/plan",
      payload: planRequestFixture
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      regime: "UP" | "DOWN" | "CHOP";
      planId: string;
      planHash: string;
      targets: { solBps: number; usdcBps: number; allowClmm: boolean };
      nextRegimeState: {
        current: "UP" | "DOWN" | "CHOP";
        barsInRegime: number;
        pending: "UP" | "DOWN" | "CHOP" | null;
        pendingBars: number;
      };
    };

    expect(body).toEqual(
      expect.objectContaining({
        schemaVersion: "1.0",
        planId: expect.any(String),
        planHash: expect.any(String),
        targets: expect.objectContaining({
          solBps: expect.any(Number),
          usdcBps: expect.any(Number),
          allowClmm: expect.any(Boolean)
        }),
        nextRegimeState: expect.objectContaining({
          current: expect.any(String),
          barsInRegime: expect.any(Number),
          pendingBars: expect.any(Number)
        })
      })
    );
    expect(["UP", "DOWN", "CHOP"]).toContain(body.regime);
    expect(["UP", "DOWN", "CHOP"]).toContain(body.nextRegimeState.current);
  });

  it("returns canonical validation errors for invalid /v1/plan", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/plan",
      payload: {
        schemaVersion: "1.0"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual(
      expect.objectContaining({
        schemaVersion: "1.0",
        error: expect.objectContaining({
          code: "VALIDATION_ERROR",
          message: "Invalid /v1/plan request body"
        })
      })
    );
  });

  it("rejects /v1/plan candles later than asOfUnixMs", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/plan",
      payload: {
        ...planRequestFixture,
        market: {
          ...planRequestFixture.market,
          candles: [
            {
              ...planRequestFixture.market.candles[0],
              unixMs: planRequestFixture.asOfUnixMs + 1
            }
          ]
        }
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      schemaVersion: "1.0",
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid /v1/plan request body",
        details: [
          {
            path: "$.market.candles[0].unixMs",
            code: "INVALID_VALUE",
            message: "Invalid value"
          }
        ]
      }
    });
  });

  it("returns stub acknowledgement for /v1/execution-result", async () => {
    const planResponse = await app.inject({
      method: "POST",
      url: "/v1/plan",
      payload: {
        ...planRequestFixture,
        asOfUnixMs: planRequestFixture.asOfUnixMs + 1
      }
    });

    const planBody = planResponse.json() as { planId: string; planHash: string };
    const response = await app.inject({
      method: "POST",
      url: "/v1/execution-result",
      payload: {
        schemaVersion: "1.0",
        planId: planBody.planId,
        planHash: planBody.planHash,
        asOfUnixMs: 1_762_591_200_001,
        actionResults: [
          {
            actionType: "REQUEST_REBALANCE",
            status: "SUCCESS"
          }
        ],
        costs: {
          txFeesUsd: 0.02,
          priorityFeesUsd: 0.01,
          slippageUsd: 0.11
        },
        portfolioAfter: {
          navUsd: 10_100,
          solUnits: 21,
          usdcUnits: 5_900
        }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      schemaVersion: "1.0",
      ok: true,
      linkedPlanId: planBody.planId,
      linkedPlanHash: planBody.planHash
    });
  });
});
