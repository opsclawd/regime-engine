import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { createPositionSynthesisRequestHandler } from "../positionSynthesisRequest.js";
import type { RequestPositionPolicyInsightSynthesisUseCase } from "../../../../application/use-cases/requestPositionPolicyInsightSynthesisUseCase.js";

describe("positionSynthesisRequest handler", () => {
  const originalEnv = process.env.POLICY_SYNTHESIS_INTERNAL_TOKEN;

  beforeEach(() => {
    process.env.POLICY_SYNTHESIS_INTERNAL_TOKEN = "test-synthesis-token";
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.POLICY_SYNTHESIS_INTERNAL_TOKEN = originalEnv;
    } else {
      delete process.env.POLICY_SYNTHESIS_INTERNAL_TOKEN;
    }
  });

  it("rejects a missing or incorrect X-Policy-Synthesis-Token before store access", async () => {
    const useCase = vi.fn() as unknown as RequestPositionPolicyInsightSynthesisUseCase;
    const app = Fastify();
    app.post(
      "/v1/internal/insights/sol-usdc/synthesis-requests",
      createPositionSynthesisRequestHandler(useCase)
    );

    // Missing token
    const resMissing = await app.inject({
      method: "POST",
      url: "/v1/internal/insights/sol-usdc/synthesis-requests",
      payload: { mode: "eligible" }
    });
    expect(resMissing.statusCode).toBe(401);
    expect(resMissing.json()).toEqual({
      schemaVersion: "1.0",
      error: {
        code: "UNAUTHORIZED",
        message: "Invalid or missing authentication token",
        details: []
      }
    });

    // Incorrect token
    const resIncorrect = await app.inject({
      method: "POST",
      url: "/v1/internal/insights/sol-usdc/synthesis-requests",
      headers: { "X-Policy-Synthesis-Token": "wrong-token" },
      payload: { mode: "eligible" }
    });
    expect(resIncorrect.statusCode).toBe(401);

    // Verify useCase was never called
    expect(useCase).not.toHaveBeenCalled();
  });

  it("accepts one complete position scope and returns 202 with its request id and queue status", async () => {
    const useCaseFn = vi.fn().mockResolvedValue({
      requestId: 42,
      status: "queued",
      selectionHash: "sel123",
      planHash: "plan123",
      freshEvidenceRequired: false
    });
    const useCase = Object.assign(useCaseFn, {
      reconcileStartup: vi.fn()
    }) as unknown as RequestPositionPolicyInsightSynthesisUseCase;

    const app = Fastify();
    app.post(
      "/v1/internal/insights/sol-usdc/synthesis-requests",
      createPositionSynthesisRequestHandler(useCase)
    );

    const res = await app.inject({
      method: "POST",
      url: "/v1/internal/insights/sol-usdc/synthesis-requests",
      headers: { "X-Policy-Synthesis-Token": "test-synthesis-token" },
      payload: {
        mode: "scope",
        walletAddress: "wallet123",
        whirlpoolAddress: "pool456",
        positionId: "pos789"
      }
    });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({
      schemaVersion: "1.0",
      requests: [
        {
          requestId: 42,
          status: "queued",
          freshEvidenceRequired: false
        }
      ]
    });

    expect(useCaseFn).toHaveBeenCalledWith({
      mode: "single",
      scope: {
        kind: "position",
        network: "solana-mainnet",
        walletAddress: "wallet123",
        whirlpoolAddress: "pool456",
        positionId: "pos789"
      }
    });
  });

  it("accepts mode eligible and returns 202 with deterministic request ids for every unexpired eligible position scope", async () => {
    const useCaseFn = vi.fn().mockResolvedValue({
      reconciledCount: 2,
      results: [
        {
          requestId: 101,
          status: "queued",
          selectionHash: "sel-a",
          planHash: "plan-a",
          freshEvidenceRequired: false
        },
        {
          requestId: 102,
          status: "queued",
          selectionHash: "sel-b",
          planHash: "plan-b",
          freshEvidenceRequired: false
        }
      ]
    });
    const useCase = Object.assign(useCaseFn, {
      reconcileStartup: vi.fn()
    }) as unknown as RequestPositionPolicyInsightSynthesisUseCase;

    const app = Fastify();
    app.post(
      "/v1/internal/insights/sol-usdc/synthesis-requests",
      createPositionSynthesisRequestHandler(useCase)
    );

    const res = await app.inject({
      method: "POST",
      url: "/v1/internal/insights/sol-usdc/synthesis-requests",
      headers: { "X-Policy-Synthesis-Token": "test-synthesis-token" },
      payload: { mode: "eligible" }
    });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({
      schemaVersion: "1.0",
      requests: [
        {
          requestId: 101,
          status: "queued",
          freshEvidenceRequired: false
        },
        {
          requestId: 102,
          status: "queued",
          freshEvidenceRequired: false
        }
      ]
    });

    expect(useCaseFn).toHaveBeenCalledWith({ mode: "startup" });
  });

  it("reports plan scopes without eligible evidence as freshEvidenceRequired for deployment automation", async () => {
    const useCaseFn = vi.fn().mockResolvedValue({
      reconciledCount: 1,
      results: [
        {
          requestId: 201,
          status: "waiting_for_evidence",
          selectionHash: null,
          planHash: "plan-without-evidence",
          freshEvidenceRequired: true
        }
      ]
    });
    const useCase = Object.assign(useCaseFn, {
      reconcileStartup: vi.fn()
    }) as unknown as RequestPositionPolicyInsightSynthesisUseCase;

    const app = Fastify();
    app.post(
      "/v1/internal/insights/sol-usdc/synthesis-requests",
      createPositionSynthesisRequestHandler(useCase)
    );

    const res = await app.inject({
      method: "POST",
      url: "/v1/internal/insights/sol-usdc/synthesis-requests",
      headers: { "X-Policy-Synthesis-Token": "test-synthesis-token" },
      payload: { mode: "eligible" }
    });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({
      schemaVersion: "1.0",
      requests: [
        {
          requestId: 201,
          status: "waiting_for_evidence",
          freshEvidenceRequired: true
        }
      ]
    });
  });

  it("returns 400 for partial scope identity and 503 when Postgres synthesis dependencies are absent", async () => {
    const useCase = vi.fn() as unknown as RequestPositionPolicyInsightSynthesisUseCase;
    const appWithUseCase = Fastify();
    appWithUseCase.post(
      "/v1/internal/insights/sol-usdc/synthesis-requests",
      createPositionSynthesisRequestHandler(useCase)
    );

    // Partial scope identity: positionId only
    const resPartial1 = await appWithUseCase.inject({
      method: "POST",
      url: "/v1/internal/insights/sol-usdc/synthesis-requests",
      headers: { "X-Policy-Synthesis-Token": "test-synthesis-token" },
      payload: { mode: "scope", positionId: "pos123" }
    });
    expect(resPartial1.statusCode).toBe(400);

    // Partial scope identity: walletAddress and positionId only (missing whirlpoolAddress)
    const resPartial2 = await appWithUseCase.inject({
      method: "POST",
      url: "/v1/internal/insights/sol-usdc/synthesis-requests",
      headers: { "X-Policy-Synthesis-Token": "test-synthesis-token" },
      payload: { mode: "scope", walletAddress: "w1", positionId: "p1" }
    });
    expect(resPartial2.statusCode).toBe(400);

    // Invalid mode
    const resInvalidMode = await appWithUseCase.inject({
      method: "POST",
      url: "/v1/internal/insights/sol-usdc/synthesis-requests",
      headers: { "X-Policy-Synthesis-Token": "test-synthesis-token" },
      payload: { mode: "invalid" }
    });
    expect(resInvalidMode.statusCode).toBe(400);

    // 503 when Postgres synthesis dependencies are absent (useCase is null)
    const appNullUseCase = Fastify();
    appNullUseCase.post(
      "/v1/internal/insights/sol-usdc/synthesis-requests",
      createPositionSynthesisRequestHandler(null)
    );

    const resNullUseCase = await appNullUseCase.inject({
      method: "POST",
      url: "/v1/internal/insights/sol-usdc/synthesis-requests",
      headers: { "X-Policy-Synthesis-Token": "test-synthesis-token" },
      payload: { mode: "eligible" }
    });
    expect(resNullUseCase.statusCode).toBe(503);
    expect(resNullUseCase.json()).toEqual({
      schemaVersion: "1.0",
      error: {
        code: "SYNTHESIS_STORE_UNAVAILABLE",
        message: "Position synthesis dependencies are absent (no DATABASE_URL configured)",
        details: []
      }
    });
  });
});
