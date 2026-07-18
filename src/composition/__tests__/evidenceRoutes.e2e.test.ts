import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../buildApp.js";

describe("evidenceRoutes e2e", () => {
  const TOKEN = "test-evidence-token";
  const INSIGHT_TOKEN = "test-insight-token";

  afterEach(async () => {
    delete process.env.DATABASE_URL;
    delete process.env.LEDGER_DB_PATH;
    delete process.env.EVIDENCE_INGEST_TOKEN;
    delete process.env.INSIGHTS_INGEST_TOKEN;
    vi.restoreAllMocks();
  });

  const buildAppWithToken = async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.EVIDENCE_INGEST_TOKEN = TOKEN;
    process.env.INSIGHTS_INGEST_TOKEN = INSIGHT_TOKEN;
    return buildApp();
  };

  describe("never routes evidence through final-policy insights", () => {
    it("registers legacy /v1/insights/sol-usdc routes separately", async () => {
      const app = await buildAppWithToken();

      const postInsight = await app.inject({
        method: "POST",
        url: "/v1/insights/sol-usdc",
        headers: { "x-insights-ingest-token": INSIGHT_TOKEN },
        payload: { runId: "legacy-1", scope: "pair", data: {} }
      });
      expect(postInsight.statusCode).toBeGreaterThanOrEqual(200);

      const getCurrentInsight = await app.inject({
        method: "GET",
        url: "/v1/insights/sol-usdc/current"
      });
      expect(getCurrentInsight.statusCode).not.toBe(404);

      const getHistoryInsight = await app.inject({
        method: "GET",
        url: "/v1/insights/sol-usdc/history"
      });
      expect(getHistoryInsight.statusCode).not.toBe(404);

      await app.close();
    });

    it("evidence routes do not share handlers with insight routes", async () => {
      const app = await buildAppWithToken();

      const evidenceCurrent = await app.inject({
        method: "GET",
        url: "/v1/evidence/sol-usdc/current"
      });
      expect(evidenceCurrent.statusCode).toBe(503);

      const insightCurrent = await app.inject({
        method: "GET",
        url: "/v1/insights/sol-usdc/current"
      });
      expect(insightCurrent.statusCode).not.toBe(404);

      expect(evidenceCurrent.json()).not.toEqual(insightCurrent.json());

      await app.close();
    });
  });

  describe("without DATABASE_URL (no evidence store)", () => {
    it("GET /v1/evidence/sol-usdc/current returns 503 EVIDENCE_STORE_UNAVAILABLE", async () => {
      const app = await buildAppWithToken();
      const response = await app.inject({
        method: "GET",
        url: "/v1/evidence/sol-usdc/current"
      });
      expect(response.statusCode).toBe(503);
      const body = response.json() as { error?: { code?: string } };
      expect(body.error?.code).toBe("EVIDENCE_STORE_UNAVAILABLE");
      await app.close();
    });

    it("GET /v1/evidence/sol-usdc/history returns 503 EVIDENCE_STORE_UNAVAILABLE", async () => {
      const app = await buildAppWithToken();
      const response = await app.inject({
        method: "GET",
        url: "/v1/evidence/sol-usdc/history"
      });
      expect(response.statusCode).toBe(503);
      const body = response.json() as { error?: { code?: string } };
      expect(body.error?.code).toBe("EVIDENCE_STORE_UNAVAILABLE");
      await app.close();
    });

    it("authenticated POST /v1/evidence/sol-usdc returns 503 EVIDENCE_STORE_UNAVAILABLE", async () => {
      const app = await buildAppWithToken();
      const response = await app.inject({
        method: "POST",
        url: "/v1/evidence/sol-usdc",
        headers: { "x-evidence-ingest-token": TOKEN },
        payload: { runId: "test-run", scope: "pair", data: {} }
      });
      expect(response.statusCode).toBe(503);
      const body = response.json() as { error?: { code?: string } };
      expect(body.error?.code).toBe("EVIDENCE_STORE_UNAVAILABLE");
      await app.close();
    });

    it("unauthenticated POST returns 401 before 503", async () => {
      const app = await buildAppWithToken();
      const response = await app.inject({
        method: "POST",
        url: "/v1/evidence/sol-usdc",
        headers: { "x-evidence-ingest-token": "wrong-token" },
        payload: { runId: "test-run", scope: "pair", data: {} }
      });
      expect(response.statusCode).toBe(401);
      const body = response.json() as { error?: { code?: string } };
      expect(body.error?.code).toBe("UNAUTHORIZED");
      await app.close();
    });

    it("evidence requests do not write to insights store", async () => {
      const app = await buildAppWithToken();

      await app.inject({
        method: "POST",
        url: "/v1/evidence/sol-usdc",
        headers: { "x-evidence-ingest-token": TOKEN },
        payload: { runId: "evidence-run", scope: "pair", data: {} }
      });

      const insightResponse = await app.inject({
        method: "GET",
        url: "/v1/insights/sol-usdc/current"
      });
      const insightBody = insightResponse.json() as {
        items?: Array<{ bundle?: { runId?: string } }>;
      };
      const hasEvidenceRun = insightBody.items?.some(
        (item) => item.bundle?.runId === "evidence-run"
      );
      expect(hasEvidenceRun).toBeFalsy();

      await app.close();
    });
  });

  describe("rejects evidence bodies larger than four mebibytes", () => {
    it("returns 413 when body exceeds 4 MiB", async () => {
      const app = await buildAppWithToken();

      const largeBody = JSON.stringify({
        runId: "large-run",
        scope: "pair",
        data: { padding: "x".repeat(4 * 1024 * 1024) }
      });
      const response = await app.inject({
        method: "POST",
        url: "/v1/evidence/sol-usdc",
        headers: {
          "x-evidence-ingest-token": TOKEN,
          "content-type": "application/json"
        },
        payload: largeBody
      });

      expect(response.statusCode).toBe(413);
      await app.close();
    });

    it("returns 413 before authentication check for oversized body", async () => {
      const app = await buildAppWithToken();

      const largeBody = JSON.stringify({
        runId: "large-run",
        scope: "pair",
        data: { padding: "x".repeat(4 * 1024 * 1024 + 1) }
      });
      const response = await app.inject({
        method: "POST",
        url: "/v1/evidence/sol-usdc",
        headers: {
          "x-evidence-ingest-token": "wrong-token",
          "content-type": "application/json"
        },
        payload: largeBody
      });

      expect(response.statusCode).toBe(413);
      await app.close();
    });
  });
});
