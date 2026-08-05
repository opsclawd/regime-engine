import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { registerRoutes, type HttpRouteDependencies } from "../../adapters/http/routes.js";
import type { RequestPositionPolicyInsightSynthesisUseCase } from "../../application/use-cases/requestPositionPolicyInsightSynthesisUseCase.js";
import type { IngestCandlesUseCase } from "../../application/use-cases/ingestCandlesUseCase.js";
import type { GetCurrentRegimeUseCase } from "../../application/use-cases/getCurrentRegimeUseCase.js";
import type { GeneratePlanUseCase } from "../../application/use-cases/generatePlanUseCase.js";
import type { RecordExecutionResultUseCase } from "../../application/use-cases/recordExecutionResultUseCase.js";
import type { RecordClmmExecutionResultUseCase } from "../../application/use-cases/recordClmmExecutionResultUseCase.js";
import type { GetWeeklyReportUseCase } from "../../application/use-cases/getWeeklyReportUseCase.js";
import type { LedgerStore } from "../../ledger/store.js";

describe("positionSynthesisRequestRoutes e2e", () => {
  const originalEnv = process.env.POLICY_SYNTHESIS_INTERNAL_TOKEN;

  beforeEach(() => {
    process.env.POLICY_SYNTHESIS_INTERNAL_TOKEN = "e2e-secret-token";
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.POLICY_SYNTHESIS_INTERNAL_TOKEN = originalEnv;
    } else {
      delete process.env.POLICY_SYNTHESIS_INTERNAL_TOKEN;
    }
  });

  const createDummyDeps = (
    requestPositionPolicyInsightSynthesis: RequestPositionPolicyInsightSynthesisUseCase | null
  ): HttpRouteDependencies => ({
    clock: { nowUnixMs: () => Date.now() },
    ingestCandles: vi.fn() as unknown as IngestCandlesUseCase,
    getCurrentRegime: vi.fn() as unknown as GetCurrentRegimeUseCase,
    generatePlan: vi.fn() as unknown as GeneratePlanUseCase,
    recordExecutionResult: vi.fn() as unknown as RecordExecutionResultUseCase,
    recordClmmExecutionResult: vi.fn() as unknown as RecordClmmExecutionResultUseCase,
    getWeeklyReport: vi.fn() as unknown as GetWeeklyReportUseCase,
    ingestEvidenceBundle: null,
    getCurrentEvidence: null,
    getEvidenceHistory: null,
    ledgerStore: {} as unknown as LedgerStore,
    getCurrentPolicyInsight: null,
    getPolicyInsightHistory: null,
    srThesesV2Store: null,
    versionInfo: { name: "test", version: "1.0.0" },
    checkHealth: async () => ({ ok: true, postgres: "ok", sqlite: "ok" }),
    requestPositionPolicyInsightSynthesis
  });

  it("POST /v1/internal/insights/sol-usdc/synthesis-requests enforces token and returns 202 when active", async () => {
    const useCaseFn = vi.fn().mockResolvedValue({
      requestId: 7,
      status: "queued",
      selectionHash: "hash1",
      planHash: "hash2",
      freshEvidenceRequired: false
    });
    const useCase = Object.assign(useCaseFn, {
      reconcileStartup: vi.fn()
    }) as unknown as RequestPositionPolicyInsightSynthesisUseCase;

    const app = Fastify();
    registerRoutes(app, createDummyDeps(useCase));

    // Unauthorized without header
    const resAuthFail = await app.inject({
      method: "POST",
      url: "/v1/internal/insights/sol-usdc/synthesis-requests",
      payload: { mode: "eligible" }
    });
    expect(resAuthFail.statusCode).toBe(401);

    // Authorized
    const resAuthSuccess = await app.inject({
      method: "POST",
      url: "/v1/internal/insights/sol-usdc/synthesis-requests",
      headers: { "X-Policy-Synthesis-Token": "e2e-secret-token" },
      payload: {
        mode: "scope",
        walletAddress: "w1",
        whirlpoolAddress: "p1",
        positionId: "pos1"
      }
    });

    expect(resAuthSuccess.statusCode).toBe(202);
    expect(resAuthSuccess.json()).toEqual({
      schemaVersion: "1.0",
      requests: [
        {
          requestId: 7,
          status: "queued",
          freshEvidenceRequired: false
        }
      ]
    });
  });

  it("POST /v1/internal/insights/sol-usdc/synthesis-requests returns 503 when useCase is null", async () => {
    const app = Fastify();
    registerRoutes(app, createDummyDeps(null));

    const res = await app.inject({
      method: "POST",
      url: "/v1/internal/insights/sol-usdc/synthesis-requests",
      headers: { "X-Policy-Synthesis-Token": "e2e-secret-token" },
      payload: { mode: "eligible" }
    });

    expect(res.statusCode).toBe(503);
  });
});
