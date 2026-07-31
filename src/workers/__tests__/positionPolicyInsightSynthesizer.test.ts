import { describe, test, expect, vi } from "vitest";
import { runPositionPolicyInsightSynthesizer } from "../positionPolicyInsightSynthesizer.js";
import { buildApp } from "../../composition/buildApp.js";
import type { PositionPolicyInsightSynthesisQueuePort } from "../../application/ports/positionPolicyInsightSynthesisQueuePort.js";
import type { PlanLedgerReadPort } from "../../application/ports/planLedgerPort.js";
import type { SynthesizePolicyInsightUseCase } from "../../application/use-cases/synthesizePolicyInsightUseCase.js";
import type { RequestPositionPolicyInsightSynthesisUseCase } from "../../application/use-cases/requestPositionPolicyInsightSynthesisUseCase.js";
import type { RuntimeStoreContext } from "../../composition/buildStoreContext.js";
import type { ApplicationDependencies } from "../../composition/buildApplication.js";

describe("positionPolicyInsightSynthesizer worker lifecycle", () => {
  test("starts one position worker only when both Postgres and SQLite dependencies are available", async () => {
    const mockReconcileStartup = vi.fn().mockResolvedValue({ reconciledCount: 0, results: [] });
    const mockCycle = vi.fn().mockResolvedValue({ outcome: "idle" });

    const mockQueue = {} as unknown as PositionPolicyInsightSynthesisQueuePort;
    const mockPlanLedger = {} as unknown as PlanLedgerReadPort;
    const mockSynthesize = vi.fn() as unknown as SynthesizePolicyInsightUseCase;
    const mockRequestSynthesis = Object.assign(vi.fn(), {
      reconcileStartup: mockReconcileStartup
    }) as unknown as RequestPositionPolicyInsightSynthesisUseCase;

    const controller = new AbortController();

    const workerPromise = runPositionPolicyInsightSynthesizer(
      {
        pollIntervalMs: 10,
        leaseMs: 1000,
        retryMs: 500,
        maxAttempts: 3,
        marketSelector: {
          source: "geckoterminal",
          network: "solana",
          poolAddress: "sol-usdc-pool",
          timeframe: "1h"
        }
      },
      {
        queue: mockQueue,
        planLedger: mockPlanLedger,
        synthesizePolicyInsight: mockSynthesize,
        requestPositionSynthesis: mockRequestSynthesis,
        runCycleFn: mockCycle,
        signal: controller.signal,
        sleep: () => new Promise((resolve) => setTimeout(resolve, 5))
      }
    );

    await new Promise((resolve) => setTimeout(resolve, 30));
    controller.abort();
    await workerPromise;

    expect(mockReconcileStartup).toHaveBeenCalledTimes(1);
    expect(mockCycle).toHaveBeenCalled();
  });

  test("reconciles waiting and currently eligible unexpired position scopes before polling", async () => {
    const callOrder: string[] = [];
    const mockReconcileStartup = vi.fn().mockImplementation(async () => {
      callOrder.push("reconcileStartup");
      return { reconciledCount: 1, results: [] };
    });
    const mockCycle = vi.fn().mockImplementation(async () => {
      callOrder.push("cycle");
      return { outcome: "idle" };
    });

    const controller = new AbortController();

    const workerPromise = runPositionPolicyInsightSynthesizer(
      {
        pollIntervalMs: 10,
        leaseMs: 1000,
        retryMs: 500,
        maxAttempts: 3,
        marketSelector: {
          source: "geckoterminal",
          network: "solana",
          poolAddress: "sol-usdc-pool",
          timeframe: "1h"
        }
      },
      {
        queue: {} as unknown as PositionPolicyInsightSynthesisQueuePort,
        planLedger: {} as unknown as PlanLedgerReadPort,
        synthesizePolicyInsight: vi.fn() as unknown as SynthesizePolicyInsightUseCase,
        requestPositionSynthesis: Object.assign(vi.fn(), {
          reconcileStartup: mockReconcileStartup
        }) as unknown as RequestPositionPolicyInsightSynthesisUseCase,
        runCycleFn: mockCycle,
        signal: controller.signal,
        sleep: () => new Promise((resolve) => setTimeout(resolve, 5))
      }
    );

    await new Promise((resolve) => setTimeout(resolve, 25));
    controller.abort();
    await workerPromise;

    expect(callOrder[0]).toBe("reconcileStartup");
    expect(callOrder[1]).toBe("cycle");
  });

  test("continues polling after a cycle error and stops cleanly on Fastify close", async () => {
    let cycleCount = 0;
    const mockCycle = vi.fn().mockImplementation(async () => {
      cycleCount++;
      if (cycleCount === 1) {
        throw new Error("Simulated transient cycle error");
      }
      return { outcome: "idle" };
    });

    const mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    };

    const mockCtx = {
      pg: {} as unknown,
      close: vi.fn().mockResolvedValue(undefined)
    } as unknown as RuntimeStoreContext;

    const mockDeps = {
      positionPolicyInsightSynthesisQueue: {} as unknown as PositionPolicyInsightSynthesisQueuePort,
      planLedgerReadPort: {} as unknown as PlanLedgerReadPort,
      synthesizePolicyInsight: vi.fn() as unknown as SynthesizePolicyInsightUseCase,
      requestPositionPolicyInsightSynthesis: Object.assign(vi.fn(), {
        reconcileStartup: vi.fn().mockResolvedValue({ reconciledCount: 0, results: [] })
      }) as unknown as RequestPositionPolicyInsightSynthesisUseCase
    } as unknown as ApplicationDependencies;

    const app = buildApp({
      storeContext: mockCtx,
      deps: mockDeps,
      positionSynthesizerDeps: {
        runCycleFn: mockCycle,
        logger: mockLogger,
        sleep: () => new Promise((resolve) => setTimeout(resolve, 5))
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 35));
    await app.close();

    expect(cycleCount).toBeGreaterThanOrEqual(2);
    expect(mockLogger.error).toHaveBeenCalledWith(
      "position_policy_insight_synthesizer_cycle_error",
      expect.objectContaining({ error: "Simulated transient cycle error" })
    );
    expect(mockCtx.close).toHaveBeenCalled();
  });

  test("does not start position synthesis in SQLite-only mode", async () => {
    const mockReconcileStartup = vi.fn();
    const mockCycle = vi.fn();

    const mockCtx = {
      pg: null,
      close: vi.fn().mockResolvedValue(undefined)
    } as unknown as RuntimeStoreContext;

    const mockDeps = {
      positionPolicyInsightSynthesisQueue: null,
      planLedgerReadPort: {} as unknown as PlanLedgerReadPort,
      synthesizePolicyInsight: null,
      requestPositionPolicyInsightSynthesis: null
    } as unknown as ApplicationDependencies;

    const app = buildApp({
      storeContext: mockCtx,
      deps: mockDeps,
      positionSynthesizerDeps: {
        runCycleFn: mockCycle,
        sleep: () => new Promise((resolve) => setTimeout(resolve, 5))
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    await app.close();

    expect(mockReconcileStartup).not.toHaveBeenCalled();
    expect(mockCycle).not.toHaveBeenCalled();
  });
});
