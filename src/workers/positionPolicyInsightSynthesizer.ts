import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PositionPolicyInsightSynthesisQueuePort } from "../application/ports/positionPolicyInsightSynthesisQueuePort.js";
import type { PlanLedgerReadPort } from "../application/ports/planLedgerPort.js";
import type { SynthesizePolicyInsightUseCase } from "../application/use-cases/synthesizePolicyInsightUseCase.js";
import type { RequestPositionPolicyInsightSynthesisUseCase } from "../application/use-cases/requestPositionPolicyInsightSynthesisUseCase.js";
import type { ClockPort } from "../application/ports/clock.js";
import type { RuntimeStoreContext } from "../composition/buildStoreContext.js";
import { buildStoreContext } from "../composition/buildStoreContext.js";
import type { ApplicationDependencies } from "../composition/buildApplication.js";
import { buildApplication } from "../composition/buildApplication.js";
import type {
  PositionPolicyInsightSynthesisCycleDeps,
  PositionPolicyInsightSynthesisCycleResult
} from "./policyInsight/runPositionSynthesisCycle.js";
import { runPositionPolicyInsightSynthesisCycle } from "./policyInsight/runPositionSynthesisCycle.js";
import type { PolicyInsightSynthesisWorkerConfig } from "./policyInsight/config.js";
import { parsePolicyInsightSynthesisWorkerConfig } from "./policyInsight/config.js";
import type { WorkerLogger } from "./gecko/logger.js";
import { consoleLogger } from "./gecko/logger.js";

export function startHealthServer(): Server {
  const port = Number(process.env.PORT ?? 8789);
  const server = createServer((req, res) => {
    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(port, () => {
    consoleLogger.info("position_policy_insight_synthesizer_health_server_listening", { port });
  });
  return server;
}

function sleepWithSignal(signal?: AbortSignal): (ms: number) => Promise<void> {
  return (ms: number) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      const onAbort = () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
}

export function isMainModule(importMetaUrl: string, argvPath: string | undefined): boolean {
  if (!argvPath) return false;
  try {
    const metaReal = realpathSync(fileURLToPath(importMetaUrl));
    const argvReal = realpathSync(argvPath);
    return metaReal === argvReal;
  } catch {
    return false;
  }
}

export interface PositionPolicyInsightSynthesizerDeps {
  queue?: PositionPolicyInsightSynthesisQueuePort;
  planLedger?: PlanLedgerReadPort;
  synthesizePolicyInsight?: SynthesizePolicyInsightUseCase;
  requestPositionSynthesis?: RequestPositionPolicyInsightSynthesisUseCase;
  storeContext?: RuntimeStoreContext;
  app?: ApplicationDependencies;
  logger?: WorkerLogger;
  leaseOwner?: string;
  clock?: ClockPort;
  signal?: AbortSignal;
  runCycleFn?: (
    deps: PositionPolicyInsightSynthesisCycleDeps
  ) => Promise<PositionPolicyInsightSynthesisCycleResult>;
  sleep?: (ms: number) => Promise<void>;
}

export async function runPositionPolicyInsightSynthesizer(
  config?: PolicyInsightSynthesisWorkerConfig,
  deps?: PositionPolicyInsightSynthesizerDeps
): Promise<void> {
  let resolvedConfig: PolicyInsightSynthesisWorkerConfig;
  if (config) {
    resolvedConfig = config;
  } else {
    try {
      resolvedConfig = parsePolicyInsightSynthesisWorkerConfig(process.env);
    } catch {
      resolvedConfig = {
        marketSelector: {
          source: "geckoterminal",
          network: "solana",
          poolAddress: process.env.CANONICAL_SOL_USDC_POOL_ADDRESS || "sol-usdc-pool",
          timeframe: "1h"
        },
        pollIntervalMs: 5000,
        leaseMs: 60000,
        retryMs: 5000,
        maxAttempts: 5
      };
    }
  }
  const logger = deps?.logger ?? consoleLogger;
  const clock = deps?.clock ?? { nowUnixMs: () => Date.now() };
  const leaseOwner = deps?.leaseOwner ?? randomUUID();

  let storeContext = deps?.storeContext;
  let queue = deps?.queue;
  let planLedger = deps?.planLedger;
  let synthesizePolicyInsight = deps?.synthesizePolicyInsight;
  let requestPositionSynthesis = deps?.requestPositionSynthesis;

  let ownsStoreContext = false;
  if (!queue || !planLedger || !synthesizePolicyInsight || !requestPositionSynthesis) {
    if (!storeContext) {
      storeContext = buildStoreContext();
      ownsStoreContext = true;
    }
    const app = deps?.app ?? buildApplication(storeContext);

    if (!queue && app.positionPolicyInsightSynthesisQueue) {
      queue = app.positionPolicyInsightSynthesisQueue;
    }
    if (!planLedger && app.planLedgerReadPort) {
      planLedger = app.planLedgerReadPort;
    }
    if (!synthesizePolicyInsight && app.synthesizePolicyInsight) {
      synthesizePolicyInsight = app.synthesizePolicyInsight;
    }
    if (!requestPositionSynthesis && app.requestPositionPolicyInsightSynthesis) {
      requestPositionSynthesis = app.requestPositionPolicyInsightSynthesis;
    }
  }

  let storeClosed = false;
  const closeStore = async () => {
    if (ownsStoreContext && !storeClosed && storeContext) {
      storeClosed = true;
      await storeContext.close();
    }
  };

  if (!queue || !planLedger || !synthesizePolicyInsight) {
    await closeStore();
    return;
  }

  const controller = new AbortController();
  const signal = deps?.signal ?? controller.signal;
  const defaultSleepFn = sleepWithSignal(signal);
  const sleepFn = deps?.sleep ?? defaultSleepFn;

  const shutdown = () => {
    if (!signal.aborted) {
      if (signal === controller.signal) {
        controller.abort();
      }
      logger.info("position_policy_insight_synthesizer_shutdown_requested");
    }
  };

  if (signal === controller.signal) {
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  }

  const cycleFn = deps?.runCycleFn ?? runPositionPolicyInsightSynthesisCycle;

  // Startup reconciliation before polling loop starts
  if (requestPositionSynthesis?.reconcileStartup) {
    try {
      await requestPositionSynthesis.reconcileStartup();
    } catch (err: unknown) {
      logger.error("position_policy_insight_synthesizer_reconcile_startup_error", {
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  try {
    while (!signal.aborted) {
      try {
        await cycleFn({
          queue,
          planLedger,
          synthesizePolicyInsight,
          config: resolvedConfig,
          logger,
          leaseOwner,
          clock
        });
      } catch (err: unknown) {
        if (signal.aborted) break;
        logger.error("position_policy_insight_synthesizer_cycle_error", {
          error: err instanceof Error ? err.message : String(err)
        });
      }

      if (signal.aborted) break;

      try {
        await sleepFn(resolvedConfig.pollIntervalMs);
      } catch {
        break;
      }
    }
  } finally {
    if (signal === controller.signal) {
      process.removeListener("SIGTERM", shutdown);
      process.removeListener("SIGINT", shutdown);
    }
    await closeStore();
    logger.info("position_policy_insight_synthesizer_shutdown_complete");
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  const server = startHealthServer();
  runPositionPolicyInsightSynthesizer()
    .then(() => {
      server.close();
    })
    .catch((err) => {
      console.error(
        JSON.stringify({
          level: "fatal",
          event: "position_policy_insight_synthesizer_fatal",
          error: err instanceof Error ? err.message : String(err)
        })
      );
      server.close();
      process.exit(1);
    });
}
