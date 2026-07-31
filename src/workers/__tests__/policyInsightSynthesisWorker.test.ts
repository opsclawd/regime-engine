import { describe, it, expect, vi } from "vitest";
import { runPolicyInsightSynthesisWorker } from "../policyInsightSynthesisWorker.js";
import type { PolicyInsightSynthesisWorkerDeps } from "../policyInsightSynthesisWorker.js";
import type { PolicyInsightSynthesisWorkerConfig } from "../policyInsight/config.js";
import type { WorkerLogger } from "../gecko/logger.js";
import type { RuntimeStoreContext } from "../../composition/buildStoreContext.js";
import type { PolicyInsightSynthesisTriggerPort } from "../../application/ports/policyInsightSynthesisTriggerPort.js";
import type { SynthesizePolicyInsightUseCase } from "../../application/use-cases/synthesizePolicyInsightUseCase.js";

const BASE_CONFIG: PolicyInsightSynthesisWorkerConfig = {
  marketSelector: {
    source: "geckoterminal",
    network: "solana",
    poolAddress: "SOL_USDC_POOL_ADDRESS",
    timeframe: "1h"
  },
  pollIntervalMs: 5000,
  leaseMs: 60000,
  retryMs: 5000,
  maxAttempts: 5
};

const createMockLogger = (): WorkerLogger => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
});

const createMockDeps = (
  overrides?: Partial<PolicyInsightSynthesisWorkerDeps>
): PolicyInsightSynthesisWorkerDeps => {
  const triggerPort =
    overrides?.triggerPort ??
    ({
      claimLatestPairEvidence: vi.fn().mockResolvedValue(null),
      complete: vi.fn().mockResolvedValue(true),
      releaseForRetry: vi.fn().mockResolvedValue(true)
    } as unknown as PolicyInsightSynthesisTriggerPort);

  const synthesizePolicyInsight =
    overrides?.synthesizePolicyInsight ?? (vi.fn() as unknown as SynthesizePolicyInsightUseCase);

  return {
    triggerPort,
    synthesizePolicyInsight,
    logger: createMockLogger(),
    leaseOwner: "test-lease-owner-uuid",
    clock: { nowUnixMs: () => 1700000000000 },
    ...overrides
  };
};

