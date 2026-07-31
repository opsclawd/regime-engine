import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PolicyInsightSynthesisTriggerPort } from "../application/ports/policyInsightSynthesisTriggerPort.js";
import type { SynthesizePolicyInsightUseCase } from "../application/use-cases/synthesizePolicyInsightUseCase.js";
import type { ClockPort } from "../application/ports/clock.js";
import type { RuntimeStoreContext } from "../composition/buildStoreContext.js";
import { buildStoreContext } from "../composition/buildStoreContext.js";
import type { ApplicationDependencies } from "../composition/buildApplication.js";
import { buildApplication } from "../composition/buildApplication.js";
import { createPostgresPolicyInsightSynthesisTriggerAdapter } from "../adapters/postgres/postgresPolicyInsightSynthesisTriggerAdapter.js";
import type {
  PolicyInsightSynthesisCycleDeps,
  PolicyInsightSynthesisCycleResult
} from "./policyInsight/runSynthesisCycle.js";
import { runPolicyInsightSynthesisCycle } from "./policyInsight/runSynthesisCycle.js";
import type { PolicyInsightSynthesisWorkerConfig } from "./policyInsight/config.js";
import { parsePolicyInsightSynthesisWorkerConfig } from "./policyInsight/config.js";
import type { WorkerLogger } from "./gecko/logger.js";
import { consoleLogger } from "./gecko/logger.js";

export function startHealthServer(): Server {
  const port = Number(process.env.PORT ?? 8787);
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
    consoleLogger.info("health_server_listening", { port });
  });
  return server;
}

export type ServiceType = "api" | "collector" | "synthesis-worker";

export interface ServiceDispatchHandlers {
  api?: () => Promise<unknown> | unknown;
  collector?: () => Promise<unknown> | unknown;
  synthesisWorker: () => Promise<unknown> | unknown;
}

export async function dispatchService(
  serviceType: string | undefined,
  handlers: ServiceDispatchHandlers
): Promise<unknown> {
  const resolvedType = serviceType ?? "api";
  switch (resolvedType) {
    case "api":
      if (handlers.api) {
        return await handlers.api();
      }
      return { service: "api" };
    case "collector":
      if (handlers.collector) {
        return await handlers.collector();
      }
      return { service: "collector" };
    case "synthesis-worker":
      return await handlers.synthesisWorker();
    default:
      throw new Error(`Unknown SERVICE_TYPE: ${resolvedType}`);
  }
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

export interface PolicyInsightSynthesisWorkerDeps {
  triggerPort?: PolicyInsightSynthesisTriggerPort;
  synthesizePolicyInsight?: SynthesizePolicyInsightUseCase;
  storeContext?: RuntimeStoreContext;
  app?: ApplicationDependencies;
  logger?: WorkerLogger;
  leaseOwner?: string;
  clock?: ClockPort;
  signal?: AbortSignal;
  runCycleFn?: (
    deps: PolicyInsightSynthesisCycleDeps
  ) => Promise<PolicyInsightSynthesisCycleResult>;
  sleep?: (ms: number) => Promise<void>;
}

export async function runPolicyInsightSynthesisWorker(
  config?: PolicyInsightSynthesisWorkerConfig,
  deps?: PolicyInsightSynthesisWorkerDeps
): Promise<void> {
  const resolvedConfig = config ?? parsePolicyInsightSynthesisWorkerConfig(process.env);
  const logger = deps?.logger ?? consoleLogger;
  const clock = deps?.clock ?? { nowUnixMs: () => Date.now() };
  const leaseOwner = deps?.leaseOwner ?? randomUUID();

  let storeContext = deps?.storeContext;
  let triggerPort = deps?.triggerPort;
  let synthesizePolicyInsight = deps?.synthesizePolicyInsight;

  if (!triggerPort || !synthesizePolicyInsight) {
    if (!storeContext) {
      storeContext = buildStoreContext();
    }
    const app = deps?.app ?? buildApplication(storeContext);

    if (!triggerPort && storeContext.pg) {
      triggerPort = createPostgresPolicyInsightSynthesisTriggerAdapter(storeContext.pg);
    }
    if (!synthesizePolicyInsight && app.synthesizePolicyInsight) {
      synthesizePolicyInsight = app.synthesizePolicyInsight;
    }
  }

  let storeClosed = false;
  const closeStore = async () => {
    if (!storeClosed && storeContext) {
      storeClosed = true;
      await storeContext.close();
    }
  };

  if (!triggerPort || !synthesizePolicyInsight) {
    await closeStore();
    throw new Error("Policy insight synthesis worker requires Postgres-backed dependencies");
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
      logger.info("shutdown_requested");
    }
  };

  if (signal === controller.signal) {
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  }

  const cycleFn = deps?.runCycleFn ?? runPolicyInsightSynthesisCycle;

  try {
    while (!signal.aborted) {
      try {
        await cycleFn({
          triggerPort,
          synthesizePolicyInsight,
          config: resolvedConfig,
          logger,
          leaseOwner,
          clock
        });
      } catch (err: unknown) {
        if (signal.aborted) break;
        logger.error("cycle_error", {
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
    logger.info("shutdown_complete");
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  const server = startHealthServer();
  runPolicyInsightSynthesisWorker()
    .then(() => {
      server.close();
    })
    .catch((err) => {
      console.error(
        JSON.stringify({
          level: "fatal",
          event: "policy_insight_synthesis_worker_fatal",
          error: err instanceof Error ? err.message : String(err)
        })
      );
      server.close();
      process.exit(1);
    });
}
