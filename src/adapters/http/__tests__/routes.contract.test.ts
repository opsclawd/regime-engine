import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../../app.js";

const FIFTEEN_MIN_MS = 15 * 60 * 1000;

const buildIngestPayload = (count: number, poolAddress: string) => {
  const anchor = Math.floor(Date.now() / FIFTEEN_MIN_MS) * FIFTEEN_MIN_MS - FIFTEEN_MIN_MS;
  return {
    schemaVersion: "1.0",
    source: "geckoterminal",
    network: "solana",
    poolAddress,
    symbol: "SOL/USDC",
    timeframe: "15m",
    sourceRecordedAtIso: new Date().toISOString(),
    candles: Array.from({ length: count }, (_, i) => {
      const close = 100 + Math.sin(i / 4) * 0.5;
      return {
        unixMs: anchor - (count - 1 - i) * FIFTEEN_MIN_MS,
        open: close - 0.1,
        high: close + 0.5,
        low: close - 0.5,
        close,
        volume: 1_000 + i
      };
    })
  };
};

const buildPlanRequestFixture = (poolAddress: string) => {
  const anchor = Math.floor(Date.now() / FIFTEEN_MIN_MS) * FIFTEEN_MIN_MS - FIFTEEN_MIN_MS;
  return {
    schemaVersion: "1.0",
    asOfUnixMs: anchor,
    market: {
      symbol: "SOL/USDC",
      source: "geckoterminal",
      network: "solana",
      poolAddress,
      timeframe: "15m"
    },
    position: {
      positionId: "pos-contract-1",
      observedAtUnixMs: anchor,
      lowerBoundPrice: 95,
      upperBoundPrice: 110,
      currentPrice: 100,
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
      baselines: { dcaIntervalDays: 7, dcaAmountUsd: 250, usdcCarryApr: 0.06 }
    }
  };
};

const PLAN_POOL = "PoolPlanContract1";

describe("HTTP route contract stubs", () => {
  let app: FastifyInstance;

  beforeAll(() => {
    process.env.CANDLES_INGEST_TOKEN = "test-token";
    app = buildApp();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.CANDLES_INGEST_TOKEN;
  });

  it("serves /health", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      postgres: "not_configured",
      sqlite: "ok"
    });
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
    const ingest = await app.inject({
      method: "POST",
      url: "/v1/candles",
      headers: { "X-Candles-Ingest-Token": "test-token" },
      payload: buildIngestPayload(140, PLAN_POOL)
    });
    expect(ingest.statusCode).toBe(200);

    const planRequestFixture = buildPlanRequestFixture(PLAN_POOL);
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

  it("returns stub acknowledgement for /v1/execution-result", async () => {
    const planRequestFixture = buildPlanRequestFixture(PLAN_POOL);
    const planResponse = await app.inject({
      method: "POST",
      url: "/v1/plan",
      payload: planRequestFixture
    });

    const planBody = planResponse.json() as { planId: string; planHash: string };
    const response = await app.inject({
      method: "POST",
      url: "/v1/execution-result",
      payload: {
        schemaVersion: "1.0",
        planId: planBody.planId,
        planHash: planBody.planHash,
        asOfUnixMs: planRequestFixture.asOfUnixMs + 1,
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

  it("returns 503 PLAN_MARKET_DATA_UNAVAILABLE when no candles are stored", async () => {
    const planRequestFixture = buildPlanRequestFixture("PoolNoneStored");
    const response = await app.inject({
      method: "POST",
      url: "/v1/plan",
      payload: planRequestFixture
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual(
      expect.objectContaining({
        schemaVersion: "1.0",
        error: expect.objectContaining({ code: "PLAN_MARKET_DATA_UNAVAILABLE" })
      })
    );
  });

  it("returns 503 PLAN_POSITION_STATE_STALE for stale position observations", async () => {
    const poolAddress = "PoolPlanContractStale";
    const ingest = await app.inject({
      method: "POST",
      url: "/v1/candles",
      headers: { "X-Candles-Ingest-Token": "test-token" },
      payload: buildIngestPayload(140, poolAddress)
    });
    expect(ingest.statusCode).toBe(200);

    const planRequestFixture = buildPlanRequestFixture(poolAddress);
    const response = await app.inject({
      method: "POST",
      url: "/v1/plan",
      payload: {
        ...planRequestFixture,
        position: {
          ...planRequestFixture.position,
          observedAtUnixMs: planRequestFixture.asOfUnixMs - 60_001
        }
      }
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({ code: "PLAN_POSITION_STATE_STALE" })
      })
    );
  });

  it("never emits REQUEST_REBALANCE or REQUEST_ENTER_CLMM for the public position-scoped path", async () => {
    const poolAddress = "PoolPlanContractNoRebal";
    const ingest = await app.inject({
      method: "POST",
      url: "/v1/candles",
      headers: { "X-Candles-Ingest-Token": "test-token" },
      payload: buildIngestPayload(140, poolAddress)
    });
    expect(ingest.statusCode).toBe(200);

    const planRequestFixture = buildPlanRequestFixture(poolAddress);
    const response = await app.inject({
      method: "POST",
      url: "/v1/plan",
      payload: planRequestFixture
    });
    const body = response.json() as { actions: Array<{ type: string }> };
    for (const a of body.actions) {
      expect(a.type).not.toBe("REQUEST_REBALANCE");
      expect(a.type).not.toBe("REQUEST_ENTER_CLMM");
    }
  });
});