describe("runPolicyInsightSynthesisWorker", () => {
  it("runs a synthesis cycle immediately before the first sleep", async () => {
    const controller = new AbortController();
    const callOrder: string[] = [];

    const runCycleFn = vi.fn(async () => {
      callOrder.push("cycle");
      return { outcome: "idle" as const };
    });

    const sleep = vi.fn(async () => {
      callOrder.push("sleep");
      controller.abort();
    });

    const deps = createMockDeps({
      signal: controller.signal,
      runCycleFn,
      sleep
    });

    await runPolicyInsightSynthesisWorker(BASE_CONFIG, deps);

    expect(runCycleFn).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(["cycle", "sleep"]);
  });

  it("continues polling after a transient cycle result", async () => {
    const controller = new AbortController();
    let cyclesCount = 0;

    const runCycleFn = vi.fn(async () => {
      cyclesCount++;
      if (cyclesCount === 1) {
        return {
          outcome: "transient_failure" as const,
          receiptId: 42,
          errorCode: "TEMPORARY_ERROR",
          errorMessage: "Network blip"
        };
      }
      controller.abort();
      return { outcome: "idle" as const };
    });

    const sleep = vi.fn(async () => {});

    const deps = createMockDeps({
      signal: controller.signal,
      runCycleFn,
      sleep
    });

    await runPolicyInsightSynthesisWorker(BASE_CONFIG, deps);

    expect(cyclesCount).toBe(2);
    expect(sleep).toHaveBeenCalledWith(BASE_CONFIG.pollIntervalMs);
  });

  it("continues polling after an unexpected cycle throw", async () => {
    const controller = new AbortController();
    const logger = createMockLogger();
    let cyclesCount = 0;

    const runCycleFn = vi.fn(async () => {
      cyclesCount++;
      if (cyclesCount === 1) {
        throw new Error("Unexpected crash during synthesis");
      }
      controller.abort();
      return { outcome: "idle" as const };
    });

    const sleep = vi.fn(async () => {});

    const deps = createMockDeps({
      signal: controller.signal,
      logger,
      runCycleFn,
      sleep
    });

    await runPolicyInsightSynthesisWorker(BASE_CONFIG, deps);

    expect(cyclesCount).toBe(2);
    expect(logger.error).toHaveBeenCalledWith("cycle_error", {
      error: "Unexpected crash during synthesis"
    });
    expect(sleep).toHaveBeenCalledWith(BASE_CONFIG.pollIntervalMs);
  });

  it("stops without another claim after abort", async () => {
    const controller = new AbortController();
    let claimsCount = 0;

    const runCycleFn = vi.fn(async () => {
      claimsCount++;
      controller.abort();
      return { outcome: "idle" as const };
    });

    const sleep = vi.fn(async () => {});

    const deps = createMockDeps({
      signal: controller.signal,
      runCycleFn,
      sleep
    });

    await runPolicyInsightSynthesisWorker(BASE_CONFIG, deps);

    expect(claimsCount).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("removes installed signal handlers on shutdown", async () => {
    const sigtermListenersBefore = process.listenerCount("SIGTERM");
    const sigintListenersBefore = process.listenerCount("SIGINT");

    const runCycleFn = vi.fn(async () => {
      // Simulate aborting via inner logic or externally
      return { outcome: "idle" as const };
    });

    let abortWorkerSleep: (() => void) | null = null;
    const sleep = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          abortWorkerSleep = resolve;
        })
    );

    // Run worker without passing deps.signal so it installs process signal handlers
    const deps = createMockDeps({
      runCycleFn,
      sleep
    });

    const workerPromise = runPolicyInsightSynthesisWorker(BASE_CONFIG, deps);

    // Verify listeners were attached while running
    expect(process.listenerCount("SIGTERM")).toBe(sigtermListenersBefore + 1);
    expect(process.listenerCount("SIGINT")).toBe(sigintListenersBefore + 1);

    // Emit SIGTERM to trigger shutdown
    process.emit("SIGTERM");

    if (abortWorkerSleep) {
      (abortWorkerSleep as () => void)();
    }

    await workerPromise;

    expect(process.listenerCount("SIGTERM")).toBe(sigtermListenersBefore);
    expect(process.listenerCount("SIGINT")).toBe(sigintListenersBefore);
  });

  it("fails startup without postgres-backed synthesis dependencies", async () => {
    const mockStoreContext = {
      pg: null,
      close: vi.fn().mockResolvedValue(undefined)
    } as unknown as RuntimeStoreContext;

    const deps = createMockDeps({
      triggerPort: undefined,
      synthesizePolicyInsight: undefined,
      storeContext: mockStoreContext
    });

    await expect(runPolicyInsightSynthesisWorker(BASE_CONFIG, deps)).rejects.toThrow(
      "Policy insight synthesis worker requires Postgres-backed dependencies"
    );

    expect(mockStoreContext.close).toHaveBeenCalledTimes(1);
  });

  it("closes the store context exactly once", async () => {
    const controller = new AbortController();
    const mockStoreContext = {
      pg: {},
      close: vi.fn().mockResolvedValue(undefined)
    } as unknown as RuntimeStoreContext;

    const runCycleFn = vi.fn(async () => {
      controller.abort();
      return { outcome: "idle" as const };
    });

    const deps = createMockDeps({
      signal: controller.signal,
      storeContext: mockStoreContext,
      runCycleFn,
      sleep: vi.fn().mockResolvedValue(undefined)
    });

    await runPolicyInsightSynthesisWorker(BASE_CONFIG, deps);

    expect(mockStoreContext.close).toHaveBeenCalledTimes(1);
  });
});
