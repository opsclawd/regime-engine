import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";

const makePayload = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: "1.0",
  pair: "SOL/USDC",
  asOf: "2026-04-29T12:00:00Z",
  source: "openclaw",
  runId: "run-001",
  marketRegime: "ranging",
  fundamentalRegime: "neutral",
  recommendedAction: "hold",
  confidence: "medium",
  riskLevel: "normal",
  dataQuality: "complete",
  clmmPolicy: {
    posture: "neutral",
    rangeBias: "medium",
    rebalanceSensitivity: "normal",
    maxCapitalDeploymentPercent: 80
  },
  levels: { support: [140.5, 135.0], resistance: [180.25, 190.0] },
  reasoning: ["Market ranging between support and resistance"],
  sourceRefs: ["https://example.com/data"],
  expiresAt: "2026-04-30T12:00:00Z",
  ...overrides
});

describe("Insights endpoints without DATABASE_URL", () => {
  afterEach(() => {
    delete process.env.LEDGER_DB_PATH;
    delete process.env.DATABASE_URL;
    delete process.env.INSIGHT_INGEST_TOKEN;
  });

  it("POST /v1/insights/sol-usdc returns 503 when DATABASE_URL is not configured", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    delete process.env.DATABASE_URL;
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/insights/sol-usdc",
      payload: makePayload()
    });
    expect(res.statusCode).toBe(503);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");

    await app.close();
  });

  it("GET /v1/insights/sol-usdc/current returns 503 when DATABASE_URL is not configured", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    delete process.env.DATABASE_URL;
    const app = buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/v1/insights/sol-usdc/current"
    });
    expect(res.statusCode).toBe(503);

    await app.close();
  });

  it("GET /v1/insights/sol-usdc/history returns 503 when DATABASE_URL is not configured", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    delete process.env.DATABASE_URL;
    const app = buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/v1/insights/sol-usdc/history"
    });
    expect(res.statusCode).toBe(503);

    await app.close();
  });
});