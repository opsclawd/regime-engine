import { randomUUID } from "node:crypto";
import type { PolicyInsightSynthesisTriggerPort } from "../src/application/ports/policyInsightSynthesisTriggerPort.js";
import type { SynthesizePolicyInsightUseCase } from "../src/application/use-cases/synthesizePolicyInsightUseCase.js";
import type { ClockPort } from "../src/application/ports/clock.js";
import type { RuntimeStoreContext } from "../src/composition/buildStoreContext.js";
import { buildStoreContext } from "../src/composition/buildStoreContext.js";
import type { ApplicationDependencies } from "../src/composition/buildApplication.js";
import { buildApplication } from "../src/composition/buildApplication.js";
import { createPostgresPolicyInsightSynthesisTriggerAdapter } from "../src/adapters/postgres/postgresPolicyInsightSynthesisTriggerAdapter.js";
import type {
  PolicyInsightSynthesisCycleDeps,
  PolicyInsightSynthesisCycleResult
} from "../src/workers/policyInsight/runSynthesisCycle.js";
import { runPolicyInsightSynthesisCycle } from "../src/workers/policyInsight/runSynthesisCycle.js";
import type { PolicyInsightSynthesisWorkerConfig } from "../src/workers/policyInsight/config.js";
import { parsePolicyInsightSynthesisWorkerConfig } from "../src/workers/policyInsight/config.js";
import type { WorkerLogger } from "../src/workers/gecko/logger.js";
import { consoleLogger } from "../src/workers/gecko/logger.js";
import { isMainModule } from "../src/workers/policyInsightSynthesisWorker.js";

export interface BackfillPairInsightsDeps {
  triggerPort?: PolicyInsightSynthesisTriggerPort;
  synthesizePolicyInsight?: SynthesizePolicyInsightUseCase;
  storeContext?: RuntimeStoreContext;
  app?: ApplicationDependencies;
  logger?: WorkerLogger;
  leaseOwner?: string;
  clock?: ClockPort;
  runCycleFn?: (
    deps: PolicyInsightSynthesisCycleDeps
  ) => Promise<PolicyInsightSynthesisCycleResult>;
}

export async function runBackfillPairInsights(
  config?: PolicyInsightSynthesisWorkerConfig,
  deps?: BackfillPairInsightsDeps
): Promise<number> {
  const logger = deps?.logger ?? consoleLogger;
  const clock = deps?.clock ?? { nowUnixMs: () => Date.now() };
  const leaseOwner = deps?.leaseOwner ?? randomUUID();

  let resolvedConfig: PolicyInsightSynthesisWorkerConfig;
  try {
    resolvedConfig = config ?? parsePolicyInsightSynthesisWorkerConfig(process.env);
  } catch (err: unknown) {
    logger.error("backfill_config_error", {
      error: err instanceof Error ? err.message : String(err)
    });
    return 1;
  }

  let storeContext = deps?.storeContext;
  let triggerPort = deps?.triggerPort;
  let synthesizePolicyInsight = deps?.synthesizePolicyInsight;

  let storeClosed = false;
  const closeStore = async () => {
    if (!storeClosed && storeContext) {
      storeClosed = true;
      await storeContext.close();
    }
  };

  try {
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

    if (!triggerPort || !synthesizePolicyInsight) {
      logger.error("backfill_setup_error", {
        error: "Policy insight synthesis backfill requires Postgres-backed dependencies"
      });
      return 1;
    }

    const cycleFn = deps?.runCycleFn ?? runPolicyInsightSynthesisCycle;

    const result = await cycleFn({
      triggerPort,
      synthesizePolicyInsight,
      config: resolvedConfig,
      logger,
      leaseOwner,
      clock
    });

    if (result.outcome === "succeeded" || result.outcome === "idle") {
      logger.info("backfill_complete", { ...result });
      return 0;
    } else {
      logger.error("backfill_failed", { ...result });
      return 1;
    }
  } catch (err: unknown) {
    logger.error("backfill_error", {
      error: err instanceof Error ? err.message : String(err)
    });
    return 1;
  } finally {
    await closeStore();
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  runBackfillPairInsights()
    .then((exitCode) => {
      process.exit(exitCode);
    })
    .catch((err) => {
      console.error(
        JSON.stringify({
          level: "fatal",
          event: "backfill_pair_insights_fatal",
          error: err instanceof Error ? err.message : String(err)
        })
      );
      process.exit(1);
    });
}
